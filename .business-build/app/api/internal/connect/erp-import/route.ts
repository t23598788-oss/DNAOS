/**
 * ERP IMPORT (/api/internal/connect/erp-import) — owner directive 2026-10-15
 * WORKSTREAM 4 — ERP CONNECTOR FOUNDATION
 *
 * หน้าที่ DNA OS (ต่อยอด Connect Core เดิม — engines/connectors + canonical writers
 * เดิม + รูปแบบ internal secret bridge เดิม เช่น inbound-source/payment-confirm):
 *
 *   ERP ภายนอก → API/Webhook/Import (adapter)
 *     POST /api/internal/connect/erp-import  (kind + payload)
 *       → materials            : รับรายการวัสดุ           → match ทะเบียน material_types
 *                                เดิมจริงเท่านั้น (ไม่สร้างวัสดุใหม่ — ไม่ตรง = unmatched จริงใจ)
 *       → procurement_request  : รับความต้องการจัดซื้อ     → ความต้องการ/suppliers รายการเดิม
 *                                (ส่งกลับ matched resources จริงจาก Resource Search)
 *       → stock                : รับสต็อกที่ได้รับอนุญาต    → engines/canonical/stock-write.ts
 *                                เส้นเดียว (ห้ามเขียนยอดสองเส้นทาง)
 *       → suppliers            : รับข้อมูลผู้จำหน่าย       → Connect Identity canonical เดิม
 *                                (linkExternalIdentity provider="erp")
 *       → po_status            : สถานะคำสั่งซื้อ           → business_events canonical เดิม
 *                                (engines/canonical/event-write.ts)
 *
 * ห้าม (ตามโจทย์): ไม่สร้าง ERP ใหม่ · ไม่สร้างระบบบัญชี/จัดซื้อซ้ำ · ไม่เดาว่า provider
 * มี API อะไร (adapter รับข้อมูลเข้าเท่านั้น — ด้าน outbound ให้ ERP pull ผ่าน API
 * เดิม/ม้เขียนไปยิง ERP) · ไม่เชื่อมบัญชี่ภายนอกโดยไม่มีสิทธิ์ (secret bridge จริง)
 *
 * Auth: ERP_IMPORT_INTERNAL_SECRET + header x-erp-import-internal-secret
 * (รูปแบบเดียวกันกับ internal bridges ทั้งหมด) — fail-closed 503/401
 */
import { NextResponse } from "next/server";
import { writeStockMovement } from "@/engines/canonical/stock-write";
import { createBusinessEvent } from "@/engines/canonical/event-write";
import { linkExternalIdentity } from "@/engines/connect/identity";
import { supabaseAdmin } from "@/services/supabase/queries";
import { listPublicRegistry } from "@/engines/public-registry/service";

const KINDS = ["materials", "procurement_request", "stock", "suppliers", "po_status"] as const;
type Kind = (typeof KINDS)[number];

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export async function POST(req: Request) {
  const configured = process.env.ERP_IMPORT_INTERNAL_SECRET;
  if (!configured) return NextResponse.json({ ok: false, error: "ERP bridge ยังไม่ได้อีบัติค่าบนระบบนี้ (fail-closed)" }, { status: 503 });
  if (req.headers.get("x-erp-import-internal-secret") !== configured) {
    return NextResponse.json({ ok: false, error: "ไม่ได้รับอนุญาต" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    kind?: string; payload?: unknown; source_id?: string; actor?: string; erp_name?: string;
  } | null;
  const payload = body?.payload as Record<string, unknown> | undefined;
  const actor = str(body?.actor) ?? "erp-bridge";
  const erpName = str(body?.erp_name) ?? "external-erp";

  if (!body?.kind || !(KINDS as readonly string[]).includes(body.kind)) {
    return NextResponse.json({ ok: false, error: `kind ต้องเป็นหนึ่งใน: ${KINDS.join(", ")}` }, { status: 400 });
  }

  // ── materials: match ทะเบียนจริง ไม่สร้างใหม่ ──
  if (body.kind === "materials") {
    const items = Array.isArray(payload?.items) ? (payload!.items as { name?: string }[]) : [];
    const namesQ = await supabaseAdmin().from("material_types").select("id, name").is("deleted_at", null);
    const catalog = (namesQ.data ?? []) as { id: string; name: string }[];
    let matched = 0;
    const unmatched: string[] = [];
    for (const it of items) {
      const name = str(it.name);
      if (!name) continue;
      const hit = catalog.find((c) => c.name === name || name.includes(c.name) || c.name.includes(name));
      if (hit) matched++; else unmatched.push(name);
    }
    return NextResponse.json({ ok: true, matched, unmatched, catalog_size: catalog.length });
  }

  // ── stock: canonical เส้นเดียว (W1) ──
  if (body.kind === "stock") {
    const r = await writeStockMovement({
      pit_profile_id: String(payload?.pit_profile_id ?? ""),
      material_type_id: String(payload?.material_type_id ?? ""),
      direction: String(payload?.direction ?? "") as never,
      quantity: Number(payload?.quantity ?? 0),
      unit: String(payload?.unit ?? ""),
      source_event_id: `erp:${erpName}:${str(body.source_id) ?? crypto.randomUUID()}`,
      actor,
    });
    return NextResponse.json({ ok: r.ok, error: r.error, stock: r.stock, duplicate: r.duplicate }, { status: r.ok ? 200 : 400 });
  }

  // ── suppliers: Connect Identity canonical เดิม ──
  if (body.kind === "suppliers") {
    const items = Array.isArray(payload?.suppliers) ? (payload!.suppliers as { external_id?: string; name?: string }[]) : [];
    const results: unknown[] = [];
    for (const it of items) {
      const externalId = str(it.external_id);
      if (!externalId) continue;
      const r = await linkExternalIdentity(supabaseAdmin(), {
        provider: `erp:${erpName}`,
        externalSubjectId: externalId,
        displayName: str(it.name) ?? externalId,
        actor,
      });
      results.push({ external_id: externalId, ok: r.ok, error: r.error });
    }
    return NextResponse.json({ ok: true, linked: results.length, results });
  }

  // ── po_status: business_events canonical เดิม ──
  if (body.kind === "po_status") {
    const eventCode = str((payload as { event_code?: string })?.event_code);
    const title = str((payload as { title?: string })?.title);
    if (!eventCode || !title) return NextResponse.json({ ok: false, error: "ต้องระบุ event_code + title" }, { status: 400 });
    const r = await createBusinessEvent(supabaseAdmin(), {
      eventCode,
      title,
      status: str((payload as { status?: string })?.status) as never,
      sourceType: "erp",
      eventInfo: payload ?? {},
    } as never);
    return NextResponse.json({ ok: r.ok, error: r.error, event: r.data }, { status: r.ok ? 200 : 400 });
  }

  // ── procurement_request: ความต้องการจัดซื้อ + Resource Matching จริงกลับ ──
  const materialName = str((payload as { material_name?: string })?.material_name) ?? "";
  const quantity = Number((payload as { quantity?: number })?.quantity ?? 0);
  const match = await listPublicRegistry(materialName);
  const best = (match.entries ?? [])[0] as { site_name?: string; available_materials?: { material?: string; price?: number | null }[] } | undefined;
  const priceEvidence = best?.available_materials?.find((m) => m.material && materialName.includes(m.material))?.price ?? null;
  return NextResponse.json({
    ok: true,
    note: "รับความต้องการเป็นหลักฐานของผู้เรียก (ไม่ลงทะเบียนบนทะเบียนบ่อที่ไม่อยู่) — matching จากทะเบียนจริงเท่านั้น",
    matched_source: best?.site_name ?? null,
    price_evidence: priceEvidence,
    registry_total: match.total,
  });
}

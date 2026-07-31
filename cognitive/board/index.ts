/** Board — แปลงผลลัพธ์เป็น UI response */

import type { ExecutionOutput } from "../evaluation";
import type { Hypothesis } from "../hypothesis";
import type { ReflectionOutput } from "../reflection";
import type { WorldState } from "../state";

export interface BoardResponse {
  sender: "ai";
  type: "workspace" | "text";
  text: string;
  workspace?: { sections: BoardSection[] };
  next_actions?: string[];
  debug?: Record<string, unknown>;
  // Rule 72: set only when a document.create step produced an unsaved
  // preview — the UI must show a confirm button and POST these two fields
  // to /api/chat/confirm before anything is actually written.
  confirm_token?: string;
  confirm_action?: string;
  // Owner request 2026-07-11: real Flex card JSON for the document that
  // would be sent, so the UI can render an actual preview instead of text
  // before the human confirms — see cognitive/executor/index.ts's _flex_preview.
  flex_preview?: object;
  // Owner request 2026-07-11: "เอกสารอีกฉบับนึง...เรียงหัวข้อไว้แถบด้านบนเป็น
  // คอลัมน์" — the full tabular document (engines/documents/template.ts's
  // HTML render, already on the preview object as `html`), surfaced as its
  // own top-level field so the client doesn't have to dig through
  // `workspace.sections` to find the matching document section.
  doc_html?: string;
  // Real "open/switch screen by command" capability (owner, 2026-07-30):
  // "เฮียต้องสั่งให้เปิดอะไรก็ได้หน้าจอ สลับหน้าจอก็ต้องสลับหน้าจอ" — a real
  // route (app/api/command/route.ts) + state-cache mechanism existed for
  // this already but NOTHING in the actual admin UI ever read it (confirmed
  // via grep — zero real consumers), so "command to open a screen" simply
  // never worked. This is the real fix: the secretary chat itself
  // (components/admin/SecretaryChat.tsx) reads this field and calls
  // router.push() directly — no separate polling/state-cache layer needed.
  navigate_url?: string;
  // Live State Signal (owner, 2026-07-30): "ให้มันส่ง Pulse ไฟวิ่งผ่านเส้น
  // Node นั้นจริงๆ บนหน้าจอ" — the real module id (registry/architecture.
  // json's own "module:<path>" scheme) this navigation actually landed on,
  // so the 3D assistant overlay can pulse the REAL node instead of just
  // appearing decoratively with no connection to what ran.
  pulse_node?: string;
}

interface BoardSection {
  type: string;
  title?: string;
  items?: Array<{ title?: string; subtitle?: string | null; label?: string; value?: string }>;
}

export function composeBoard(
  worldState: WorldState,
  hypotheses: Hypothesis[],
  executionResults: ExecutionOutput[],
  reflectionOutput: ReflectionOutput,
  turnCount: number,
): BoardResponse {
  const entities = worldState.entities;
  const sections: BoardSection[] = [];

  const customerEntities = entities.filter((e) => e.type === "customer" || e.type === "partner");
  if (customerEntities.length === 1) {
    const customer = customerEntities[0];
    sections.push({
      type: "info",
      title: customer.name,
      items: Object.entries(customer.attributes)
        .filter(([key]) => key !== "resolved")
        .map(([key, value]) => ({ label: key, value: String(value ?? "-") })),
    });
  } else if (customerEntities.length > 1) {
    sections.push({
      type: "list",
      title: `${customerEntities.length} ราย`,
      items: customerEntities.map((entity) => ({
        title: entity.name,
        subtitle: String(entity.attributes.phone ?? ""),
      })),
    });
  }

  addEntityList(sections, "debt", "หนี้", entities);
  addEntityList(sections, "document", "เอกสาร", entities);
  addEntityList(sections, "job", "งาน", entities);
  addEntityList(sections, "material", "วัสดุ", entities);

  // Real "open screen by command" (owner, 2026-07-30) — derive which real
  // admin page this turn's result is actually about, from the SAME entity
  // types already resolved above (never a separate/guessed mapping).
  const NAV_MAP: Record<string, string> = {
    job: "/admin/jobs",
    material: "/admin/pits",
    debt: "/admin/debt-tracking",
    partner: "/admin/partners",
    document: "/admin/receipts",
  };
  let navigateUrl: string | undefined;
  let navigatedDomain: string | undefined;
  let navigatedCount: number | undefined;
  if (customerEntities.some((e) => e.type === "customer")) {
    navigateUrl = "/admin/relationships";
    navigatedDomain = "customer";
    navigatedCount = customerEntities.length;
  } else {
    for (const t of ["job", "material", "debt", "partner", "document"] as const) {
      const matched = entities.filter((e) => e.type === t);
      if (matched.length > 0) {
        navigateUrl = NAV_MAP[t];
        navigatedDomain = t;
        navigatedCount = matched.length;
        break;
      }
    }
  }

  // Awaiting Command State (owner, 2026-07-30): "พอสลับไปหน้าไหนแล้ว ให้
  // ผู้ช่วยทักย้ำบริบทในหน้านั้น...ล็อกวงจรไว้รอคำสั่งถัดไป" — a real,
  // domain-specific follow-up question instead of a flat "done," so the
  // owner knows the assistant actually understood WHAT it just opened and
  // is ready for a next, more specific command. Session/memory-level
  // interpretation of the NEXT reply in light of this specific follow-up
  // isn't built yet (see registry/capability-roadmap.json) — this is the
  // acknowledgment half, not a full state machine yet.
  const FOLLOWUP_TH: Record<string, (count: number) => string> = {
    partner: (n) => `เปิดหน้าคู่ค้า ${n} รายให้แล้วครับ ต้องการดูเฉพาะประเภทไหนครับ (บ่อหิน/บ่อทราย/บ่อดิน ฯลฯ)?`,
    material: (n) => `เปิดหน้าบ่อวัสดุ ${n} รายการให้แล้วครับ ต้องการดูวัสดุชนิดไหนเป็นพิเศษไหมครับ?`,
    debt: (n) => `เปิดหน้าติดตามหนี้ ${n} รายให้แล้วครับ ต้องการดูเฉพาะรายที่ค้างนานที่สุดไหมครับ?`,
    job: (n) => `เปิดหน้างาน ${n} รายการให้แล้วครับ ต้องการดูเฉพาะงานที่กำลังดำเนินการไหมครับ?`,
    document: (n) => `เปิดหน้าเอกสาร ${n} รายการให้แล้วครับ ต้องการดูเอกสารประเภทไหนครับ?`,
    customer: (n) => `เปิดหน้าลูกค้า ${n} รายให้แล้วครับ ต้องการดูรายไหนเป็นพิเศษไหมครับ?`,
  };
  const followUpText = navigatedDomain && navigatedCount != null
    ? FOLLOWUP_TH[navigatedDomain]?.(navigatedCount)
    : undefined;

  for (const result of executionResults) {
    if (result.tool.includes(".create") && result.success && result.data) {
      const data = result.data as Record<string, unknown>;
      const html = data.html as string | undefined;
      const presenter = data.presenter as Record<string, string> | undefined;
      if (html) {
        sections.push({
          type: "document",
          title: presenter?.title ?? String(data.document_number ?? "เอกสาร"),
          html,
          subtitle: presenter?.summary ?? null,
          document_id: String(data.document_id ?? data.id ?? ""),
          document_number: String(data.document_number ?? ""),
        } as any);
      }
    }
  }

  let confirmToken: string | undefined;
  let confirmAction: string | undefined;
  let flexPreview: object | undefined;
  let docHtml: string | undefined;
  for (const result of executionResults) {
    const data = result.data as Record<string, unknown> | null;
    if (result.tool.includes(".create") && result.success && data?._preview_pending) {
      confirmToken = data._confirm_token as string | undefined;
      confirmAction = data._confirm_action as string | undefined;
      flexPreview = data._flex_preview as object | undefined;
      docHtml = data.html as string | undefined;
    }
  }

  // Real gap, owner-reported 2026-07-30: even after routing a real price
  // question to the "material.quote" command (cognitive/reasoning/engine.ts),
  // the response text shown to the user was always the generic
  // `reflectionOutput.summary` ("คำนวณราคาวัสดุ — สำเร็จ (1 steps)") — the
  // command's own real computed answer (material_name/unit_price/error) was
  // fetched but never surfaced. Built here instead of trusting the generic
  // summary for this one tool specifically, since it's the one place that
  // has both the raw command result AND knows how to read it.
  let materialQuoteText: string | undefined;
  for (const result of executionResults) {
    if (result.tool !== "material.quote" || !result.success) continue;
    const data = result.data as Record<string, unknown> | null;
    if (!data) continue;
    if (data.matched === false) {
      const candidates = (data.candidates as string[] | undefined) ?? [];
      materialQuoteText = candidates.length
        ? `ไม่แน่ใจว่าหมายถึงวัสดุไหน — ${candidates.join(" / ")} ครับ`
        : "ไม่พบวัสดุที่ถามถึงในระบบครับ";
    } else if (data.error === "no_customer_id" || data.error === "no_gps") {
      materialQuoteText = `${data.material_name} — ต้องรู้ตำแหน่งจัดส่งจริงก่อนถึงจะคำนวณราคารวมค่าขนส่งได้ครับ (ยังไม่มีข้อมูลลูกค้า/พิกัดในบทสนทนานี้)`;
    } else if (typeof data.error === "string") {
      materialQuoteText = `${data.material_name} — ${data.error}`;
    } else if (typeof data.unit_price === "number") {
      const qty = Number(data.quantity ?? 1);
      const unit = String(data.unit ?? "คิว");
      materialQuoteText = `${data.material_name} ${qty} ${unit} ราคา ${Number(data.unit_price).toLocaleString("th-TH")} บาท/${unit}${
        typeof data.total_price === "number" ? ` รวม ${Number(data.total_price).toLocaleString("th-TH")} บาท` : ""
      } (ยังไม่รวมค่าขนส่งถ้าไม่มีระยะทางจริง)`;
    }
  }

  const warnings = worldState.constraints.filter((c) => c.severity === "blocking" || c.severity === "warning");
  if (warnings.length) {
    sections.push({
      type: "warnings",
      items: warnings.map((constraint) => ({
        title: constraint.description,
        subtitle: constraint.resolution,
      })),
    });
  }

  return {
    sender: "ai",
    type: "workspace",
    text: materialQuoteText ?? followUpText ?? reflectionOutput.summary,
    workspace: { sections },
    next_actions: [
      ...hypotheses.slice(0, 4).map((h) => h.description),
      ...(confirmToken
        ? ["ยืนยัน", "ยกเลิก"]
        : executionResults.filter((r) => r.tool.includes(".create") && r.success).map(() => "ส่ง LINE")),
    ],
    confirm_token: confirmToken,
    confirm_action: confirmAction,
    flex_preview: flexPreview,
    doc_html: docHtml,
    navigate_url: navigateUrl,
    pulse_node: navigateUrl ? `module:app${navigateUrl}/page.tsx` : undefined,
    debug: {
      entities: entities.length,
      constraints: worldState.constraints.length,
      hypotheses: hypotheses.length,
      execution_steps: executionResults.length,
      transitions: reflectionOutput.state_transitions.length,
      completeness: worldState.data_completeness,
      focus: worldState.suggested_focus,
      turn: turnCount,
    },
  };
}

function addEntityList(
  sections: BoardSection[],
  type: "debt" | "document" | "job" | "material",
  label: string,
  entities: WorldState["entities"],
) {
  const matched = entities.filter((entity) => entity.type === type);
  if (!matched.length) return;

  sections.push({
    type: type === "material" ? "grid" : "list",
    title: `${label} (${matched.length})`,
    items: matched.map((entity) => ({
      title: entity.name,
      subtitle: describeEntity(entity.attributes),
    })),
  });
}

function describeEntity(attributes: Record<string, unknown>): string {
  const amount = attributes.outstanding ?? attributes.principal ?? attributes.amount;
  if (amount !== undefined) return `${Number(amount).toLocaleString("th-TH")} บาท`;
  return String(attributes.status ?? attributes.job_status ?? "");
}

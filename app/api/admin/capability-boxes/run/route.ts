/**
 * POST /api/admin/capability-boxes/run
 *
 * Server Run Route — เส้นที่พิสูจน์ "Box → existing runtime → presenterMap → RenderModel"
 * จาก **ภายนอก Canvas** (รอบนี้ไม่แตะ Canvas ที่ FROZEN — ยังไม่มีปุ่ม Run บน node)
 *
 * Reuse เท่านั้น (ไม่มี dispatcher/executor/resolver ตัวใหม่):
 *   - read  → engines/validation/dispatcher.ts :: dispatch()            (existing runtime)
 *   - write → ปฏิเสธที่ route นี้ (403) ให้ไปผ่าน /admin UI ตาม Rule 72  (ของเดิมเป็นผู้บังคับ)
 *   - present → core/workspace/gateway/presenterMap.ts :: resolvePanelRenderModel() → RenderModel
 *              ถ้าไม่ส่ง presenterId มา → core/workspace/presenter.ts :: presentModuleInstance(ownerModule)
 *
 * Auth: requireAuth(ADMIN_TIER) (pattern เดียวกับ /api/admin/connectors/catalog)
 * Body: { boxId: string, args?: object, presenterId?: string }
 *
 * ไม่แต่งผลลัพธ์: ถ้า dispatch ไม่ ok / presenter คืน null → คืนสถานะนั้นตามจริง
 * (ไม่สร้าง RenderModel ปลอมแทน) · ไม่มี business logic ใหม่ในไฟล์นี้
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { runWithDataScope } from "@/core/authority/data-scope-context";
import { resolveSessionDataScope } from "@/engines/authority/session-scope";
import { dispatch } from "@/engines/validation/dispatcher";
import type { PresenterId } from "@/core/workspace/application";
import { resolvePanelRenderModel } from "@/core/workspace/gateway/presenterMap";
import { presentModuleInstance } from "@/core/workspace/presenter";
import { EMPTY_RENDER_MODEL } from "@/core/workspace/renderModel";
import { presentationGatewayDeps } from "@/app/workspace-preview/presentationGatewayDeps";
import { findBox } from "../_lib/boxCatalog";

interface RunBody {
  boxId?: unknown;
  args?: unknown;
  presenterId?: unknown;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  let body: RunBody;
  try {
    body = (await req.json()) as RunBody;
  } catch {
    return NextResponse.json({ ok: false, error: "INVALID_JSON" }, { status: 400 });
  }

  const boxId = typeof body.boxId === "string" ? body.boxId.trim() : "";
  if (!boxId) {
    return NextResponse.json({ ok: false, error: "MISSING_BOX_ID" }, { status: 400 });
  }

  const box = findBox(boxId);
  if (!box) {
    return NextResponse.json(
      { ok: false, error: "BOX_NOT_FOUND", boxId, hint: "ดูรายการกล่องได้ที่ GET /api/admin/capability-boxes" },
      { status: 404 }
    );
  }

  // Rule 72 — write box ต้องผ่านขั้นยืนยันของมนุษย์ที่ /admin UI (route นี้ไม่เรียก dispatchAction)
  if (box.requiresConfirmation) {
    return NextResponse.json(
      {
        ok: false,
        error: "RULE72_CONFIRMATION_REQUIRED",
        boxId,
        kind: box.kind,
        requires_confirmation: true,
        hint: "คำสั่ง write ต้องยืนยันผ่าน /admin UI (preview → execute) — ดู gateway/actions.ts",
      },
      { status: 403 }
    );
  }

  const args = (body.args && typeof body.args === "object" ? body.args : {}) as Record<string, unknown>;
  // Same dispatcher, same rule — the read runs under this admin's real scope.
  const scope = await resolveSessionDataScope(auth);
  const result = await runWithDataScope(scope, () => dispatch(boxId, args, false));

  // เฉพาะ presenterId ที่ caller ส่งมา (ต้องเป็นค่าที่ประกาศใน applicationRegistry) — ไม่เดาเอง
  const presenterId = typeof body.presenterId === "string" ? (body.presenterId as PresenterId) : null;

  let renderModel = EMPTY_RENDER_MODEL;
  let presentationSource: "presenter" | "module" | "none" = "none";

  if (!result.ok) {
    presentationSource = "none";
  } else if (presenterId) {
    const presented = await resolvePanelRenderModel(presenterId, presentationGatewayDeps);
    if (presented) {
      renderModel = presented;
      presentationSource = "presenter";
    }
  } else {
    renderModel = presentModuleInstance(box.ownerModule);
    presentationSource = "module";
  }

  return NextResponse.json({
    ok: result.ok,
    boxId,
    kind: box.kind,
    ownerModule: box.ownerModule,
    mappingStatus: box.mappingStatus,
    capabilityId: box.capability?.capabilityId ?? null,
    dispatch: {
      command: boxId,
      ok: result.ok,
      requires_confirmation: result.requires_confirmation,
      violations: result.violations,
    },
    data: result.data,
    presentation: { source: presentationSource, presenterId, renderModel },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { ORG_CONTEXT_COOKIE, sanitizeOrgCookie } from "@/core/auth/orgContext";
import { fetchOrganizationName, resolveVerifiedScope } from "@/services/supabase/tenantAuthority";
import { supabaseAdmin } from "@/services/supabase/queries";
import { runCognitivePipeline } from "@/cognitive/pipeline";
import { getDisplayState, setDisplayState, type DisplayState } from "@/services/supabase/state-cache";

type PipelineResult = Awaited<ReturnType<typeof runCognitivePipeline>>;

// Real, live security fix (TASK-001, registry/CHANGELOG.json DNA-000070): this
// route was completely unauthenticated — any unauthenticated request could
// trigger the real cognitive command pipeline (runCognitivePipeline), which
// can perform real business actions. requireAuth() with no arguments defaults
// to ANY_AUTHENTICATED (any real logged-in role) — the same default the
// function itself declares, not a narrower guess with no evidence behind it.
export async function POST(request: NextRequest) {
  // STEP 3 — this route used to accept ANY authenticated role (partner/customer)
  // and then declared the OWNER AI sandbox. It is an admin-tier command surface.
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    let state: DisplayState;

    if (body.userCommand) {
      // Server-derived, user-scoped memory key (owner 2026-10-08): memory is
      // keyed per authenticated user — never a shared default bucket.
      // gatewayContext (owner mission 2026-10-10): same fix as the LINE bridge —
      // without it answerWithAi() always answered "ไม่มี AI session context".
      // AI SANDBOX ISOLATION (owner directive 2026-10-15): สาย command bar ของ
      // Admin Workspace = Owner AI — ประกาศ sandbox ชัดเจน ไม่พึ่งดีฟอลท์
      const orgCookie = sanitizeOrgCookie((await cookies()).get(ORG_CONTEXT_COOKIE)?.value ?? null);
      const scopeResult = await resolveVerifiedScope(supabaseAdmin(), { auth, organizationId: orgCookie });
      const scope = scopeResult.ok ? scopeResult.scope : null;
      const memoryKey = `u:${auth.id}:${scope ? `org:${scope.organizationId}:` : ""}command`;
      const organizationName = scope ? await fetchOrganizationName(supabaseAdmin(), scope.organizationId) : null;
      const result = await runCognitivePipeline(body.userCommand, null, memoryKey, null, {
        ownerId: auth.id,
        sessionId: memoryKey,
        sandbox: "owner",
        scope,
        organizationName,
      });
      state = toDisplayState(result);
    } else if (body.command) {
      state = { activeView: body.command, data: body.payload || {} };
    } else {
      return NextResponse.json({ success: false, error: "ไม่มี userCommand หรือ command" }, { status: 400 });
    }

    const orgCookie = sanitizeOrgCookie((await cookies()).get(ORG_CONTEXT_COOKIE)?.value ?? null);
    const scopeResult = await resolveVerifiedScope(supabaseAdmin(), { auth, organizationId: orgCookie });
    const stateKey = `u:${auth.id}:${scopeResult.ok ? `org:${scopeResult.scope.organizationId}:` : ""}command`;
    await setDisplayState(state, stateKey);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: "คำสั่งไม่ถูกต้อง" }, { status: 400 });
  }
}

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  // Per-user/per-organization display state — never a shared bucket.
  const orgCookie = sanitizeOrgCookie((await cookies()).get(ORG_CONTEXT_COOKIE)?.value ?? null);
  const scopeResult = await resolveVerifiedScope(supabaseAdmin(), { auth, organizationId: orgCookie });
  const stateKey = `u:${auth.id}:${scopeResult.ok ? `org:${scopeResult.scope.organizationId}:` : ""}command`;
  const state = await getDisplayState(stateKey);
  return NextResponse.json(state);
}

function toDisplayState(result: PipelineResult): DisplayState {
  if ("command" in result && result.command === "CLEAR_SCREEN") {
    return { activeView: "IDLE", data: {} };
  }

  if (result.type === "workspace" && "workspace" in result) {
    return { activeView: "BOARD", data: result as unknown as Record<string, unknown> };
  }

  return { activeView: "TEXT", data: { text: String("text" in result ? result.text : "") } };
}

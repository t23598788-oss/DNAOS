import { NextResponse } from "next/server";
import { invokeAiGateway, type AiGatewayRequest } from "@/services/ai/gateway";
import { buildDevLoopProblemReport, persistDevLoopProblemReport } from "@/engines/workspace/problemReport";
import { supabaseAdmin } from "@/services/supabase/queries";

/**
 * The single server boundary for remote AI callers (Edge Functions and local
 * workers). It accepts analysis/classification/draft requests only. Provider
 * credentials and provider selection remain server-owned.
 */
export async function POST(request: Request) {
  const secret = process.env.AI_GATEWAY_INTERNAL_SECRET;
  if (!secret) return NextResponse.json({ error: "AI_GATEWAY_INTERNAL_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("x-dna-os-ai-gateway-secret") !== secret) {
    return NextResponse.json({ error: "AI Gateway authorization failed" }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as { request?: AiGatewayRequest } | null;
  const input = body?.request;
  if (!input || request.headers.get("x-dna-os-ai-origin") !== input.origin) {
    return NextResponse.json({ error: "AI Gateway origin/context is invalid" }, { status: 400 });
  }

  const result = await invokeAiGateway(input, {
    reportFailure: async ({ request: failed, error, evidenceId }) => {
      const report = buildDevLoopProblemReport({
        source: failed.origin,
        severity: "critical",
        checkName: `ai_gateway.${failed.capability}`,
        cause: error,
        evidenceRefs: [evidenceId, `session:${failed.sessionId}`],
        recommendedOwnerAction: "ตรวจสอบ AI Gateway provider/configuration และอนุมัติการแก้ไขก่อนเปิดใช้งานซ้ำ",
      });
      await persistDevLoopProblemReport(report, { db: supabaseAdmin() });
    },
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

/**
 * /api/admin/runtime/document-engine
 *
 * SDRN-P3 (registry/CHANGELOG.json DNA-000032). Serves engines/documents/
 * selfDescription.ts's real, computed Self Description over HTTP — that
 * module does Node fs reads (registry/*.json) and cannot run in the browser,
 * so this route is the bridge a client component needs to reach it.
 *
 * SDRN-P5 (DNA-000035): also exposes the Runtime Interface's individual
 * methods via ?method=. Default (no ?method) stays backward-compatible with
 * SDRN-P3 — the full SelfDescription object.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { describeDocumentEngine, createDocumentEngineRuntimeInterface } from "@/engines/documents/selfDescription";

export async function GET(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const method = url.searchParams.get("method");
  if (!method) return NextResponse.json(describeDocumentEngine());

  const iface = createDocumentEngineRuntimeInterface();
  switch (method) {
    case "Describe": return NextResponse.json(iface.Describe());
    case "Health": return NextResponse.json(iface.Health());
    case "Capability": return NextResponse.json(iface.Capability());
    case "Dependency": return NextResponse.json(iface.Dependency());
    case "Need": return NextResponse.json(iface.Need());
    case "Reject": return NextResponse.json(iface.Reject(url.searchParams.get("path") ?? ""));
    case "Recommend": return NextResponse.json(iface.Recommend());
    case "Explain": return NextResponse.json({ explanation: iface.Explain(url.searchParams.get("topic") ?? undefined) });
    case "Register": return NextResponse.json(iface.Register());
    case "Heartbeat": return NextResponse.json(iface.Heartbeat());
    case "Status": return NextResponse.json({ status: iface.Status() });
    case "NextAction": return NextResponse.json({ nextAction: iface.NextAction() });
    case "Owner": return NextResponse.json({ owner: iface.Owner() });
    case "Version": return NextResponse.json(iface.Version());
    case "Compatibility": return NextResponse.json(iface.Compatibility());
    default:
      return NextResponse.json({ error: `Unknown method '${method}'. Valid: Describe, Health, Capability, Dependency, Need, Reject, Recommend, Explain, Register, Heartbeat, Status, NextAction, Owner, Version, Compatibility` }, { status: 400 });
  }
}

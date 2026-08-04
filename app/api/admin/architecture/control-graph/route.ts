import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import * as fs from "fs";
import * as path from "path";

// Owner-only read of the generated registry/system-control-graph.json,
// straight off disk (not the bundled import) so the "refresh" button in
// /admin/architecture can re-read a freshly regenerated file without a full
// page reload — regeneration itself still only happens via
// `npm run architecture:generate` (build-time), this route never triggers it.
export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const graphPath = path.join(process.cwd(), "registry", "system-control-graph.json");
  try {
    const raw = fs.readFileSync(graphPath, "utf-8");
    const json = JSON.parse(raw);
    return NextResponse.json(json);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `ไม่สามารถอ่าน system-control-graph.json: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}

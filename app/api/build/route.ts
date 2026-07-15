import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const ROOT = process.cwd();
const BOOK_PATH = join(ROOT, "registry/architecture-book.json");

// Real, live security fix (TASK-001, registry/CHANGELOG.json DNA-000070): POST
// runs a real execSync shell command (npm run sync) — was completely
// unauthenticated. ADMIN_TIER (not the ANY_AUTHENTICATED default) since this
// triggers real server-side execution, matching the tier already used for
// other mutating admin routes (e.g. app/api/admin/documents/route.ts).
// GET protected too for consistency — it reveals real internal build/health data.

// GET /api/build — สถานะ build ล่าสุดจาก architecture-book.json
export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  if (!existsSync(BOOK_PATH)) {
    return NextResponse.json({
      status: "not_built",
      status_th: "ยังไม่ได้ sync — รัน npm run sync ก่อน",
      generated_at: null,
      summary: null,
    });
  }

  const book = JSON.parse(readFileSync(BOOK_PATH, "utf-8"));
  const violations = (book.nodes ?? []).filter(
    (n: any) => n.status !== "OK"
  ).length;

  return NextResponse.json({
    status: violations === 0 ? "clean" : "has_issues",
    status_th: violations === 0 ? "ระบบสะอาด" : `พบปัญหา ${violations} จุด`,
    generated_at: book.generated_at,
    summary: book.summary,
    health: book.summary?.total > 0
      ? Math.round((book.summary.ok / book.summary.total) * 100)
      : 0,
  });
}

// POST /api/build — trigger npm run sync (re-scan source code)
export async function POST() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const start = Date.now();
  try {
    execSync("npx tsx scripts/sync-registry.ts && npx tsx scripts/build-arch-book.ts", {
      cwd: ROOT,
      timeout: 60_000,
      stdio: "pipe",
    });

    const book = JSON.parse(readFileSync(BOOK_PATH, "utf-8"));
    const elapsed = Date.now() - start;

    return NextResponse.json({
      ok: true,
      elapsed_ms: elapsed,
      generated_at: book.generated_at,
      summary: book.summary,
      status_th: `Sync สำเร็จใน ${elapsed}ms`,
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e.message,
        error_th: "เกิดข้อผิดพลาดระหว่าง sync — ดู console สำหรับรายละเอียด",
      },
      { status: 500 }
    );
  }
}

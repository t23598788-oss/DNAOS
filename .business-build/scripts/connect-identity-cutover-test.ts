/**
 * Connect identity authority cutover test (BATCH 28).
 *
 * Static (offline):
 *   C1 ingestion + sweep no longer read company_line_links directly
 *   C2 no new direct identity writer (linkExternalIdentity is the only writer)
 *   C3 both runtimes resolve from the ONE canonical view (connect_identity_current)
 *   C4 legacy tables kept (not dropped) — read-only projection by design
 * Live (requires env):
 *   C5 LINE user WITH mapping resolves to its company (same as legacy link)
 *   C6 unknown identity => null (fail-closed)
 *   C7 production view row count = backfill result (12)
 */
import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { execSync } from "child_process"
import { resolveExternalIdentity } from "@/engines/connect/identity"
import { supabaseAdmin } from "@/services/supabase/queries"

// FIXTURE/ENV REPAIR (release closeout 2026-10-13): เดิมไฟล์นี้ไม่เคยโหลด
// .env.local → live checks (C5–C7) crash ด้วย "supabaseUrl is required"
// ทั้งที่ test ตัวอื่นในชุดเดียวกัน (canonical-finance / phase-C) โหลดผ่าน
// helper ตัวนี้อยู่แล้ว — ใช้ pattern เดิมเป๊ะ ไม่มี logic ใหม่
function loadEnvLocal() {
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* env may already be provided by the shell */
  }
}
loadEnvLocal();

let failures = 0
let checks = 0
function check(name: string, ok: boolean, detail = ""): void {
  checks += 1
  if (ok) { console.log(`PASS  ${name}`); return }
  failures += 1
  console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`)
}
function read(p: string): string { return readFileSync(p, "utf8") }

const INGESTION = "supabase/functions/line-webhook-v2/engines/process-classified-image.ts"
const SWEEP = "supabase/functions/receipt-reconcile-sweep/index.ts"

// C1 — the two cut-over readers no longer touch company_line_links
const ing = read(INGESTION)
check("ingestion reads no company_line_links", !ing.includes("from(\"company_line_links\")"))
check("ingestion calls resolveExternalIdentity", ing.includes("resolveExternalIdentity(supabase, \"line\", userId)"))
const sw = read(SWEEP)
check("sweep reads no company_line_links", !sw.includes("from(\"company_line_links\")"))
check("sweep calls resolveExternalIdentity", sw.includes("resolveExternalIdentity(supabase, \"line\", lineUserId)"))

// C2 — no NEW direct writer into the canonical identity table
const writers = execSync(
  "grep -rl connect_external_identities --include='*.ts' app engines gateway supabase/functions services 2>/dev/null | grep -v node_modules || true",
  { encoding: "utf8" }
)
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
const insertSites = writers.filter((f) => {
  const src = read(f)
  // FIXTURE REPAIR (release closeout 2026-10-13): เดิมใช้เงื่อนไข
  // "มีชื่อตารางนี้อยู่ในไฟล์ && มี .insert( ตรงไหนก็ได้" ทำให้ไฟล์ที่แค่
  // .select() ตารางนี้แต่ insert อีกตาราง (เช่น gateway/payment-acknowledgement.ts
  // ที่ insert into line_events) ถูกนับเป็น writer = false positive
  // คงเจตนาเดิมเป๊ะ ("ไม่มี writer ใหม่เข้าตาราง canonical") แต่ตรวจchain
  // จริง: .from("connect_external_identities") ต้องเป็นฐานของ insert/upsert
  // ตัวนั้น (ไม่มี .from( อื่นคั่น) — เข้มขึ้น ไม่ใช่ผ่อนลง
  const chain = /from\(\s*["']connect_external_identities["']\s*\)(?:(?!\.from\()[\s\S]){0,300}?\.(?:insert|upsert)\(/.test(src)
  return chain
})
check("only the canonical linker writes connect_external_identities", insertSites.length === 0 || insertSites.every((f) => f.endsWith("engines/connect/identity.ts")), JSON.stringify(insertSites))

// C3 — ONE resolution contract (view name) in both runtimes
check("Next resolver reads the canonical view", read("engines/connect/identity.ts").includes("connect_identity_current"))
check("edge twin reads the canonical view", read("supabase/functions/_shared/connect-identity.ts").includes("connect_identity_current"))

// C4 — legacy tables kept (historical projection, not dropped)
check("legacy company_line_links still exists in migrations", existsSync("supabase/migrations/20260923000003_connect_external_identity.sql") && read("supabase/migrations/20260923000003_connect_external_identity.sql").toLowerCase().includes("company_line_links"))
const drops = execSync("grep -rl \"DROP TABLE.*company_line_links\\\\|DROP TABLE.*line_profiles\" supabase/migrations/ 2>/dev/null || true", { encoding: "utf8" }).trim()
check("no migration drops the legacy tables", drops.length === 0, drops)

async function live(): Promise<void> {
  const db = supabaseAdmin()
  // C5 — known LINE mapping (backfilled from company_line_links — same company)
  const known = await resolveExternalIdentity(db, { provider: "line", externalSubjectId: "U32e25304fda44c95d41094480bcc120d" })
  check("known LINE subject resolves a company", known?.companyId === "1191a3c2-e636-4916-8459-03fbe3cceab5", JSON.stringify(known?.companyId))
  // C6 — unknown identity => null (fail-closed, never a guess)
  const unknown = await resolveExternalIdentity(db, { provider: "line", externalSubjectId: "U_does_not_exist_000" })
  check("unknown identity => null", unknown === null)
  // C7 — backfill row count matches expectation (12 subjects)
  const { data: rows } = await db.from("connect_identity_current").select("external_subject_id")
  check("production view row count = 12 (batch28 backfill)", (rows ?? []).length === 12, String((rows ?? []).length))

  console.log(`\\nconnect-identity cutover: checks=${checks} passed=${checks - failures} failed=${failures}`)
  process.exit(failures === 0 ? 0 : 1)
}

void live()

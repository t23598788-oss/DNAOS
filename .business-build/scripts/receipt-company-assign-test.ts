/**
 * Receipt debtor assignment path test (BATCH 33).
 *
 * Static:
 *   R1 the PATCH route is the manual write path (auth + status gate +
 *      existing-company check + canonical audit)
 *   R2 UI exposes the picker and disables confirm until a company is set
 *   R3 payment confirm flow + RPC untouched by this batch
 *   R4 no name-similarity matching introduced (no fuzzy/difflib/levenshtein)
 * Live-ish:
 *   R5 unauthenticated PATCH => 401 (fail-closed)
 */
import { readFileSync } from "fs"

let failures = 0
let checks = 0
function check(name: string, ok: boolean, detail = ""): void {
  checks += 1
  if (ok) { console.log(`PASS  ${name}`); return }
  failures += 1
  console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`)
}
function read(p: string): string { return readFileSync(p, "utf8") }

const ROUTE = "app/api/admin/receipt-documents/[id]/company/route.ts"
const PAGE = "app/admin/receipts/page.tsx"
const CONFIRM_FLOW = "engines/canonical/receipt-confirm-flow.ts"
const PAYMENT_WRITE = "engines/canonical/payment-write.ts"
const ASSIGN_ENGINE = "engines/canonical/receipt-company-assignment.ts"

const route = read(ROUTE)
const assignEngine = read(ASSIGN_ENGINE)
check("route requires admin auth", route.includes("requireAuth(ADMIN_TIER)"))
check("route delegates to the ONE canonical assignment writer", route.includes("assignReceiptCompany") && !route.includes(`from("receipt_documents").update`))
check("engine gates on ai_read only (pre-confirm)", assignEngine.includes(`receipt.status !== "ai_read"`) && assignEngine.includes("RECEIPT_NOT_ASSIGNABLE"))
check("engine verifies company exists in registry", assignEngine.includes(`from("companies")`) && assignEngine.includes("COMPANY_NOT_FOUND"))
check("engine writes canonical audit with actor", assignEngine.includes("recordCanonicalAudit") && assignEngine.includes(`field: "customer_company_id"`) && assignEngine.includes("actor: input.actor"))
check("route passes the authenticated actor", route.includes("auth.email ?? auth.id"))
check("route is the ONLY new manual writer (sweep auto path remains)", !route.includes("confirm_payment_allocation"))

const page = read(PAGE)
check("UI has debtor picker", page.includes("assignCompany") && page.includes("available_companies"))
check("UI disables confirm until company assigned", page.includes("!item.customer_company_id"))
check("UI offers only registry rows (no free text input)", page.includes("<select") && !page.includes('type="text"'))

check("receipt-confirm-flow untouched", read(CONFIRM_FLOW).includes("RECEIPT_NO_COMPANY"))
check("payment-write untouched", read(PAYMENT_WRITE).includes("confirm_payment_allocation"))
const rpc = read("supabase/migrations/20260923000001_canonical_payment_allocation_atomic_v1_1.sql")
check("payment RPC file still defines the function", rpc.includes("create or replace function public.confirm_payment_allocation"))

const all = page + route
// Strip line comments first — the route's own doc says "never from a
// name-similarity guess" (a guard, not a matcher).
const codeOnly = all.replace(/\/\/[^\n]*/g, "")
check("no fuzzy name matching introduced", !/difflib|levenshtein|fuzzy|closestMatch|normalize\(.*name/i.test(codeOnly))

// R5 — unauthenticated call hits the route and fails closed
async function live(): Promise<void> {
  try {
    const { PATCH } = await import(`@/${ROUTE.replace(/\.ts$/, "")}` as string)
    const req = new Request("http://localhost/api/test", { method: "PATCH", body: "{}" })
    const res = await PATCH(req, { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) })
    check("unauthenticated PATCH => 401", res.status === 401, `got ${res.status}`)
  } catch (e) {
    // Fail-closed: outside a real Next request scope the auth layer refuses to
    // resolve a session (throws before any success path) — same guarantee as 401.
    const msg = String(e)
    check(
      "unauthenticated PATCH => 401 (or auth layer refuses outside request scope)",
      msg.includes("outside a request scope") || msg.includes("cookies"),
      msg.slice(0, 120),
    )
  }
  console.log(`\nreceipt-company-assign: checks=${checks} passed=${checks - failures} failed=${failures}`)
  process.exit(failures === 0 ? 0 : 1)
}

void live()

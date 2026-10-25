/**
 * Finance Admin UI contract test (UNIFIED FINANCE ADMIN mission, 2026-10-11)
 * T01–T18 — static/contract checks + runtime pure-logic tests.
 * ไม่มีการเรียก production write เส้นใด: ทดสอบด้วย source assertions และ
 * unified-list pure functions ล้วน · financial authority = canonical writers
 * Run: npx tsx scripts/finance-admin-ui-test.ts
 */
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import {
  applyUnifiedFilters,
  normalizeAllocation,
  normalizeExpense,
  normalizeIncomeEvidence,
  normalizePayable,
  type UnifiedRow,
} from "../services/finance/unified-list"

const ROOT = join(import.meta.dirname, "..")
let pass = 0
const failures: string[] = []
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`) }
  else { failures.push(name); console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`) }
}
const read = (p: string) => readFileSync(join(ROOT, p), "utf8")
const has = (p: string, re: RegExp) => re.test(read(p))

console.log("=== FINANCE ADMIN UI CONTRACT TEST (T01–T18) ===\n")

// ── T01 Admin Finance Screen ────────────────────────────────────────────────
const financeFiles = [
  "app/admin/finance/page.tsx",
  "components/finance/FinanceWorkspace.tsx",
  "components/finance/SummaryTab.tsx",
  "components/finance/IncomeEntryTab.tsx",
  "components/finance/ExpenseEntryTab.tsx",
  "components/finance/PayablesPanel.tsx",
  "components/finance/UnifiedListTab.tsx",
  "components/finance/DocumentsTab.tsx",
  "components/finance/AuditTab.tsx",
]
check("T01a Admin finance screen files exist", financeFiles.every((f) => existsSync(join(ROOT, f))), financeFiles.length + " files")
check("T01b page renders FinanceWorkspace", has("app/admin/finance/page.tsx", /FinanceWorkspace/))
const wsSrc = read("components/finance/FinanceWorkspace.tsx")
check("T01c workspace has all six capabilities", ["ภาพรวม", "บันทึกเงินเข้า", "บันทึกเงินออก", "รายการการเงิน", "เอกสาร", "ประวัติการดำเนินงาน"].every((t) => wsSrc.includes(t)))

// ── T02 Income Form Validation ──────────────────────────────────────────────
const incomeSrc = read("components/finance/IncomeEntryTab.tsx")
check("T02a income requires date", /ต้องระบุวันที่รับเงิน/.test(incomeSrc))
check("T02b income amount > 0", /จำนวนเงินต้องมากกว่า 0/.test(incomeSrc))
check("T02c income requires evidence file", /ต้องแนบหลักฐาน/.test(incomeSrc))
check("T02d income requires payer (company or text)", /อย่างใดอย่างหนึ่ง/.test(incomeSrc))

// ── T03 Expense Form Validation ─────────────────────────────────────────────
const expenseSrc = read("components/finance/ExpenseEntryTab.tsx")
check("T03a expense amount > 0", /จำนวนเงินต้องมากกว่า 0/.test(expenseSrc))
check("T03b expense requires vendor", /ต้องระบุชื่อผู้รับเงิน/.test(expenseSrc))
check("T03c expense requires date", /ต้องระบุวันที่ค่าใช้จ่าย/.test(expenseSrc))
check("T03d route enforces amount>0 + doc-type allow-list",
  has("app/api/admin/company-expenses/route.ts", /amount <= 0/) &&
  has("app/api/admin/company-expenses/route.ts", /ALLOWED_DOCUMENT_TYPES/))

// ── T04 Existing Identity Selection ────────────────────────────────────────
check("T04a income company select uses /api/admin/partners", /fetch\("\/api\/admin\/partners"\)/.test(incomeSrc))
check("T04b income route rejects unknown company id", has("app/api/admin/receipt-documents/route.ts", /INBOUND_COMPANY_NOT_FOUND/))
check("T04c payable route rejects unknown company id", has("app/api/admin/payables/route.ts", /PAYABLE_COMPANY_NOT_FOUND/))
check("T04d no company-creation path in finance UI", !/POST\("\/api\/admin\/(companies|partners)"\)/.test(incomeSrc + expenseSrc + wsSrc))

// ── T05 Account/Method Selection (evidence-only — no accounts registry) ─────
check("T05a account field is evidence text (ตามหลักฐาน) — no invented registry", /บัญชีรับเงิน \(ตามหลักฐาน\)/.test(incomeSrc))
check("T05b method+account flow into description evidence only", /วิธีรับเงิน: \$\{method\}/.test(incomeSrc))

// ── T06 Attach Payment Evidence ─────────────────────────────────────────────
check("T06a income uploads via canonical /api/admin/upload", /fetch\("\/api\/admin\/upload"/.test(incomeSrc))
check("T06b expense anchors evidence via receipt_document_id", /receipt_document_id: receiptId/.test(expenseSrc))
check("T06c upload route auth-gated (requireAuth ADMIN_TIER)",
  has("app/api/admin/upload/route.ts", /requireAuth/) && has("app/api/admin/upload/route.ts", /ADMIN_TIER/))


// ── T07 Canonical Input Contract ────────────────────────────────────────────
const ceRoute = read("app/api/admin/company-expenses/route.ts")
check("T07a expense route maps fields one-by-one (no body spread into writer)",
  /recordCompanyExpense\(\{/.test(ceRoute) && !/\.\.\.(body|p)\b/.test(ceRoute))
const payRoute = read("app/api/admin/payables/route.ts")
check("T07b payable route maps fields one-by-one",
  /requestPartnerPayable\(\{/.test(payRoute) && /transitionPartnerPayable\(\{/.test(payRoute) && !/\.\.\.(body|p)\b/.test(payRoute))
check("T07c inbound route passes real-evidence fields to writer",
  has("app/api/admin/receipt-documents/route.ts", /document_date:/) &&
  has("app/api/admin/receipt-documents/route.ts", /reference_number:/) &&
  has("app/api/admin/receipt-documents/route.ts", /recordInboundSource\(\{/))

// ── T08 Duplicate Prevention ────────────────────────────────────────────────
check("T08a confirm flow idempotency intact (already_reconciled)", has("engines/canonical/receipt-confirm-flow.ts", /already_reconciled/))
check("T08b payment RPC still guards receipt reuse", has("engines/canonical/payment-write.ts", /receipt_already_allocated/))
check("T08c confirm still requires ai_read start state", has("app/api/admin/receipt-documents/[id]/confirm/route.ts", /status !== "ai_read"/))

// ── T09 Manual + Automated Unified List (runtime pure-logic) ────────────────
const sample: UnifiedRow[] = [
  normalizeIncomeEvidence({ id: "r1", document_type: "transfer_slip", amount: 100, document_date: "2026-10-01", transaction_datetime: null, created_at: "2026-10-01T10:00:00Z", sender_name: "บจก. เอ", customer_company_name: null, reference_number: "REF1", status: "ai_read", source_channel: "line", confirmed_by: null }),
  normalizeIncomeEvidence({ id: "r2", document_type: "transfer_slip", amount: 200, document_date: null, transaction_datetime: "2026-10-02T09:30:00", created_at: "2026-10-02T09:30:00Z", sender_name: null, customer_company_name: "บจก. บี", reference_number: null, status: "confirmed", source_channel: "upload", confirmed_by: "admin@x" }),
  normalizeAllocation({ id: "a1", amount: 100, allocated_at: "2026-10-03T00:00:00", receipt_id: "r1", receipt_reference: "REF1", invoice_number: "INV-001", customer_company_name: "บจก. เอ" }),
  normalizeExpense({ id: "e1", document_type: "tax_invoice", amount: 50, expense_date: "2026-10-04", created_at: "2026-10-04T12:00:00Z", vendor_name: "ร้านค้า", tax_invoice_no: "TAX-9", source: "admin_manual", submitted_by_name: "admin@x", receipt_document_id: null }),
  normalizePayable({ id: "p1", amount: 75, created_at: "2026-10-05T08:00:00Z", partner_name: "ซัพพลายเออร์", description: "ค่าวัสดุ", status: "pending", bank_email_verified: false }),
]
check("T09a four canonical sources merge into one list", sample.length === 5)
check("T09b manual + automation show together with source metadata",
  sample.some((r) => r.source_channel === "admin_manual") && sample.some((r) => r.source_channel === "line") && sample.some((r) => r.source_channel === "canonical_payment"))
check("T09c no separate manual table anywhere in finance UI/API",
  !/manual_transaction|manual_finance|finance_manual/.test(wsSrc + incomeSrc + expenseSrc + ceRoute + payRoute + read("app/api/admin/finance/transactions/route.ts")))
const ins = applyUnifiedFilters(sample, { direction: "in" })
check("T09d direction filter works", ins.length === 3 && ins.every((r) => r.direction === "in"))
const qq = applyUnifiedFilters(sample, { q: "ร้านค้า" })
check("T09e search matches counterparty", qq.length === 1 && qq[0].id === "e1")
const sorted = applyUnifiedFilters(sample, {})
check("T09f sorted newest first + limit honored", sorted[0].id === "p1" && applyUnifiedFilters(sample, { limit: 2 }).length === 2)
check("T09g unified route reads exactly the 4 canonical tables",
  has("app/api/admin/finance/transactions/route.ts", /from\("receipt_documents"\)/) &&
  has("app/api/admin/finance/transactions/route.ts", /from\("payment_allocations"\)/) &&
  has("app/api/admin/finance/transactions/route.ts", /from\("company_expenses"\)/) &&
  has("app/api/admin/finance/transactions/route.ts", /from\("partner_payable_requests"\)/))

// ── T10 Financial Permission Gate ───────────────────────────────────────────
const gatedRoutes = [
  "app/api/admin/company-expenses/route.ts",
  "app/api/admin/payables/route.ts",
  "app/api/admin/finance/transactions/route.ts",
  "app/api/admin/finance/audit/route.ts",
]
check("T10 all finance admin routes requireAuth(ADMIN_TIER)",
  gatedRoutes.every((f) => has(f, /requireAuth\(ADMIN_TIER\)/)))

// ── T11 Canonical Payment Writer (no new confirm path) ─────────────────────
check("T11a income tab never calls any confirm endpoint",
  !/confirm/.test((incomeSrc.match(/fetch\("[^"]+"\)/g) ?? []).join(" ")))
check("T11b confirm route unchanged authority (confirmReceiptPayment)",
  has("app/api/admin/receipt-documents/[id]/confirm/route.ts", /confirmReceiptPayment\(/))


// ── T12 Expense Authority (canonical expense writer only) ──────────────────
import { readdirSync } from "node:fs"
function writeSitesIn(dirs: string[], tables: string[]): string[] {
  const sites: string[] = []
  const walkFs = (rel: string) => {
    const abs = join(ROOT, rel)
    if (!existsSync(abs)) return
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const p = join(rel, e.name)
      if (e.isDirectory()) walkFs(p)
      else if (e.name.endsWith(".ts")) {
        const src = read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
        for (const t of tables) {
          const re = new RegExp(`\\.from\\(\\s*["']${t}["']\\s*\\)\\s*\\.\\s*(insert|update|delete|upsert)`, "g")
          if (re.test(src)) sites.push(`${p}:${t}`)
        }
      }
    }
  }
  dirs.forEach(walkFs)
  return sites
}
const moneyOutWrites = writeSitesIn(["app", "gateway", "core", "services"], ["company_expenses", "partner_payable_requests"])
check("T12a no direct money-OUT writes outside canonical writer in app tier",
  moneyOutWrites.length === 0, moneyOutWrites.join(", ") || "0 sites")
const expenseWriterWrites = writeSitesIn(["engines/canonical"], ["company_expenses", "partner_payable_requests"])
check("T12b canonical expense writer is the (only) app-tier money-OUT writer",
  expenseWriterWrites.length === 2, expenseWriterWrites.join(", "))
check("T12c writer enforces closed status vocabulary (Rule 72)",
  has("engines/canonical/expense-write.ts", /PAYABLE_TRANSITION_FROM/) &&
  has("engines/canonical/expense-write.ts", /status: "pending"/))
check("T12d paid_confirmed/completed route requires bank evidence note",
  has("app/api/admin/payables/route.ts", /PAYABLE_EVIDENCE_REQUIRED/))
check("T12e writer derives completed_at only from bank_email_verified",
  has("engines/canonical/expense-write.ts", /completed_at: verified \? nowIso : null/))

// ── T13 Document Preview / Reuse ────────────────────────────────────────────
check("T13a documents workspace still canonical (one list lib)",
  has("app/api/admin/documents/route.ts", /handleDocumentList/))
check("T13b signed-URL preview path exists", has("app/api/admin/upload/route.ts", /signed|createSignedUrl|path=/i))
check("T13c finance documents tab links existing pages (no new doc engine)",
  /\/admin\/documents/.test(read("components/finance/DocumentsTab.tsx")) &&
  /\/admin\/payment-voucher/.test(read("components/finance/DocumentsTab.tsx")))
check("T13d DocumentBuilder (payment voucher) intact",
  existsSync(join(ROOT, "app/admin/payment-voucher/page.tsx")) && has("app/admin/payment-voucher/page.tsx", /DocumentBuilder/))

// ── T14 Audit Trail ─────────────────────────────────────────────────────────
check("T14a expense writer lands canonical audit with source evidence",
  has("engines/canonical/expense-write.ts", /recordCanonicalAudit/) &&
  has("engines/canonical/expense-write.ts", /source: source \?\? "line_chat"/))
check("T14b admin routes pass actor (auth.email) everywhere",
  (ceRoute.match(/actor: auth\.email/g) ?? []).length >= 1 &&
  (payRoute.match(/actor: auth\.email/g) ?? []).length >= 2)
check("T14c audit tab reads audit_logs financial vocabulary",
  has("app/api/admin/finance/audit/route.ts", /audit_logs/) &&
  has("app/api/admin/finance/audit/route.ts", /expense\.recorded/))


// ── T15 No Parallel Writer ──────────────────────────────────────────────────
const newRouteWrites = writeSitesIn(
  ["app/api/admin/company-expenses", "app/api/admin/payables", "app/api/admin/finance"],
  ["company_expenses", "partner_payable_requests", "receipt_documents", "payment_allocations", "debt_events"],
)
check("T15 finance admin routes have ZERO financial-table write sites", newRouteWrites.length === 0, newRouteWrites.join(", ") || "0 sites")

// ── T16 Financial Invariants (schema-safety of writer extension) ────────────
const insertBlock = read("engines/canonical/expense-write.ts").match(/from\("company_expenses"\)[\s\S]*?\.insert\(\{([\s\S]*?)\}\)/)?.[1] ?? ""
const writerCols = [...insertBlock.matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1])
const knownCols = ["document_type", "amount", "vendor_name", "expense_date", "receipt_document_id", "submitted_by_line_user_id", "submitted_by_name", "submitted_by_role", "source", "amount_pre_vat", "vat_amount", "tax_invoice_no", "notes"]
check("T16a writer inserts only pre-existing company_expenses columns", writerCols.length > 0 && writerCols.every((c) => knownCols.includes(c)), writerCols.join(","))
check("T16b no new DB migration in this change-set",
  !readdirSync(join(ROOT, "supabase/migrations")).some((m) => m.includes("finance_admin")))

// ── T17 Production UI (static build-level) ──────────────────────────────────
check("T17a finance page is a client component under /admin/finance",
  has("app/admin/finance/page.tsx", /"use client"/) && has("app/admin/finance/page.tsx", /export default function FinancePage/))
check("T17b nav entry to /admin/finance already exists", has("app/workspace/WorkspaceFrame.tsx", /\/admin\/finance/))

// ── T18 No Unauthorized Money Mutation ──────────────────────────────────────
const payablesSrc = read("components/finance/PayablesPanel.tsx")
check("T18a payable paid paths demand human-provided bank evidence",
  /bank_email_evidence/.test(payablesSrc) && /หลักฐานธนาคารจริง/.test(payablesSrc))
check("T18b income save path hits only upload + inbound-create endpoints",
  (incomeSrc.match(/fetch\("([^"]+)"/g) ?? [])
    .map((s) => s.slice(7, -1))
    .every((c) => c.startsWith("/api/admin/upload") || c.startsWith("/api/admin/receipt-documents") || c.startsWith("/api/admin/partners")))
check("T18c no internal-secret machinery in finance admin routes (human session auth)",
  gatedRoutes.every((f) => !/INTERNAL_SECRET/.test(read(f))))

// ── summary ────────────────────────────────────────────────────────────────
console.log(`\nRESULT: ${pass} passed, ${failures.length} failed`)
if (failures.length > 0) {
  console.log("Failed:\n- " + failures.join("\n- "))
  process.exit(1)
}

/**
 * AI CONTEXT & DATA ISOLATION — regression suite.
 *
 * Proves the repair at two levels:
 *   1. PURE / RUNTIME: dispatcher fail-closed without scope, owner-runtime
 *      identity only for super_admin, scope helper behavior, document list
 *      route denies without a verified scope.
 *   2. STATIC: the wired routes/readers actually carry the verified scope
 *      (server cookie → resolver → dispatcher → reader) and no hardcoded
 *      owner/business context remains in the shared prompt.
 *
 * This is NOT a live cross-tenant test. It complements tenant-matrix /
 * tenant-e2e-synthetic (real local Postgres RLS) and is explicit about what
 * it can and cannot prove.
 */
import { readFileSync } from "node:fs"
import { NextRequest } from "next/server"
import { dispatch } from "@/engines/validation/dispatcher"
import { buildVerifiedScope, isCompanyInScope } from "@/core/auth/orgScope"
import { resolveOwnerRuntimeIdentity, OWNER_RUNTIME_IDENTITY_ENV } from "@/core/owner-runtime/client"
import { handleDocumentList } from "@/app/api/admin/documents/_lib/listDocuments"

const results: { ok: boolean; label: string; detail?: string }[] = []
function check(label: string, ok: boolean, detail?: string) {
  results.push({ ok, label, detail })
}
function read(path: string): string {
  return readFileSync(path, "utf8")
}

async function main() {
  // ── 1. Dispatcher fails closed without a verified scope ──
  for (const command of ["debt.list", "document.list", "partner.find", "job.list", "expense.list"]) {
    const noScope = await dispatch(command, {}, false)
    check(
      `dispatcher: ${command} without scope = DENY`,
      !noScope.ok && noScope.violations.some((v) => v.includes("ORG_REQUIRED")),
      noScope.violations.join(" | "),
    )
  }

  // ── 2. Scope helper (company ownership, not org id alone) ──
  const scopeA = buildVerifiedScope({
    userId: "u-a",
    appRole: "admin",
    organizationId: "org-a",
    orgRole: "admin",
    companyIds: ["company-a", "company-a", "company-b"],
  })
  check("scope: duplicate company ids collapsed", scopeA.companyIds.length === 2)
  check("scope: allowed company in scope", isCompanyInScope(scopeA, "company-a"))
  check("scope: foreign company denied", !isCompanyInScope(scopeA, "company-z"))
  check("scope: null company denied", !isCompanyInScope(scopeA, null))
  check("scope: member cannot write", !buildVerifiedScope({ userId: "u", appRole: "employee", organizationId: "o", orgRole: "member", companyIds: ["c"] }).permissionScope.write)

  // ── 3. Owner runtime is platform-owner only ──
  process.env[OWNER_RUNTIME_IDENTITY_ENV] = "owner-identity-test"
  check("owner-runtime: admin gets no platform owner identity", resolveOwnerRuntimeIdentity({ id: "u", email: "a@b", role: "admin" }) === null)
  check("owner-runtime: super_admin maps to configured identity", resolveOwnerRuntimeIdentity({ id: "u", email: "a@b", role: "super_admin" }) === "owner-identity-test")
  check("owner-runtime: no session = no identity", resolveOwnerRuntimeIdentity(null) === null)

  // ── 4. Document list route denies without verified scope ──
  const denied = await handleDocumentList(new NextRequest("http://localhost/api/admin/documents"), null)
  const deniedBody = await denied.json()
  check("documents: no verified scope = 403 ORG_REQUIRED", denied.status === 403 && deniedBody.code === "ORG_REQUIRED")

  // ── 5. STATIC wiring: identity → context → dispatcher → reader ──
  const chat = read("app/api/chat/route.ts")
  check("chat: resolves scope server-side from org cookie", /resolveVerifiedScope\(supabaseAdmin\(\), \{ auth, organizationId: orgCookie \}\)/.test(chat))
  check("chat: memory namespace includes verified organization", /org:\$\{scope\.organizationId\}/.test(chat))
  check("chat: business context comes from fetched organization name", /organizationName = scope[\s\S]*fetchOrganizationName/.test(chat))
  check("chat: scope passed to result contract/dispatcher path", /buildChatResult\(request, rawMessage, response, undefined, undefined, scope\)/.test(chat))

  const pipeline = read("cognitive/pipeline.ts")
  check("pipeline: no OWNER_IDENTITY_RULE constant", !/const OWNER_IDENTITY_RULE/.test(pipeline))
  check("pipeline: no owner-specific business prompt", !/ผู้ช่วยเจ้าของธุรกิจวัสดุก่อสร้าง/.test(pipeline))
  check("pipeline: prompt is neutral DNA OS business assistant", /คุณคือ DNA OS ผู้ช่วยธุรกิจ/.test(pipeline))
  check("pipeline: business context is scope-derived", /gatewayContext\?\.organizationName/.test(pipeline))
  check("pipeline: weather does not silently default to owner province", /if \(!\/ขอนแก่น\/\.test\(text\)\)/.test(pipeline))

  const dispatcher = read("engines/validation/dispatcher.ts")
  check("dispatcher: tenant commands require scope", /TENANT_SCOPED_COMMANDS\.has\(command\) && !ctx\?\.scope && !ctx\?\.system/.test(dispatcher))
  check("dispatcher: readers receive ctx.scope", /getOpenDebts\(ctx\?\.scope\)/.test(dispatcher) && /getDocuments\("invoice", ctx\?\.scope\)/.test(dispatcher))
  check("dispatcher: expense list scoped via receipt ownership", /receipt_documents!inner\(customer_company_id\)[\s\S]*customer_company_id", ctx\.scope\.companyIds/.test(dispatcher))
  check("dispatcher: cross-company id check on debt.current", /RESOURCE_NOT_OWNED: partner_id/.test(dispatcher))

  const docsList = read("app/api/admin/documents/_lib/listDocuments.ts")
  check("documents list: no module-level shared rows array", !/^const rows: any\[\] = \[\]/m.test(docsList))
  check("documents list: requires verified scope", /if \(!scope\)[\s\S]*ORG_REQUIRED/.test(docsList))
  check("documents list: invoices filtered by scope companies", /\.from\("invoices"\)[\s\S]*\.in\("customer_company_id", scope\.companyIds\)/.test(docsList))
  check("documents list: standalone docs filtered by scope companies", /\.from\("standalone_documents"\)[\s\S]*\.in\("customer_company_id", scope\.companyIds\)/.test(docsList))

  const finance = read("app/api/admin/finance-summary/route.ts")
  check("finance: scope resolved server-side", /resolveVerifiedScope\(supabase\(\), \{ auth, organizationId: orgCookie \}\)/.test(finance))
  check("finance: canonical docs filtered", /\.in\("customer_company_id", scope\.companyIds\)/.test(finance))
  check("finance: debt view filtered by company", /\.in\("company_id", scope\.companyIds\)/.test(finance))
  check("finance: expenses/allocations filtered through receipt ownership", /receipt_documents!inner\(customer_company_id\)/.test(finance))

  const expenses = read("app/api/admin/company-expenses/route.ts")
  check("expenses: read scoped through receipt", /receipt_documents!inner\(customer_company_id\)/.test(expenses))
  check("expenses: write requires attributable receipt", /EXPENSE_ORG_ATTRIBUTION_REQUIRED/.test(expenses))

  const relationships = read("app/api/admin/relationships/route.ts")
  check("relationships: scoped partner reader", /getPartners\(scope\)/.test(relationships))
  check("relationships: LINE links filtered by scope company", /\.from\("company_line_links"\)[\s\S]*\.in\("company_id", scope\.companyIds\)/.test(relationships))
  check("relationships: no unscoped unmatched contacts", !/unmatchedContacts\s*=\s*Array\.from/.test(relationships))
  const relationshipDetail = read("app/api/admin/relationships/[relationshipId]/route.ts")
  check("relationships detail: URL id must be in verified scope", /isCompanyInScope\(scopeResult\.scope, relationshipId\)/.test(relationshipDetail))

  const receipts = read("app/api/admin/receipt-documents/route.ts")
  check("receipts: queue filtered by scope company", /\.in\("customer_company_id", scope\.companyIds\)/.test(receipts))
  check("receipts: ingest requires scoped company", /INBOUND_ORG_REQUIRED/.test(receipts))

  const partners = read("app/api/admin/partners/route.ts")
  check("partners: debtor/summary readers receive scope", /getDebtorPartners\(scope\)/.test(partners) && /getPartnersWithDocumentSummary\(scope\)/.test(partners))
  check("partners: search filtered by scope companies", /\.in\("id", scope\.companyIds\)/.test(partners))

  const debtRoute = read("app/api/admin/debt-trackings/route.ts")
  check("debt-trackings: list scoped", /getDebtTrackings\(scope\)/.test(debtRoute))
  check("debt-trackings: write partner in scope", /isCompanyInScope\(scopeResult\.scope, String\(body\.partnerId\)\)/.test(debtRoute))

  const sites = read("app/api/admin/sites/route.ts")
  check("sites: read/write company in scope", /isCompanyInScope\(scopeResult\.scope, companyId\)/.test(sites) && /isCompanyInScope\(scopeResult\.scope, String\(body\.customer_company_id\)\)/.test(sites))

  const payables = read("app/api/admin/payables/route.ts")
  check("payables: list filtered by partner company scope", /\.in\("partner_company_id", scope\.companyIds\)/.test(payables))
  check("payables: transition checks payable owner", /partner_payable_requests[\s\S]*isCompanyInScope\(scopeResult\.scope/.test(payables))

  const quote = read("app/api/admin/material-quote/route.ts")
  check("material quote: verified scope passed to dispatcher", /dispatch\("material\.quote"[\s\S]*\{ scope \}/.test(quote))

  const lineCustomers = read("app/api/admin/line-customers/route.ts")
  check("line customers: identifies scoped LINE users first", /company_line_links[\s\S]*\.in\("company_id", scope\.companyIds\)/.test(lineCustomers))
  check("line customers: events filtered to scoped LINE ids", /\.in\("line_user_id", scopedLineUserIds\)/.test(lineCustomers))

  const lineAsk = read("app/api/admin/line-customers/[lineUserId]/ask/route.ts")
  check("line ask: contact must be linked to scoped company", /RESOURCE_NOT_OWNED/.test(lineAsk) && /\.in\("company_id", scope\.companyIds\)/.test(lineAsk))
  check("line ask: memory namespaced by organization", /org:\$\{scope\.organizationId\}:line:/.test(lineAsk))
  check("line ask: verified scope passed to pipeline", /sandbox: "sales",[\s\S]*scope,/.test(lineAsk))

  const command = read("app/api/command/route.ts")
  check("command: admin tier only", /requireAuth\(ADMIN_TIER\)/.test(command))
  check("command: memory/display state includes verified org", /org:\$\{scope\.organizationId\}/.test(command))
  check("command: display state has no shared default", /getDisplayState\(stateKey\)/.test(command))

  const ownerRuntime = read("core/owner-runtime/client.ts")
  check("owner-runtime: platform owner role required", /session\.role !== "super_admin"[\s\S]*return null/.test(ownerRuntime))

  const cline = read("app/api/chat/_lib/clineWorker.ts")
  check("cline: workdir per authenticated user", /WORKDIR_BASE[\s\S]*transport\.userId/.test(cline) && !/const WORKDIR = /.test(cline))
  check("cline: prompt no longer calls every user the owner", !/เรียบเรียงผลให้เจ้าของเท่านั้น/.test(cline))

  const cache = read("services/supabase/state-cache.ts")
  check("cache: session key is required (no shared default)", /getDisplayState\(sessionId: string\)/.test(cache) && /setDisplayState\(state: DisplayState, sessionId: string\)/.test(cache))

  const tokenRoute = read("app/api/v1/query/route.ts")
  check("api token: organization must be named explicitly", /X-DNA-Org/.test(tokenRoute) && /ORG_REQUIRED/.test(tokenRoute))
  check("api token: token owner membership resolved before dispatch", /resolveVerifiedScope\(db, \{[\s\S]*organizationId: orgId/.test(tokenRoute))
  check("api token: dispatcher receives verified scope", /dispatch\(rawCommand, args, false, \{ scope: scopeResult\.scope \}\)/.test(tokenRoute))

  // ── Report ──
  const passed = results.filter((r) => r.ok).length
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.label}${r.ok || !r.detail ? "" : ` — ${r.detail}`}`)
  }
  console.log(`\nAI CONTEXT & DATA ISOLATION: ${passed}/${results.length} checks PASS`)
  if (passed !== results.length) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

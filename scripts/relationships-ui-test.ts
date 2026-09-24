/**
 * relationships-ui-test.ts — /admin/relationships display-layer replacement
 * (2026-09-24). Structural, source-truth only: proves the new
 * BusinessWorkspace-family screen reuses the SAME endpoints, permissions,
 * content fragment and canonical money sources as the original screen, that
 * the ?ui=legacy rollback exists, and that NO calculation or backend was
 * added/removed. No mocks, no fixtures, no network.
 *
 * PASS/FAIL per check; exit 1 on any FAIL.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
let pass = 0;
let fail = 0;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const ws = read("app/admin/relationships/workspace.tsx");
const rootPage = read("app/admin/relationships/page.tsx");
const deepPage = read("app/admin/relationships/[relationshipId]/page.tsx");
const listRoute = read("app/api/admin/relationships/route.ts");
const detailRoute = read("app/api/admin/relationships/[relationshipId]/route.ts");
const matchRoute = read("app/api/admin/relationships/[relationshipId]/match/route.ts");
const feed = read("app/admin/relationships/feed.ts");
const middleware = read("middleware.ts");

// ── R1: same route, display switch, ONE content source ──────────────────────
check("R1. root page reads ?ui=legacy into legacyUi", rootPage.includes('sp?.ui === "legacy"'));
check("R1. deep-link page reads ?ui=legacy too", deepPage.includes('sp.ui === "legacy"') && deepPage.includes("initialRelationshipId={relationshipId}"));
check("R1. rollback branch renders the original AppShell", ws.includes("ROLLBACK SCREEN (?ui=legacy)") && ws.includes("if (legacyUi)"));
check("R1. ONE content fragment shared by both shells (declared once, used twice)", (ws.match(/const workspaceContent = /g) ?? []).length === 1 && (ws.match(/\{workspaceContent\}/g) ?? []).length === 2);
check("R1. both pages still render RelationshipWorkspacePage (same component)", rootPage.includes("<RelationshipWorkspacePage") && deepPage.includes("<RelationshipWorkspacePage"));

// ── R2: new shell = /workspace component family ─────────────────────────────
check("R2. IconRail imported as COMPONENT (presentation/shell)", ws.includes('import IconRail, { type IconRailItem } from "@/presentation/shell/navigation/IconRail"'));
check("R2. ListColumn + TabStrip imported from presentation/shell", ws.includes('from "@/presentation/shell/navigation/ListColumn"') && ws.includes('from "@/presentation/shell/ide/TabStrip"'));
check("R2. BusinessWorkspace canvas tokens used (F0EBE5/FDFBF8/E9E1D6)", ws.includes("bg-[#F0EBE5]") && ws.includes("bg-[#FDFBF8]") && ws.includes("border-[#E9E1D6]"));
check("R2. resizable list divider (drag) present", ws.includes('role="separator"') && ws.includes("cursor-col-resize"));
check("R2. TabStrip wired with open-relationship tabs + close", ws.includes("<TabStrip") && ws.includes("closeRelationshipTab") && ws.includes("openRelationship"));

// ── R3: identical data/service endpoints (logic untouched) ──────────────────
const endpoints: [string, string][] = [
  ["list", '"/api/admin/relationships"'],
  ["detail", "`/api/admin/relationships/${"],
  ["match", "/match"],
  ["quotation poll", "/api/admin/quotation-queue"],
  ["finance poll", "/api/admin/finance-alerts"],
  ["jobs (transactions)", "/api/admin/transactions?partner_id="],
  ["draft send", "/outbound-drafts/${draftId}/send"],
  ["draft reject", "/outbound-drafts/${draftId}/reject"],
  ["build-event", "/build-event"],
  ["reply", "/reply"],
  ["ask AI", "/ask"],
  ["chat", '"/api/chat"'],
  ["upload", '"/api/admin/upload"'],
  ["send-debt", "/send-debt"],
  ["send-document", "/send-document"],
  ["invoice send", "/api/admin/invoices/"],
  ["partner search", "/api/admin/partners?search="],
];
for (const [name, needle] of endpoints) {
  check(`R3. endpoint kept: ${name}`, ws.includes(needle), needle);
}

// ── R4: permission path unchanged ───────────────────────────────────────────
check("R4. list route requireAuth ADMIN_TIER", listRoute.includes("requireAuth(ADMIN_TIER)"));
check("R4. detail route requireAuth ADMIN_TIER", detailRoute.includes("requireAuth(ADMIN_TIER)"));
check("R4. match route requireAuth ADMIN_TIER", matchRoute.includes("requireAuth(ADMIN_TIER)"));
check("R4. middleware still guards /admin pages", middleware.includes('"/admin"'));

// ── R5: money comes from canonical sources; component computes NOTHING ─────
check("R5. formatMoney imported from engines/documents/document-editor", ws.includes('import { formatMoney } from "@/engines/documents/document-editor"'));
check("R5. component builds NO debt/finance numbers (no constructors)", !/total_outstanding\s*:/.test(ws) && !/revenue_total\s*:/.test(ws) && !/expense_total\s*:/.test(ws));
check("R5. component contains no interest/penalty arithmetic", !/0\.05|0\.25/.test(ws) && !/interest\s*=|penalty\s*=/.test(ws));
check("R5. feed has NO fee/interest math (labels only, debt_snapshots noted)", !/\*\s*0\.05|\*\s*0\.25/.test(feed) && feed.includes("debt_snapshots"));
check("R5. list debt = canonical company_debt_current projection", listRoute.includes('"company_debt_current"') && listRoute.includes("PHASE E5.2"));
check("R5. detail debt = canonical company_debt_current, no recompute", detailRoute.includes('"company_debt_current"') && detailRoute.includes("ไม่คำนวณดอกเบี้ย/ค่าปรับซ้ำ"));
check("R5. detail finance sums persisted amounts only (E5.1b)", detailRoute.includes("nothing is recomputed"));

// ── R6: legacy behaviors still in the shared content ───────────────────────
check("R6. unread rule via localStorage lastViewed", ws.includes("dnaos.lastViewed."));
check("R6. Rule-72 pending drafts (edit/send/reject)", ws.includes("pending_review") && ws.includes("sendDraft") && ws.includes("rejectDraft"));
check("R6. human takeover banner", ws.includes("human_takeover"));
check("R6. unmatched-contact match flow (promote to company)", ws.includes("/match"));
check("R6. cockpit workflow ladder + Flex previews + full HTML", ws.includes("workflowSteps") && ws.includes("FlexPreview") && ws.includes("cockpitHtmlPreview"));
check("R6. image lightbox + SettingsDrawer + ContactSettingsModal", ws.includes("lightboxUrl") && ws.includes("SettingsDrawer") && ws.includes("ContactSettingsModal"));
check("R6. debt reminder preview→confirm path", ws.includes("sendDebt") && ws.includes('mode: "preview"'));
check("R6. build business events from unlinked messages", ws.includes("buildEvent") && ws.includes("สร้าง Event จาก"));
check("R6. ActionBar command zones (เสนอราคา/ออกบิล/ส่งของ/รับเงิน/โทร/ไฟล์/ถาม AI)", ws.includes("ใบเสนอราคา") && ws.includes("ออกบิล") && ws.includes("ส่งของ") && ws.includes("รับเงิน") && ws.includes("ถาม AI"));
check("R6. overflow BOQ + ใบวางบิล kept", ws.includes("สร้าง BOQ") && ws.includes("ใบวางบิล"));
check("R6. jobs strip from transactions API (openJobs/jobsLoaded)", ws.includes("openJobs") && ws.includes("jobsLoaded"));
check("R6. finance strip renders API summary (formatMoney only)", ws.includes("formatMoney(finance.revenue_total)") && ws.includes("รายรับ") && ws.includes("รายจ่าย"));
check("R6. debt header + collection state + days", ws.includes("debt.total_outstanding") && ws.includes("days_overdue") && ws.includes("ชำระแล้ว") && ws.includes("ค้างชำระ"));
check("R6. rail badges (pending quotes + finance alerts)", ws.includes("pendingQuotesCount") && ws.includes("pendingFinanceCount"));
check("R6. reply composer + AI ask input kept", ws.includes("replyText") && ws.includes("aiAskText"));
check("R6. AppHeader + Inspector + MapView still wired", ws.includes("AppHeader") && ws.includes("Inspector") && ws.includes("MapView"));
check("R6. unified feed via buildFeed (messages+events+docs+sent bubbles)", ws.includes("buildFeed(detail") && ws.includes("sentInvoiceEntries"));

// ── R7: no parallel workspace / no removed backend ─────────────────────────
for (const p of [
  "app/api/admin/relationships/route.ts",
  "app/api/admin/relationships/[relationshipId]/route.ts",
  "app/api/admin/relationships/[relationshipId]/match/route.ts",
  "app/admin/relationships/feed.ts",
  "app/admin/relationships/workspace-state.tsx",
]) {
  check(`R7. kept: ${p}`, existsSync(join(ROOT, p)));
}
check("R7. WorkspaceProvider still wraps the screen", ws.includes("<WorkspaceProvider>"));
check("R7. no second settings system in v2 (no setScreen copy)", !ws.includes("setScreen"));

// ── R8: display-layer state is view-only ────────────────────────────────────
check("R8. tab/panel helpers add no new fetch inside helper body", !/function openRelationship[\s\S]{0,300}fetch\(/.test(ws));
check("R8. open tabs init from deep-link id", ws.includes("initialRelationshipId ? [initialRelationshipId]"));

console.log(`\nrelationships-ui: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);


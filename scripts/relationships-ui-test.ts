/**
 * relationships-ui-test.ts — /admin/relationships display-layer replacement
 * (2026-09-24; contract ปรับตาม START-HERE ข้อ17/22 dna-ui-master-template
 * 2026-09-25: shell = WorkspaceFrame โดยตรง, ?ui=legacy/rollback branch
 * ถูกลบ — ย้อนกลับผ่าน Git เท่านั้น). ONE SURFACE ONE PATH (owner 2026-09-25):
 * ไม่มี top bar (HomeBackBar/AppHeader) · ไม่มีแท็บสองโหมด · ไม่มี sidebar รายชื่อ
 * ถาวร · ไม่มี composer ที่สอง — รายชื่ออยู่ใน messagePanel ของ frame, canvas กลาง
 * เปลี่ยน context ตาม entity, ONE composer ด้านล่าง. Structural, source-truth only: proves
 * the screen reuses the SAME endpoints, permissions, ONE content fragment and
 * canonical money sources as the original screen, and that NO calculation or
 * backend was added/removed. No mocks, no fixtures, no network.
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
const adminLayout = read("app/admin/layout.tsx");
const frameSrc = read("app/workspace/WorkspaceFrame.tsx");

// ── R1: same route, display switch, ONE content source ──────────────────────
check("R1. root page renders the frame shell — no ?ui=legacy switch (START-HERE ข้อ17/22: ไม่มีปุ่ม/เส้นทางกลับ UI เก่า)", rootPage.includes("<RelationshipWorkspacePage") && !rootPage.includes("legacyUi"));
check("R1. deep-link page keeps initialRelationshipId + legacy switch removed", deepPage.includes("initialRelationshipId={relationshipId}") && !deepPage.includes("legacyUi"));
check("R1. old AppShell rollback branch deleted (rollback = git per ข้อ22, marker comment kept)", !ws.includes("if (legacyUi)") && !ws.includes("<AppShell") && ws.includes("ROLLBACK SCREEN (?ui=legacy) DELETED"));
check("R1. ONE content fragment, ONE render site (declared once, used once as the entity canvas)", (ws.match(/const workspaceContent = /g) ?? []).length === 1 && (ws.match(/\{activeId \? workspaceContent : null\}/g) ?? []).length === 1);
check("R1. both pages still render RelationshipWorkspacePage (same component)", rootPage.includes("<RelationshipWorkspacePage") && deepPage.includes("<RelationshipWorkspacePage"));
check("F. no HomeBackBar on active business surface (admin layout ไม่ mount — แถบดำ ย้อนกลับ/หน้าหลัก หายจาก presentation; capability ยังอยู่)", !adminLayout.includes("<HomeBackBar") && !adminLayout.includes("HomeBackBar />"));
check("F. frame: no permanent header + no tabs (centerTab/data-view) + ล็อกจอ 100dvh + msg-panel เปิดตามดีมานด์", !frameSrc.includes("<header") && !frameSrc.includes("centerTab") && !frameSrc.includes("data-view=") && frameSrc.includes("height:100dvh") && frameSrc.includes(".msg-panel") && frameSrc.includes("panelIsOpen && messagePanel"));
check("F. exactly one WorkspaceFrame mount (ACTIVE_SHELL_COUNT=1)", (ws.match(/<WorkspaceFrame/g) ?? []).length === 1);
check("F. exactly one composer ทั้งผืน (COMPOSER_COUNT=1 — มีแค่ใน frame ไม่มีใน relationship content)", (frameSrc.match(/className="compose"/g) ?? []).length === 1 && (ws.match(/className="compose"/g) ?? []).length === 0);

// ── R2: new shell = /workspace component family ─────────────────────────────
check("R2. shell = WorkspaceFrame from app/workspace (START-HERE ข้อ17 — UI ใหม่โดยตรง); IconRail retired from this page", ws.includes('import { WorkspaceFrame } from "@/app/workspace/WorkspaceFrame"') && ws.includes("<WorkspaceFrame") && !ws.includes("import IconRail"));
check("F. no permanent ListColumn (exactly 1 ตัว และอยู่ใน messagePanel = เปิดตามดีมานด์) + no TabStrip", ws.includes('from "@/presentation/shell/navigation/ListColumn"') && (ws.match(/<ListColumn/g) ?? []).length === 1 && ws.indexOf("messagePanel={") >= 0 && ws.indexOf("<ListColumn") > ws.indexOf("messagePanel={") && !ws.includes('ide/TabStrip') && !ws.includes("<TabStrip"));
check("F. no resizable relationship sidebar + ไม่มี top bar/แท็บ/composer ที่สอง (AppHeader/TabStrip/drag-divider/reply/ask inputs)", !ws.includes("<AppHeader") && !ws.includes("<TabStrip") && !ws.includes('role="separator"') && !ws.includes("cursor-col-resize") && !ws.includes("value={replyText}") && !ws.includes("value={aiAskText}"));
check("R2. contact list lives in the top-right message panel (messagePanel + controlled open)", ws.includes("messagePanel={") && ws.includes("panelOpen={panelOpen}") && ws.includes("onPanelOpenChange={setPanelOpen}"));
check("R2. TabStrip→panel: selecting in the message panel opens the entity via openRelationship + closes panel", /onSelect=\{\(id\) => \{[\s\S]{0,80}openRelationship\(id\)/.test(ws) && ws.includes("setPanelOpen(false)"));

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
check("R6. ONE composer (owner 2026-09-25): ไม่มี input ตอบ/ถาม ที่สอง + composerContext ผูก entity", !ws.includes("value={replyText}") && !ws.includes("value={aiAskText}") && ws.includes("composerContext={"));
check("F/E. Workspace composer always uses authenticated /api/chat; LINE reply stays an explicit Messages action", frameSrc.includes('fetch("/api/chat"') && frameSrc.includes('Accept: "text/event-stream"') && !frameSrc.includes("/api/admin/line-customers/") && ws.includes("const sendReply") && ws.includes("/api/admin/line-customers/${lineUserId}/reply") && existsSync("app/api/admin/line-customers/[lineUserId]/reply/route.ts"));
check("F. business logic เดิมเก็บครบ (sendReply/askAi/runCommand/buildFeed — เปลี่ยนแค่ presentation)", ws.includes("const sendReply") && ws.includes("const askAi") && ws.includes("const runCommand") && ws.includes("buildFeed(detail"));
check("R6. Inspector + MapView kept in canvas; AppHeader bar ถูกถอด (ONE SURFACE)", ws.includes("<Inspector") && ws.includes("<MapView") && !ws.includes("<AppHeader"));
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
// ONE NAVIGATION: deep-link เลือก entity ตอน mount = selectRelationship (capability จริง)
check("R8. deep-link id still selects the relationship on load", ws.includes("if (initialRelationshipId) selectRelationship(initialRelationshipId)"));
// และ state แท็บเก่า (openRelIds/tab strip) ต้องไม่กลับมา
check("R8. old tab state stays deleted (openRelIds/closeRelationshipTab/listWidth)", !ws.includes("openRelIds") && !ws.includes("closeRelationshipTab") && !ws.includes("listWidth"));

// ── F8: ONE CHAT BOARD (Owner 2026-09-25 "ยุบความสามารถทั้งหมดมาไว้ที่ตัวใหม่
//      แล้วก็ตัดหน้าจอที่ชี้ไปหาเลขาส่วนตัวออกให้หมด") ─────────────────────
check(
  "F8. secretary board ถูกตัดออกจริง (ไม่มี SecretaryChat.tsx + ไม่มีหน้า /admin/dashboard)",
  !existsSync(join(ROOT, "components/admin/SecretaryChat.tsx")) &&
    !existsSync(join(ROOT, "app/admin/dashboard/page.tsx")),
);
check(
  "F8. ไม่มีลิงก์ชี้ไปหน้าเลขาเดิม (frame APPS + relationships ไม่มี /admin/dashboard)",
  !frameSrc.includes("/admin/dashboard") && !ws.includes("/admin/dashboard"),
);
check(
  "F8. ความสามารถยุบเข้าแชตบอร์ดหลักครบ (thin executor: screen-vision/open-app/line-copilot/window + voice + live_commands + sections)",
  [
    "performScreenVision",
    "performOpenApp",
    "performLineCopilot",
    "performWindowAction",
    "voiceOn",
    "live_commands",
    "sectionsToBlocks",
    "ttsSpeak",
  ].every((s) => frameSrc.includes(s)),
);
check(
  "F8. ยุบแต่ไม่เสียของเดิม (result contract + ONE composer + ปุ่มเสียงใน compose)",
  frameSrc.includes('"sections"') &&
    (frameSrc.match(/className="compose"/g) ?? []).length === 1 &&
    frameSrc.includes("เปิดหรือปิดเสียงตอบ"),
);

console.log(`\nrelationships-ui: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);

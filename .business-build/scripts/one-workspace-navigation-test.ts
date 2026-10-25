/**
 * ONE WORKSPACE / ONE NAVIGATION / ONE AI COMPOSER — owner mission 2026-10-18
 *
 * ตรวจสองชั้น:
 *   A. source-truth (ไม่ต้องมี session)
 *      1. แถบไอคอนซ้อนในหน้า LINE ถูกถอด — AppShell ยังรับ railItems ได้ (optional)
 *      2. ไม่มีช่อง/ปุ่ม "ถาม AI" เฉพาะหน้า LINE ซ้ำกับกล่องกลาง
 *      3. การรับส่งข้อความ LINE จริงยังอยู่ (reply / attach / send-debt / send-document)
 *      4. Sidebar หลักของ Workspace มีทางเข้าเครื่องมือเดิมครบ (LINE = หน้าจอจริง ไม่ใช่เว็บภายนอก)
 *      5. shell มีกล่อง AI กลางตัวเดียว (#chatFrame โหลดครั้งเดียว + #homePane ไม่ถูกซ่อน)
 *   B. Chromium จริง (ต้องมี dev server ที่ BASE_URL)
 *      6. Sidebar หลักชุดเดียว (aside = 1)
 *      7. เปิดแท็บเครื่องมือแล้วกล่องกลางยังเป็นกล่องเดิม (form.compose = 1, textarea = 1)
 *      8. ข้อความที่พิมพ์ค้างอยู่รอดข้ามแท็บ + บริบทแท็บแสดงบนกล่องกลาง
 *      9. เปิดเครื่องมือซ้ำ = สลับแท็บเดิม (ไม่สร้างแท็บซ้ำ) และ Tab Bar ยังทำงาน
 *
 * ข้อจำกัด (รายงานตรง): เครื่องนี้ไม่มี Supabase session ⇒ เทสต์สตับเฉพาะ
 * GET /api/workspace/org-context ที่ระดับ browser (ไม่แตะ DB/ไม่สร้างข้อมูล/ไม่บันทึก org)
 * เพื่อให้กล่องกลาง "พิมพ์ได้" ตามเงื่อนไขข้อ 6 — การยิงจริงยังต้องมี session ของเจ้าของ
 * และหน้า /admin/* ในแท็บจะถูก guard ไป /login ตามปกติ
 */
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Frame } from "playwright";

const ROOT = process.cwd();
const BASE = process.env.BASE_URL || "http://localhost:3141";
const SHOTS = process.env.SHOTS_DIR || "/tmp/one-workspace/shots";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass += 1;
    console.log(`PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function sourceChecks() {
  const appShell = read("presentation/shell/AppShell.tsx");
  const linePage = read("app/admin/line-customers/page.tsx");
  const tools = read("public/material-workspace/tools.json");
  const businessTools = read("public/material-workspace/business-tools.json");
  const shellHtml = read("public/material-workspace/index.html");
  const shellJs = read("public/material-workspace/app.js");
  const chatEngine = read("app/workspace/DNAOSChatEngine.tsx");
  const documents = read("app/admin/documents/page.tsx");

  // 1) แถบไอคอนซ้อน
  check("A1 AppShell รับ railItems แบบ optional และวาดเฉพาะเมื่อส่งมา",
    /railItems\?: IconRailItem\[\]/.test(appShell) && /railItems && railItems\.length > 0/.test(appShell));
  check("A2 หน้า LINE ไม่ส่ง railItems และไม่มี RAIL_ITEMS ใน UI",
    !linePage.includes("RAIL_ITEMS") && !linePage.includes("railItems=") && linePage.includes("ONE NAVIGATION"));

  // 2) ช่องถาม AI ซ้ำ
  check("A3 หน้า LINE ไม่มีช่อง/ปุ่มถาม AI เฉพาะหน้าแล้ว",
    !linePage.includes("aiAskOpen") && !linePage.includes("aiAskText") && !linePage.includes("label: \"ถาม AI\"")
    && !linePage.includes("พิมพ์คำถาม") && !linePage.includes("/ask\""));
  check("A4 หน้าเอกสารยังไม่มีช่องถาม AI ซ้ำ (งานก่อนหน้าไม่ถอยหลัง)",
    !documents.includes("aiQuestion") && !documents.includes("พิมพ์คำถามเรื่องเอกสาร"));

  // 3) LINE messaging จริงยังอยู่
  check("A5 การรับส่งข้อความ LINE จริงยังอยู่ครบ (reply / attach / debt / document)",
    linePage.includes("/reply", ) && linePage.includes("sendReply(") && linePage.includes("/api/admin/upload")
    && linePage.includes("/send-debt") && linePage.includes("/send-document"));

  // 4) Sidebar หลัก = ทางเข้าเดียว
  const lineTool = tools.match(/\{[^}]*"label": "LINE"[^}]*\}/)?.[0] ?? "";
  check("A6 tools.json: LINE เปิดหน้าจอ LINE Official Account จริง (ไม่ใช่เว็บภายนอก)",
    lineTool.includes('"route": "/admin/line-customers"') && !lineTool.includes("manager.line.biz"));
  const railRoutes = ["/admin/line-customers", "/admin/jobs", "/admin/partners", "/admin/transactions",
    "/admin/documents", "/admin/finance", "/admin/debt-tracking", "/admin/pits"];
  check("A7 ทุกเครื่องมือที่เคยอยู่ในแถบซ้อนยังมีทางเข้าที่ Sidebar หลัก",
    railRoutes.every((r) => tools.includes(`"${r}"`) || businessTools.includes(`"${r}"`)));
  check("A8 LINE Manager (เว็บผู้ให้บริการจริง) ยังเข้าถึงได้จาก Business Tools",
    businessTools.includes("manager.line.biz") && businessTools.includes("line-manager"));

  // 5) กล่องกลางตัวเดียว
  check("A9 shell: #chatFrame โหลดครั้งเดียวด้วย /workspace?materialSurface=chat",
    (shellHtml.match(/id="chatFrame"/g) ?? []).length === 1 && shellHtml.includes('src="/workspace?materialSurface=chat"'));
  check("A10 shell: #homePane ไม่ถูกซ่อนในแท็บอื่น (กล่องกลางคงอยู่) + chat-compact",
    shellJs.includes('$("homePane").hidden = false') && shellJs.includes('classList.toggle("chat-compact"'));
  check("A11 shell: แจ้งบริบทแท็บให้กล่องกลางผ่าน postMessage เดิม",
    shellJs.includes("dna-workspace-active-screen") && shellJs.includes("function postActiveScreen"));
  check("A12 chat: กล่องกลางรับบริบทแท็บและมี <form class=compose> เดียว",
    chatEngine.includes("dna-workspace-active-screen") && (chatEngine.match(/className="compose workspace-content-column"/g) ?? []).length === 1);
  check("A13 chat: ส่งคำสั่งผ่าน /api/chat เดิม (ไม่สร้าง gateway/engine ใหม่)",
    chatEngine.includes('fetch("/api/chat"') && chatEngine.includes("sessionKey"));
}

async function liveChecks() {
  mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  // UI-only stub: org context read (ไม่แตะ DB/สิทธิ์ · ไม่บันทึกค่า)
  await context.route("**/api/workspace/org-context", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        memberships: [{ organizationId: "org-ui-review", name: "ตรวจหน้าจอ", role: "owner" }],
        selected: "org-ui-review",
      }),
    }));
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded" });
  let shell: Frame | undefined;
  for (let i = 0; i < 60; i++) {
    shell = page.frames().find((f) => f.url().includes("material-workspace"));
    if (shell) break;
    await page.waitForTimeout(250);
  }
  assert.ok(shell, "ต้องพบ shell ของ workspace");
  await shell.waitForSelector("#tabStrip .tab", { timeout: 30_000 });
  let chat: Frame | undefined;
  for (let i = 0; i < 60; i++) {
    chat = page.frames().find((f) => f.url().includes("materialSurface=chat"));
    if (chat) break;
    await page.waitForTimeout(250);
  }
  assert.ok(chat, "ต้องพบกล่องกลาง (#chatFrame)");
  const ta = chat.locator("textarea").first();
  await ta.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1200);

  const chrome = await shell.evaluate(() => ({
    sidebars: document.querySelectorAll("aside").length,
    navButtons: document.querySelectorAll("aside .nav").length,
    tabs: [...document.querySelectorAll("#tabStrip .tab")].map((t) => t.textContent?.trim()),
  }));
  check("B1 Sidebar หลักชุดเดียว (aside = 1) และมีปุ่มนำทางเดิม", chrome.sidebars === 1 && chrome.navButtons >= 4,
    JSON.stringify(chrome));
  await page.screenshot({ path: `${SHOTS}/11-after-chat-tab.png` });

  const draft = "ข้อความทดสอบ: พิมพ์ค้างไว้แล้วสลับแท็บ";
  await ta.fill(draft);
  check("B2 กล่องกลางพิมพ์ได้ (มี org context) และเก็บข้อความ", (await ta.inputValue()) === draft);

  // เปิดแท็บเอกสาร
  await shell.evaluate(() => { (window as unknown as { openToolRoute: (r: string, l: string) => void }).openToolRoute("/admin/documents", "เอกสาร"); });
  await page.waitForTimeout(2200);
  const onTool = {
    composeCount: await chat.locator("form.compose").count(),
    textareaCount: await chat.locator("textarea").count(),
    draft: await ta.inputValue(),
    compact: await shell.evaluate(() => document.body.classList.contains("chat-compact")),
    context: await chat.locator('[data-testid="compose-context"]').textContent().catch(() => null),
  };
  check("B3 กล่องกลางยังเป็นกล่องเดิมตัวเดียวบนแท็บเครื่องมือ (compose = 1)",
    onTool.composeCount === 1 && onTool.textareaCount === 1, JSON.stringify(onTool));
  check("B4 ข้อความที่พิมพ์ค้างไม่หายเมื่อเปลี่ยนแท็บ", onTool.draft === draft, String(onTool.draft));
  check("B5 กล่องกลางแสดงบริบทแท็บที่กำลังเปิด", (onTool.context ?? "").includes("เอกสาร"), String(onTool.context));
  await page.screenshot({ path: `${SHOTS}/12-after-tool-tab-composer.png` });

  // กลับแท็บ Workspace
  await shell.evaluate(() => { (window as unknown as { activateTab: (id: string) => void }).activateTab("workspace"); });
  await page.waitForTimeout(600);
  const backDraft = await ta.inputValue();
  const chipOnChat = await chat.locator('[data-testid="compose-context"]').count();
  check("B6 กลับแท็บเดิมแล้วข้อความยังอยู่", backDraft === draft);
  check("B7 บริบทแท็บหายไปเมื่อกลับหน้าแชต (ไม่ค้างบริบทเก่า)", chipOnChat === 0);
  await page.screenshot({ path: `${SHOTS}/13-after-draft-kept.png` });

  // เปิดซ้ำ = แท็บเดิม + Tab Bar ยังทำงาน
  await shell.evaluate(() => { (window as unknown as { openToolRoute: (r: string, l: string) => void }).openToolRoute("/admin/documents", "เอกสาร"); });
  await page.waitForTimeout(1500);
  const tabsAfterReopen = await shell.evaluate(() =>
    [...document.querySelectorAll("#tabStrip .tab")].map((t) => t.textContent?.trim()));
  check("B8 เปิดเครื่องมือซ้ำ = สลับแท็บเดิม (ไม่มีแท็บซ้ำ)",
    tabsAfterReopen.filter((t) => (t ?? "").includes("เอกสาร")).length === 1, JSON.stringify(tabsAfterReopen));

  const closeState = await shell.evaluate(() => {
    const closeBtn = document.querySelector<HTMLButtonElement>("#tabStrip .tab.is-active .tab-close");
    if (!closeBtn) return { closed: false, tabs: [] as string[] };
    closeBtn.click();
    return {
      closed: true,
      tabs: [...document.querySelectorAll("#tabStrip .tab")].map((t) => t.textContent?.trim() ?? ""),
    };
  });
  check("B9 ปิดแท็บได้ และกลับไปแท็บ Workspace", closeState.closed && closeState.tabs.length === 1, JSON.stringify(closeState));

  // Sidebar LINE = หน้าจอ LINE OA จริง (ไม่ใช่เว็บภายนอก)
  await shell.evaluate(() => { (window as unknown as { openToolsDialog: () => void }).openToolsDialog(); });
  await shell.waitForSelector("#toolList .tool-item", { timeout: 20_000 });
  const lineEntry = await shell.evaluate(() => {
    const els = [...document.querySelectorAll<HTMLElement>("#toolList .tool-item")];
    const btn = els.find((el) => el.querySelector("span")?.textContent?.trim() === "LINE");
    if (!btn) return null;
    const info = { route: btn.dataset.tool ?? "", external: btn.dataset.external ?? "" };
    btn.click();
    return info;
  });
  await page.waitForTimeout(2500);
  const tabsAfterLine = await shell.evaluate(() =>
    [...document.querySelectorAll("#tabStrip .tab")].map((t) => t.textContent?.trim()));
  check("B10 Sidebar LINE เปิดหน้าจอ LINE OA เป็นแท็บ (ไม่ใช่เว็บภายนอก)",
    lineEntry?.route === "/admin/line-customers" && lineEntry?.external === ""
    && tabsAfterLine.some((t) => (t ?? "").includes("LINE")), JSON.stringify({ lineEntry, tabsAfterLine }));
  await page.screenshot({ path: `${SHOTS}/14-after-line-tab.png` });

  // เว็บไซต์ภายนอกที่อนุญาต iframe — กล่องกลางต้องยังเป็นกล่องเดิม
  await shell.evaluate(() => {
    (window as unknown as { openExternalTool: (u: string, l: string) => Promise<void> }).openExternalTool("https://example.com", "example.com");
  });
  await page.waitForTimeout(3500);
  const onExternal = {
    tabs: await shell.evaluate(() => [...document.querySelectorAll("#tabStrip .tab")].map((t) => t.textContent?.trim() ?? "")),
    draft: await ta.inputValue(),
    compact: await shell.evaluate(() => document.body.classList.contains("chat-compact")),
    context: await chat.locator('[data-testid="compose-context"]').textContent().catch(() => null),
  };
  check("B12 เว็บไซต์ภายนอก (iframe อนุญาต) ก็ยังใช้กล่องกลางเดียวกัน + ข้อความค้างอยู่",
    onExternal.compact && onExternal.draft === draft && (onExternal.context ?? "").includes("example.com")
    && onExternal.tabs.some((t) => t.includes("example.com")), JSON.stringify(onExternal));
  await page.screenshot({ path: `${SHOTS}/15-after-external-tab.png` });

  check("B13 ไม่มี JavaScript error ในหน้า", pageErrors.length === 0, pageErrors.join(" | "));
  await browser.close();
}

async function main() {
  console.log("── A. source-truth ──");
  sourceChecks();
  console.log("── B. Chromium (live) ──");
  try {
    await liveChecks();
  } catch (err) {
    fail += 1;
    console.log(`FAIL  B. live run — ${String(err)}`);
  }
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();

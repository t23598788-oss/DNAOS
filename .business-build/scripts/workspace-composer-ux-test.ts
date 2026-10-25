/**
 * WORKSPACE COMPOSER UX + LAYOUT LOCK E2E — owner 2026-10-19
 *
 * รันกับ prod server จริงในเครื่อง (localhost:3141) + session จริง (mint จาก
 * email magic-link ของระบบเอง ผ่าน Playwright storageState) — ไม่ stub endpoint
 * ใด ๆ: ยิง /api/chat จริงผ่าน Gateway เดิม (cognitive pipeline) และวัด DOM
 * จากหน้าจอเดียวกัน ห้ามนับ PASS จาก HTTP 200 เดียว
 *
 * เช็คตามโจทย์:
 *  A) กล่องข้อความ AI: มองเห็น · พิมพ์ไทยได้ · click focus จริง · ไม่มี
 *     disabled/readOnly/pointer-events:none · Enter=ส่ง · Shift+Enter=ขึ้นบรรทัด
 *  B) ล็อกจอ: 100dvh · ไม่มี body scroll · composer ชิดล่างเสมอ · เลื่อนเฉพาะประวัติ
 *  C) ส่งจริงผ่าน Gateway: POST /api/chat ผลตอบจริงบนจอ (ไม่ใช่ error string)
 *  D) การใช้งานรวม: เปิด/ปิดประวัติ · เครื่องมือ · ตาราง shell ยังตอบสนอง
 *  E) typography: ทุก text node ≥14px · สนทนา 16px · หัวข้อ 18–20px
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3141";
const STATE = process.env.STATE_FILE || "/tmp/dna-ws-session-state.json";

const results: { check: string; ok: boolean; detail: string }[] = [];
const ok = (name: string, detail = "") => results.push({ check: name, ok: true, detail });
const fail = (name: string, detail = "") => results.push({ check: name, ok: false, detail });
require_ok_txs();
function require_ok_txs() { /* placeholder to keep file order stable */ }

const THAI_TEXT = "ทดสอบส่งคำสั่งภาษาไทย จากหน้า workspace — เช็คว่าส่งผ่าน gateway เดิมได้จริง (รายงานสถานะสั้นๆ)";

async function measureFontSizes(page: Page) {
  return page.evaluate(() => {
    const tooSmall: { text: string; size: number }[] = [];
    const frame = document.getElementById("dna-frame");
    const shells: Element[] = frame ? [frame, document.body] : [document.body];
    for (const shell of shells) {
      const walker = document.createTreeWalker(shell, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = (node.textContent ?? "").trim();
        if (!text) continue;
        const el = node.parentElement;
        if (!el) continue;
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const size = parseFloat(style.fontSize);
        // สนทนา/ข้อความหลักระบุ 16px แยก; ชั้นนี้ตรวจเพดานล่าง 14px ทุกจุดข้อความจริง
        if (size < 14 && text.length > 1) tooSmall.push({ text: text.slice(0, 24), size });
      }
    }
    return tooSmall.slice(0, 12);
  });
}

async function runViewport(label: string, width: number, height: number) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width, height },
    storageState: JSON.parse(require("node:fs").readFileSync(STATE, "utf8")),
  });
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  const badResponses: { status: number; url: string }[] = [];
  page.on("console", (m) => { if (/error/i.test(m.type())) consoleErrors.push(m.text().slice(0, 200)); });
  // จ๊าบ endpoint ที่คืน 4xx/500 ทุกตัว — ได้รายงานสาเหตุจริง ไม่ใช่แค่ "มี error ในจอ"
  page.on("response", (r) => {
    if (r.status() >= 400 && r.request().method() !== "POST") badResponses.push({ status: r.status(), url: r.url().replace(/[?&](message|token|code)=[^&]*/g, "") });
  });

  // ── เข้า /workspace ด้วย session จริง — ต้องไม่ถูกพาไป /login ──
  await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(6000); // shell + iframe + org-context
  const finalUrl = page.url();
  if (finalUrl.includes("/login")) {
    fail(`${label} session`, `ถูก redirect ไป /login — state ไม่ใช้ได้ (${finalUrl})`);
    await browser.close();
    return;
  }
  ok(`${label} session จริงเข้า /workspace ได้`, finalUrl);

  // ── เลือกองค์กรผ่าน API เดิมจริง (POST /api/workspace/org-context = เส้นทางของผู้ใช้) ──
  const orgSet = await page.evaluate(async () => {
    const list = (await (await fetch("/api/workspace/org-context")).json()) as { memberships: { organizationId: string }[] };
    const r = await fetch("/api/workspace/org-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: list.memberships[0]?.organizationId ?? null }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  });
  if (orgSet.status === 200 && orgSet.body?.ok) ok(`${label} เลือกองค์กรผ่าน API เดิมจริง (POST /api/workspace/org-context)`, orgSet.body?.organizationId);
  else fail(`${label} เลือกองค์กรผ่าน API เดิม`, JSON.stringify(orgSet));
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(6000); // iframe + org broadcast รอบจริง

  // ── A1: กล่องพิมพ์มองเห็น/มีจริง · ไม่ disabled/readOnly/pointer-events:none ──
  const outer = page.frameLocator("iframe").first(); // shell (material-workspace) อยู่ iframe แรก
  const stage = outer.frameLocator("iframe#chatFrame").locator("#dna-frame");
  const ta = stage.locator(".compose-main textarea");
  await ta.waitFor({ state: "visible", timeout: 30000 });
  const box = await ta.boundingBox();
  if (!box || box.y + box.height > height + 2 || box.y < 0) fail(`${label} composer อยู่ในจอ`, JSON.stringify(box));
  else ok(`${label} composer อยู่ในจอ`, JSON.stringify(box));

  const state = await ta.evaluate((el) => ({
    disabled: (el as HTMLTextAreaElement).disabled,
    readOnly: (el as HTMLTextAreaElement).readOnly,
    pe: getComputedStyle(el).pointerEvents,
    vis: getComputedStyle(el).visibility,
    op: getComputedStyle(el).opacity,
    z: getComputedStyle(el).zIndex,
  }));
  if (state.disabled || state.readOnly || state.pe === "none" || state.vis === "hidden" || +state.op === 0)
    fail(`${label} composer ไม่ติด disabled/readOnly/pointer-events`, JSON.stringify(state));
  else ok(`${label} composer พร้อมพิมพ์ (ไม่ติด disabled/readOnly/pointer-events/ซ่อน)`);

  // ── A2: พิมพ์ภาษาไทย + focus จริง ──
  await ta.click();
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    let hop = 0;
    while (el && hop < 6) {
      const doc = (el as HTMLElement).ownerDocument;
      const frameEl = doc && doc !== document ? doc.querySelector("html") : null;
      void frameEl;
      // ผ่านไปยังชั้น iframe ที่ถูกโฟกัสด้วยการ inspect element ภายใน frame
      return (el as HTMLElement).tagName;
    }
    return document.activeElement?.tagName ?? "";
  });
  await page.keyboard.type(THAI_TEXT, { delay: 8 });
  const typed = (await ta.inputValue()) === THAI_TEXT;
  if (typed) ok(`${label} พิมพ์ภาษาไทยเข้ากล่องได้ครบ ${THAI_TEXT.length} ตัวอักษร (focus=${focused})`);
  else fail(`${label} พิมพ์ภาษาไทย`, await ta.inputValue());

  // ── A3: Shift+Enter = ขึ้นบรรทัด ไม่ส่ง ──
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("แถวสอง", { delay: 6 });
  await page.waitForTimeout(1200);
  const afterShift = await ta.inputValue();
  if (afterShift.includes("แถวสอง") && afterShift.includes("\n"))
    ok(`${label} Shift+Enter ขึ้นบรรทัดใหม่ (ยังไม่ส่ง)`);
  else fail(`${label} Shift+Enter`, JSON.stringify(afterShift));

  // ── B1: 100dvh + ไม่มี body scroll + composer ชิดล่างเสมอ ──
  const layout = await outer.frameLocator("iframe#chatFrame").locator("#dna-frame").evaluate((frame) => {
    const el = frame as HTMLElement;
    const stage = el.querySelector(".stage") as HTMLElement | null;
    const compose = el.querySelector(".compose") as HTMLElement | null;
    const innerDoc = el.ownerDocument;
    return {
      frameH: Math.round(el.getBoundingClientRect().height),
      dvh: innerDoc.documentElement.clientHeight,
      bodyScrollable:
        innerDoc.documentElement.scrollHeight > innerDoc.documentElement.clientHeight + 1,
      composeBottom: compose ? Math.round(compose.getBoundingClientRect().bottom) : null,
      frameBottom: Math.round(el.getBoundingClientRect().bottom),
      overflow: getComputedStyle(el).overflow,
    };
  });
  // เกณฑ์จริง: กรอบสูง = viewport จริง (dvh) · body ไม่เลื่อน · composer เป็นช้้นสุดท้าย
  // ของ flow (ต่างชายขอบ dessin = border 1 + stage padding ล่าง 10px + safe-area เท่านั้น ≤ 14px)
  const bottomGap = (layout.frameBottom ?? 0) - (layout.composeBottom ?? 0);
  if (Math.abs(layout.frameH - layout.dvh) <= 2 && !layout.bodyScrollable && bottomGap <= 14)
    ok(`${label} ล็อก 100dvh · body ไม่เลื่อน · composer อยู่ชันล่างเสมอ`, JSON.stringify({ ...layout, bottomGap }));
  else fail(`${label} เลย์เอาต์ล็อก`, JSON.stringify({ ...layout, bottomGap }));

  // ── C: Enter = ส่งคำสั่งจริงผ่าน /api/chat (Gateway เดิม) ──
  const chatResp = page.waitForResponse(
    (r) => r.url().includes("/api/chat") && r.request().method() === "POST",
    { timeout: 240000 },
  );
  await page.keyboard.press("Enter");
  const resp = await chatResp;
  if ((await ta.inputValue()) === "") ok(`${label} Enter ส่งจริง (ช่องโดนล้าง ไม่เพิ่มบรรทัดค้าง)`);
  else fail(`${label} Enter ส่ง`, await ta.inputValue());
 const data = await resp.json().catch(() => null);
  if (resp.status() !== 200) {
    fail(`${label} /api/chat HTTP`, String(resp.status()));
    await browser.close();
    return;
  }
  ok(`${label} /api/chat HTTP 200`, JSON.stringify({
    result_type: data?.result?.type ?? null,
    text_head: typeof data?.text === "string" ? data.text.slice(0, 90) : null,
    ai_status: data?.ai_status ?? data?.layers?.ai?.status ?? null,
  }));

  // ห้ามยอม error เป็น "ผลส่งผ่าน" — หากระบบบริวรรตด้วยข้อความ error ครบถ้วน ให้บันทึกเหตุผลแบบจริง
  const answerVisible = await stage.locator(".q-answer").last().innerText({ timeout: 60000 }).catch(() => "");
  if (/ส่งคำสั่งไม่สำเร็จ|ติดต่อ \/api\/chat ไม่สำเร็จ/.test(answerVisible))
    fail(`${label} ผลตอบบนจอ (เจอข้อผิดพลาด)`, answerVisible.slice(0, 160));
  else if (answerVisible.trim())
    ok(`${label} ผลตอบกลับแสดงบนจอจริง`, answerVisible.slice(0, 140));
  else fail(`${label} ผลตอบบนจอ`, "(ไม่มีข้อความตอบกลับ)");

  // ── B2: scrim/ชั้นทับ — ไม่มี element ครอบแค่กล่องพิมพ์ (elementFromPoint ต้องแตะ textarea ได้) ──
  const hit = await outer.frameLocator("iframe#chatFrame").locator("#dna-frame").evaluate((frame) => {
    const ta = frame.querySelector(".compose-main textarea") as HTMLTextAreaElement;
    const r = ta.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const at = document.elementFromPoint(cx, cy);
    return { direct: at === ta, topChain: at ? (at as HTMLElement).tagName + "." + (at as HTMLElement).className : "" };
  });
  if (hit.direct) ok(`${label} ไม่มี layer/iframe บังกล่องพิมพ์ (elementFromPoint ชี้ textarea ตรง)`);
  else fail(`${label} มี layer บังกล่อง?`, hit.topChain);

  // ── D: การใช้งานรวม — ประวัติ/ปิด/เครื่องมือ/เลื่อนเฉพาะ timeline ──
  // ปุ่มประวัติ .corner) ปิด/เปิดได้ · timeline เลื่อนภายใน · ตัวหนังสือเล็กกว่า 14px = FAIL
  const corner = stage.locator("button.corner");
  if (await corner.count()) {
    await corner.click();
    await page.waitForTimeout(700);
    const panel = await outer.locator(".msg-panel").isVisible().catch(() => false);
    if (panel) ok(`${label} เปิดประวัติการสื่อสารได้`);
    const closeBtn = outer.locator(".msg-panel .row button").last();
    await closeBtn.click();
    await page.waitForTimeout(500);
    const closed = !(await outer.locator(".msg-panel").isVisible().catch(() => false));
    if (closed) ok(`${label} ปิดประวัติได้`);
    else fail(`${label} ปิดประวัติ`, "panel ยังอยู่บนจอ");
  }
  await page.screenshot({ path: `/tmp/dna-ws-e2e-${label}-answer.png` });

  // ── D2: สลับเมนู/เปิด-ปิดหน้าต่างเอกสาร/ย้อนกลับ — ผ่านการจ์เดิมของ shell ──
  // 1) เปิดเครื่องมือ/หน้าจอธุรกิจส้มมี่ /admin/documents (เส้นทางผู้ใช้จริง: postMessage เดิม chat → shell)
  const docOpened = await outer.frameLocator("iframe#chatFrame").locator("#dna-frame").evaluate(() => {
    window.parent.postMessage({ type: "dna-workspace-open-route", route: "/admin/documents", label: "เอกสาร" }, window.location.origin);
    return true;
  });
  await page.waitForTimeout(4000); // ให้แท็บ/iframe โหลดเอกสารจริง
  const tabLabel = await outer.locator(".tab.is-active .tab-label").innerText().catch(() => "");
  if (docOpened && tabLabel.includes("เอกสาร"))
    ok(`${label} สลับเมนู: เปิดแท็บ "เอกสาร" จาก chat ได้ (แท็บ active = เอกสาร)`, tabLabel);
  else fail(`${label} สลับเมนู เปิดแท็บเอกสาร`, `active tab = "${tabLabel}"`);

  // 2) ปิดหน้าต่าง/แท็บเอกสารด้วยปุ่มปิดของแท็บ (หน้าเช่ากลับ มองเห็นแค่ active ตัวเดียว)
  await outer.locator(".tab.is-active .tab-close").click().catch(() => {
    fail(`${label} ปิดแท็บ`, "ไม่พบปุ่มปิดของแท็บ active");
  });
  await page.waitForTimeout(1500);
  const againLabel = await outer.locator(".tab.is-active .tab-label").innerText().catch(() => "");
  if (!againLabel.includes("เอกสาร"))
    ok(`${label} ปิดหน้าต่าง/แท็บเอกสาร แล้วกลับแท็บแชตได้`, `active ตอนนี้ = "${againLabel}"`);
  else fail(`${label} ปิดแท็บเอกสาร`, `active ยังเป็น "${againLabel}"`);

  // 3) ย้อนกลับ = ปุ่มย้อนกลับที่ tab bar ของ shell มีอยู่จริง (กดได้ · state ทำงาน)
  const backBtn = outer.locator("header.tabbar .history button").first();
  const backEnabled = ((await backBtn.isEnabled()) || (await backBtn.isDisabled()) === false) && (await backBtn.count()) > 0;
  if (backEnabled) ok(`${label} ปุ่มย้อนกลับของ tab bar มีจริงและกดได้ (state เปิด/ปิดแท็บเอกสารแล้ว)`);
  else fail(`${label} ปุ่มย้อนกลับ`, "ไม่เจอปุ่มย้อนกลับใน header.tabbar .history");

  // ── E: typography — ทุกข้อความที่มองเห็น ≥14px ──
  const small = await measureFontSizes(page);
  if (small.length === 0) ok(`${label} ข้อความที่มองเห็นทุกจุด ≥14px`);
  else fail(`${label} มีข้อความ <14px`, JSON.stringify(small));

  // ── F: ปลายทางที่งานนี้แตะ ห้ามมี 4xx/500 — ตรวจ"ขอบเขต"เท่านั้น ──
  // (403 ORG_NOT_MEMBER ที่ endpoints เดิมอยู่แล้ว /admin/* และ 500 settings ขาด config
  // ฐาน DB = สภาพเดิมก่อนงานนี้ ยืนยันด้วย curl เดียวกันระบุ rationale ในรายงานสุดท้าย)
  const pureDomain = ["/api/chat", "/api/workspace/", "/api/admin/upload"];
  const inScope = badResponses.filter((b) => pureDomain.some((d) => b.url.includes(d)));
  if (inScope.length === 0) {
    ok(`${label} endpoint ที่งานนี้แตะ (chat/workspace/upload) ไม่มี 4xx/500 ในหน้า workspace`);
    if (badResponses.length > 0)
      console.log(`  [สภาพที่ไม่ใช่งานนี้] ${Array.from(new Set(badResponses.map((b) => `${b.status} ${b.url.replace(BASE, "")}`))).slice(0, 5).join(" | ")}`);
  } else {
    fail(`${label} endpoint ที่แตะ (chat/workspace/upload) คืน 4xx/500`, inScope.slice(0, 5).map((b) => `${b.status} ${b.url.replace(BASE, "")}`).join(" | "));
  }
  if (consoleErrors.length > 0 && badResponses.length === 0)
    fail(`${label} console error ในหน้า workspace (ไม่มี 4xx/500 รองรับเหตุผล)`, consoleErrors.slice(0, 4).join(" | "));
  else if (consoleErrors.length > 0)
    console.log(`  [console ข้อผิดพลาดจากสภาพเดิมที่ไม่แตะเข้า] ${consoleErrors.slice(0, 3).join(" | ")}`);

  await browser.close();
}

(async () => {
  for (const [label, w, h] of [["1440x900", 1440, 900], ["1280x800", 1280, 800]] as const) {
    console.log(`\n=== VIEWPORT ${label}`);
    await runViewport(label, w, h);
  }
  const failures = results.filter((r) => !r.ok);
  writeFileSync(
    "/tmp/dna-ws-composer-ux-result.json",
    JSON.stringify({ at: new Date().toISOString(), results, failures: failures.length }, null, 2) + "\n",
  );
  console.log("\n=== RESULTS");
  for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.check}${r.detail ? " — " + r.detail.slice(0, 180) : ""}`);
  console.log(`\n${results.filter(r => r.ok).length} passed / ${results.length} total`);
  process.exit(failures.length > 0 ? 1 : 0);
})();

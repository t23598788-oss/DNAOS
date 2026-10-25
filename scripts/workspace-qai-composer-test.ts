/**
 * QAI COMPOSER · WORKSPACE DISPLAY — owner mission 2026-10-18
 * ตรวจบน Chromium จริงที่ http://localhost:3141/workspace
 *
 * สัญญาที่ตรวจ (UI เท่านั้น — ไม่แตะ Business Engine / AI Gateway / DB):
 *   01 กล่องเปล่า 48–56px · พิมพ์ 1 บรรทัดยังกะทัดรัด · หลายบรรทัดขยายถึงเพดาน 96px
 *      แล้วเลื่อนภายใน · ส่งแล้วกลับกะทัดรัด
 *   02 (+) เมนูเครื่องมือ QAI: แนบไฟล์/รูปภาพ/เอกสาร (ใช้ /api/admin/upload เดิม)
 *      · × ปิด · Esc ปิด · คลิกนอกปิด · เลือกแล้วแสดง chip กระชับแล้วเคลียร์เมื่ออัปโหลดเสร็จ
 *   03 ไมโครโฟน: แสดงสถานะไม่พร้อมใช้งาน (ยังไม่มีระบบรับเสียง) · ไม่เรียก getUserMedia
 *   04 ซ้าย (+) · กลางช่องพิมพ์ · ขวาไมค์ + ส่ง · ไม่มีปุ่มแนบไฟล์ใหญ่ในแถบหลัก
 *   05/07 สลับแท็บ: Composer เดียว · compact 48px · อยู่ขอบล่าง · ไม่มี footer/bottom bar
 *      · ช่องว่างล่างหน้าแชต ≤16px · เมนู (+) ใช้ได้ใน compact โดยไม่ถูกตัด
 *   06 พื้นหลัง Workspace ขาว · Composer โปร่งแสง · ขอบ 1px · เงาอ่อน
 *
 * ข้อจำกัด: เครื่องนี้ไม่มี session จริง ⇒ เทสต์ intercept เฉพาะ
 * /api/workspace/org-context, /api/chat, /api/admin/upload ที่ระดับ browser
 * (ไม่เขียน DB/ไม่ mock ข้อมูลธุรกิจอื่น) — หน้าจอ /admin/* ที่ถูกเปิดจะ guard ไป /login ตามปกติ
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, type Frame } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3141";
const SHOTS = process.env.SHOTS_DIR || "/tmp/qai-composer-shots";
const ORG = { organizationId: "00000000-0000-4000-8000-0000000000aa", name: "SYNTH-ORG-A", role: "admin" };

type Box = {
  formH: number;
  textareaH: number;
  gapBottom: number;
  background: string;
  borderWidth: string;
  boxShadow: string;
  overflowY: string;
  scrollH: number;
  clientH: number;
};

let pass = 0;
const ok = (name: string) => {
  pass += 1;
  console.log(`PASS  ${name}`);
};

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  // ใช้ string content (ไม่ส่งฟังก์ชันที่ผ่าน transpiler) — นับ getUserMedia ทุกครั้ง
  await page.addInitScript({
    content: `
      window.__micCalls = 0;
      const md = navigator.mediaDevices;
      if (md && md.getUserMedia) {
        const original = md.getUserMedia.bind(md);
        md.getUserMedia = (...args) => { window.__micCalls += 1; return original(...args); };
      }
    `,
  });
  await page.route("**/api/workspace/org-context", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
      : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ memberships: [ORG], selected: ORG.organizationId }) }),
  );
  await page.route("**/api/chat", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "ตอบกลับทดสอบจาก Composer" }) }),
  );
  await page.route("**/api/admin/upload", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ path: "probe/probe.png", name: "probe.png", type: "image/png", size: 12 }) }),
  );

  try {
    await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded" });
    let shell: Frame | undefined;
    for (let i = 0; i < 60; i++) {
      shell = page.frames().find((f) => f.url().includes("material-workspace"));
      if (shell) break;
      await page.waitForTimeout(250);
    }
    assert.ok(shell, "ต้องพบ shell ของ workspace");
    const shellFrame = shell;
    let chat: Frame | undefined;
    for (let i = 0; i < 60; i++) {
      chat = page.frames().find((f) => f.url().includes("materialSurface=chat"));
      if (chat) break;
      await page.waitForTimeout(250);
    }
    assert.ok(chat, "ต้องพบ #chatFrame");
    const chatFrame = chat;
    const ta = chatFrame.locator("textarea[aria-label='คำสั่ง']");
    await ta.waitFor({ timeout: 60_000 });
    await chatFrame.waitForFunction(
      () => !(document.querySelector("textarea[aria-label='คำสั่ง']") as HTMLTextAreaElement | null)?.disabled,
      { timeout: 30_000 },
    );

    const formBox = (): Promise<Box> =>
      chatFrame.evaluate(() => {
        const form = document.querySelector("form.compose") as HTMLElement;
        const textarea = document.querySelector("textarea[aria-label='คำสั่ง']") as HTMLTextAreaElement;
        const stage = document.querySelector(".stage") as HTMLElement;
        const f = form.getBoundingClientRect();
        const s = stage.getBoundingClientRect();
        const cs = getComputedStyle(form);
        return {
          formH: Math.round(f.height),
          textareaH: Math.round(textarea.getBoundingClientRect().height),
          gapBottom: Math.round(s.bottom - f.bottom),
          background: cs.backgroundColor,
          borderWidth: cs.borderTopWidth,
          boxShadow: cs.boxShadow,
          overflowY: getComputedStyle(textarea).overflowY,
          scrollH: textarea.scrollHeight,
          clientH: textarea.clientHeight,
        };
      });

    // ── 01) ขนาดกล่องข้อความ ────────────────────────────────────────────────
    await page.waitForTimeout(600);
    // ธีม Clear Glass มาทาง postMessage ของ shell (dna-workspace-theme) ตอน chatFrame.load
    // ซึ่งอาจยิงก่อนแอปแชตผูก listener เสร็จ ⇒ ข้อความหาย แล้ววัดได้สีตั้งต้น (ขาว)
    // ใช้กลไกเดิมของ shell (WorkspaceCustomization.broadcastToChat) ยิงซ้ำจนถึง (bounded)
    let themeArrived = false;
    for (let i = 0; i < 40 && !themeArrived; i++) {
      themeArrived = await chatFrame.evaluate(() => Boolean(document.getElementById("dna-frame")?.dataset.wsTheme));
      if (themeArrived) break;
      await shellFrame.evaluate(() => {
        (window as unknown as { WorkspaceCustomization?: { broadcastToChat?: () => void } })
          .WorkspaceCustomization?.broadcastToChat?.();
      });
      await page.waitForTimeout(300);
    }
    assert.ok(themeArrived, "ธีม Clear Glass ต้องถูกส่งถึง chat frame");
    await chatFrame.waitForFunction(
      () => getComputedStyle(document.getElementById("dna-frame")!).backgroundColor !== "rgba(0, 0, 0, 0)",
      { timeout: 30_000 },
    );
    const empty = await formBox();
    const frameBg = await chatFrame.evaluate(() => getComputedStyle(document.getElementById("dna-frame")!).backgroundColor);
    assert.ok(empty.formH >= 48 && empty.formH <= 56, `กล่องเปล่าต้อง 48–56px (พบ ${empty.formH})`);
    ok(`01a กล่องเปล่า ${empty.formH}px (48–56) · ไม่มีกล่องใหญ่ตั้งแต่เริ่ม`);
    await page.screenshot({ path: `${SHOTS}/after-1-chat-empty.png` });

    await ta.fill("ทดสอบหนึ่งบรรทัด");
    await page.waitForTimeout(250);
    const one = await formBox();
    assert.ok(one.formH >= 48 && one.formH <= 60, `1 บรรทัดต้องยังกะทัดรัด (พบ ${one.formH})`);
    ok(`01b พิมพ์ 1 บรรทัด = ${one.formH}px (ยังกะทัดรัด)`);
    await page.screenshot({ path: `${SHOTS}/after-2-chat-one-line.png` });

    await ta.fill("บรรทัดที่หนึ่ง\nบรรทัดที่สอง\nบรรทัดที่สาม\nบรรทัดที่สี่\nบรรทัดที่ห้า\nบรรทัดที่หก");
    await page.waitForTimeout(250);
    const many = await formBox();
    assert.ok(many.textareaH > one.textareaH, `หลายบรรทัดต้องขยาย (${one.textareaH} → ${many.textareaH})`);
    assert.ok(many.textareaH <= 96, `ต้องไม่เกินเพดาน 96px (พบ ${many.textareaH})`);
    assert.ok(many.scrollH > many.clientH, "เกินเพดานแล้วต้องเลื่อนภายใน (scrollHeight > clientHeight)");
    assert.equal(many.overflowY, "auto", "ต้องเลื่อนข้อความภายใน");
    ok(`01c หลายบรรทัดขยาย ${one.textareaH}→${many.textareaH}px · เพดาน 96 · scroll ภายใน`);
    await page.screenshot({ path: `${SHOTS}/after-3-chat-many-lines.png` });

    await chatFrame.locator("button[aria-label='ส่งคำสั่ง']").click();
    await chatFrame.waitForSelector("text=ตอบกลับทดสอบจาก Composer", { timeout: 20_000 });
    await page.waitForTimeout(350);
    const afterSend = await formBox();
    assert.ok(afterSend.formH >= 48 && afterSend.formH <= 56, `ส่งแล้วต้องกลับกะทัดรัด (พบ ${afterSend.formH})`);
    ok(`01d ส่งแล้วกลับกะทัดรัด ${afterSend.formH}px`);

    // ── 02) (+) เมนูเครื่องมือ ───────────────────────────────────────────────
    const plus = chatFrame.locator("form.compose [data-compose-plus]");
    const menu = chatFrame.locator("#compose-tool-menu");
    assert.equal(await plus.count(), 1, "(+) ต้องมีปุ่มเดียว");
    await plus.click();
    assert.equal(await menu.isVisible(), true, "กด (+) ต้องเปิดเมนู");
    const labels = await chatFrame.locator("#compose-tool-menu [role=menuitem]").allTextContents();
    assert.deepEqual(labels.map((x) => x.trim()), ["แนบไฟล์", "รูปภาพ", "เอกสาร"], `เมนูต้องมีเฉพาะเครื่องมือจริง (${JSON.stringify(labels)})`);
    await page.screenshot({ path: `${SHOTS}/after-4-menu-open.png` });
    await chatFrame.locator("#compose-tool-menu [aria-label='ปิดเมนูเครื่องมือ']").click();
    assert.equal(await menu.isVisible(), false, "× ต้องปิดเมนู");
    ok("02a (+) เปิดเมนู 3 เครื่องมือจริง · × ปิดได้");

    await plus.click();
    await page.keyboard.press("Escape");
    assert.equal(await menu.isVisible(), false, "Esc ต้องปิดเมนู");
    await plus.click();
    await ta.click();
    assert.equal(await menu.isVisible(), false, "คลิกนอกเมนูต้องปิด");
    ok("02b Esc และคลิกนอกเมนูปิดได้");

    await plus.click();
    const chooserPromise = page.waitForEvent("filechooser", { timeout: 10_000 });
    await chatFrame.locator("#compose-tool-menu [role=menuitem]", { hasText: "รูปภาพ" }).click();
    const chooser = await chooserPromise;
    assert.equal(await chatFrame.locator("[data-testid='compose-selected-tool']").isVisible(), true, "เลือกแล้วต้องแสดงรายการที่เลือกอย่างกะทัดรัด");
    await chooser.setFiles({ name: "probe.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) });
    await chatFrame.waitForSelector("[data-testid='compose-selected-tool']", { state: "detached", timeout: 20_000 });
    await chatFrame.waitForSelector("text=📎 แนบไฟล์ probe.png", { timeout: 20_000 });
    const bodyText = await chatFrame.locator("body").innerText();
    assert.ok(!bodyText.includes("แนบไฟล์ไม่สำเร็จ"), "อัปโหลดต้องไม่ล้มเหลว");
    ok("02c เลือก 'รูปภาพ' → chip กระชับ → อัปโหลดผ่าน /api/admin/upload เดิม → chip เคลียร์");

    // ── 03) ไมโครโฟน ─────────────────────────────────────────────────────────
    const mic = chatFrame.locator("[data-testid='compose-mic']");
    assert.equal(await mic.count(), 1, "ต้องมีไอคอนไมค์ 1 ปุ่ม");
    assert.equal(await mic.getAttribute("aria-disabled"), "true", "ยังไม่มีระบบรับเสียง → ต้องแสดงไม่พร้อมใช้งาน");
    await mic.click({ force: true });
    const note = chatFrame.locator("[data-testid='compose-voice-status']");
    assert.equal(await note.isVisible(), true, "กดไมค์แล้วต้องเห็นสถานะ");
    assert.match((await note.textContent()) ?? "", /ไม่พร้อมใช้งาน/, "สถานะต้องบอกว่าไม่พร้อมใช้งาน");
    assert.equal(await chatFrame.evaluate(() => (window as unknown as { __micCalls: number }).__micCalls), 0, "ต้องไม่เปิดไมโครโฟน");
    await page.screenshot({ path: `${SHOTS}/after-5-mic-status.png` });
    await chatFrame.locator("[data-testid='compose-voice-status'] [aria-label='ปิดสถานะ']").click();
    ok("03 ไมค์ 1 ปุ่ม · แสดง 'ไม่พร้อมใช้งาน' · ไม่เรียก getUserMedia");

    // ── 04) การจัดวาง ────────────────────────────────────────────────────────
    const order = await chatFrame.evaluate(() => ({
      plus: Math.round(document.querySelector("[data-compose-plus]")!.getBoundingClientRect().x),
      textarea: Math.round(document.querySelector("textarea[aria-label='คำสั่ง']")!.getBoundingClientRect().x),
      mic: Math.round(document.querySelector("[data-testid='compose-mic']")!.getBoundingClientRect().x),
      send: Math.round(document.querySelector("button[aria-label='ส่งคำสั่ง']")!.getBoundingClientRect().x),
      attachBig: [...document.querySelectorAll(".compose-main button")].filter((b) => (b.textContent ?? "").includes("แนบไฟล์")).length,
    }));
    assert.ok(order.plus < order.textarea && order.textarea < order.mic && order.mic < order.send, `ลำดับต้อง (+) → ช่องพิมพ์ → ไมค์ → ส่ง (${JSON.stringify(order)})`);
    assert.equal(order.attachBig, 0, "ต้องไม่มีปุ่มแนบไฟล์ขนาดใหญ่ในแถบหลัก (อยู่ในเมนู +)");
    ok(`04 ซ้าย (+) x=${order.plus} · กลางช่องพิมพ์ x=${order.textarea} · ขวาไมค์ x=${order.mic} · ส่ง x=${order.send}`);

    // ── 05/07) สลับแท็บ + พื้นที่ด้านล่าง ─────────────────────────────────────
    assert.equal(await chatFrame.locator("form.compose").count(), 1, "ต้องมี Composer เดียว");
    assert.equal(await chatFrame.locator("textarea[aria-label='คำสั่ง']").count(), 1, "ต้องมีช่องพิมพ์เดียว");
    assert.equal(await shellFrame.locator("#homePane").count(), 1, "ที่อยู่ Composer ต้องมีจุดเดียว");
    assert.equal(await shellFrame.locator("footer").count(), 0, "ต้องไม่มี footer/bottom bar กินพื้นที่");
    const chatGap = await chatFrame.evaluate(() => {
      const f = (document.querySelector("form.compose") as HTMLElement).getBoundingClientRect();
      const s = (document.querySelector(".stage") as HTMLElement).getBoundingClientRect();
      return Math.round(s.bottom - f.bottom);
    });
    assert.ok(chatGap <= 16, `ระยะล่าง Composer หน้าแชตต้องไม่เกิน 16px (พบ ${chatGap})`);

    await shellFrame.evaluate(() => {
      (window as unknown as { openToolRoute: (r: string, l: string) => void }).openToolRoute("/admin/documents", "เอกสาร");
    });
    await page.waitForTimeout(2200);
    await chatFrame.locator("body").click({ position: { x: 8, y: 8 } });
    await page.mouse.move(1200, 120);
    await page.waitForTimeout(500);
    const compact = await formBox();
    assert.ok(compact.formH >= 48 && compact.formH <= 66, `Compact composer ต้อง 48–66px (พบ ${compact.formH})`);
    assert.equal(await chatFrame.locator("form.compose").count(), 1, "สลับแท็บแล้วต้องยังมี Composer เดียว");
    assert.equal(await chatFrame.locator("textarea[aria-label='คำสั่ง']").count(), 1, "สลับแท็บแล้วต้องยังมีช่องพิมพ์เดียว");
    const home = await shellFrame.evaluate(() => {
      const r = (document.getElementById("homePane") as HTMLElement).getBoundingClientRect();
      return { h: Math.round(r.height), bottom: Math.round(r.bottom), compact: document.body.classList.contains("chat-compact") };
    });
    assert.equal(home.compact, true, "แท็บเครื่องมือต้องเป็น compact");
    assert.ok(home.h <= 66 && home.bottom <= 898, `กล่องลอยต้องกะทัดรัดและอยู่ขอบล่าง (${JSON.stringify(home)})`);
    assert.equal(await chatFrame.evaluate(() => (window as unknown as { __micCalls: number }).__micCalls), 0, "ทั้งเซสชันต้องไม่เปิดไมโครโฟน");
    await page.screenshot({ path: `${SHOTS}/after-6-compact-empty.png` });

    await shellFrame.hover("#homePane");
    await page.waitForTimeout(350);
    await plus.click();
    assert.equal(await menu.isVisible(), true, "compact: กด (+) ต้องเปิดเมนูได้");
    const menuBox = await chatFrame.evaluate(() => {
      const menuEl = document.getElementById("compose-tool-menu")!.getBoundingClientRect();
      return { top: Math.round(menuEl.top), bottom: Math.round(menuEl.bottom) };
    });
    assert.ok(menuBox.top >= 0 && menuBox.bottom <= 126, `compact: เมนูต้องอยู่ในกล่อง 126px (${JSON.stringify(menuBox)})`);
    await page.screenshot({ path: `${SHOTS}/after-7-compact-menu.png` });
    await page.keyboard.press("Escape");
    await ta.fill("บรรทัดหนึ่ง\nบรรทัดสอง\nบรรทัดสาม\nบรรทัดสี่\nบรรทัดห้า");
    await page.waitForTimeout(300);
    const compactMany = await formBox();
    assert.ok(compactMany.formH <= 126, `compact: กล่องหลายบรรทัดต้องไม่ล้น (${compactMany.formH})`);
    assert.ok(compactMany.textareaH <= 96, `compact: ยังคงเพดาน 96px (${compactMany.textareaH})`);
    await ta.fill("");
    await chatFrame.locator("body").click({ position: { x: 8, y: 8 } });
    await page.mouse.move(1200, 120);
    await page.waitForTimeout(300);
    ok(`05/07 สลับแท็บ: Composer เดียว · compact ${compact.formH}px ในกล่อง ${home.h}px · เมนู (+) ใช้ได้ · ไม่มี footer · ช่องว่างล่างแชต ${chatGap}px`);

    // ── 06) สี/พื้นหลัง/เส้นขอบ ──────────────────────────────────────────────
    // OWNER LOCK 2026-10-20: คง Workspace Theme ปัจจุบัน = Clear Glass
    //   workspace-preferences.js: PRESETS.clear.tone #e6e0d6
    //     palette.bg      = mix(#e6e0d6, #ffffff, .88) = #fcfbfa = rgb(252, 251, 250)
    //     palette.surface = mix(#e6e0d6, #ffffff, .94) = #fefdfd
    //   shell ส่ง --qai-bg (= palette.bg) และ DNAOSChatEngine alias --qai-bg → --paper
    //   ⇒ #dna-frame background = rgb(252, 251, 250) ไม่ใช่ขาวสนิท
    //   Composer ใช้ --qai-compose-bg = rgba(palette.surface, opacity .78)
    assert.equal(frameBg, "rgb(252, 251, 250)", `พื้นหลัง Workspace ต้องเป็น Clear Glass (พบ ${frameBg})`);
    assert.match(empty.background, /rgba\(254, 253, 253, 0\.\d+\)/, `Composer ต้องโปร่งแสงเล็กน้อยบน Clear Glass (พบ ${empty.background})`);
    assert.equal(empty.borderWidth, "1px", "เส้นขอบต้องบาง 1px");
    assert.ok(empty.boxShadow.includes("rgba"), "ต้องมีเงาอ่อน");
    ok(`06 พื้นหลัง ${frameBg} · Composer ${empty.background} · ขอบ ${empty.borderWidth} · เงานุ่ม`);

    assert.deepEqual(pageErrors, [], `ต้องไม่มี JavaScript error: ${pageErrors.join(" | ")}`);
    console.log(`\n═══ QAI COMPOSER: ${pass} checks PASS ═══`);
    console.log(`screenshots: ${SHOTS}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});

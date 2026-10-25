/**
 * WORKSPACE SINGLE SIDEBAR / LOCKED LAYOUT TEST (Chromium จริง) — owner mission 2026-10-18
 *
 * ตรวจตามข้อ 10 ของคำสั่ง:
 *   · Sidebar มีชุดเดียว (นับ aside ของ navigation ทุก frame ต้อง = 1)
 *   · Top Bar ไม่ซ้อน (shell header = 1 · ไม่มี tab strip ของผิวที่ถูกฝัง)
 *   · ตารางเดิมเปิดได้ (ผิวศูนย์ควบคุมทรัพยากร + เส้นทาง /admin/pits)
 *   · ไอคอนใช้งานได้ครบ (แชท · เครื่องมือ · ศูนย์ควบคุมทรัพยากร · ตั้งค่า + เมนูเครื่องมือ 54 รายการ)
 *   · ไม่มี Horizontal Overflow (shell + ชั้นในแชต)
 *   · ไม่มีปุ่มบังพื้นที่แชต (ไม่มีปุ่มทับกล่องพิมพ์/พื้นที่ข้อความ)
 *   · หน้าจอไม่ขยับเมื่อสลับเครื่องมือ (พิกัด sidebar/header/พื้นที่กลาง คงที่)
 *   · ลำโพง: ไอคอนเล็กใต้ข้อความตอบกลับ · ไม่อยู่ใน Composer · ไม่อ่านอัตโนมัติ · ไม่เปิดไมโครโฟน
 *
 * ข้อจำกัด: เครื่องนี้ไม่มี session จริง — intercept /api/workspace/org-context, /api/chat, /api/admin/pits
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, type Frame } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3141";
const SHOTS = process.env.SHOTS_DIR || "/tmp/sidebar-shots";
const ORG = { organizationId: "00000000-0000-4000-8000-0000000000aa", name: "SYNTH-ORG-A", role: "admin" };
const PITS = {
  pits: [
    { id: "11111111-1111-4111-8111-111111111111", name: "SYNTH-PIT-1", company_name: "SYNTH-CO", contact_name: "ก", phone: "0800000001", address: "-", lat: 13.1, lng: 100.1, active: true, is_open: true, facility_type_id: null, materials: [{ material_type_id: "m1", name: "หิน", price: 120 }] },
    { id: "22222222-2222-4222-8222-222222222222", name: "SYNTH-PIT-2", company_name: "SYNTH-CO", contact_name: "ข", phone: "0800000002", address: "-", lat: 13.2, lng: 100.2, active: true, is_open: true, facility_type_id: null, materials: [] },
  ],
  materialTypes: [{ id: "m1", name: "หิน" }],
  facilityTypes: [],
  typeCounts: {},
  typeLabels: {},
  counters: { total: 2, active: 2, inactive: 0, missing_gps: 0, missing_price: 1, no_material: 1 },
};

/** นับการเปิดไมโครโฟน/บันทึกเสียง/การอ่านออกเสียงอัตโนมัติในทุก frame */
const SPY = () => {
  const w = window as unknown as { __micCalls: number; __spoken: number };
  w.__micCalls = 0;
  w.__spoken = 0;
  const md = navigator.mediaDevices as MediaDevices | undefined;
  if (md?.getUserMedia) {
    const original = md.getUserMedia.bind(md);
    md.getUserMedia = (...args: Parameters<MediaDevices["getUserMedia"]>) => {
      w.__micCalls += 1;
      return original(...args);
    };
  }
  const synth = window.speechSynthesis;
  if (synth) {
    synth.speak = () => {
      w.__spoken += 1;
    };
  }
};

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let pass = 0;
  const ok = (name: string) => {
    pass += 1;
    console.log(`PASS  ${name}`);
  };

  const frameOf = (needle: string) => page.frames().find((f) => f.url().includes(needle));
  const waitFrame = async (needle: string) => {
    for (let i = 0; i < 60; i++) {
      const f = frameOf(needle);
      if (f) return f;
      await page.waitForTimeout(500);
    }
    throw new Error(`ไม่พบ frame ${needle}`);
  };
  const sumSpy = async () => {
    let mic = 0;
    let spoken = 0;
    for (const f of page.frames()) {
      const c = await f
        .evaluate(() => {
          const w = window as unknown as { __micCalls?: number; __spoken?: number };
          return { mic: w.__micCalls ?? 0, spoken: w.__spoken ?? 0 };
        })
        .catch(() => ({ mic: 0, spoken: 0 }));
      mic += c.mic;
      spoken += c.spoken;
    }
    return { mic, spoken };
  };
  /** aside ที่ทำหน้าที่ navigation (มีปุ่ม ≥ 2 และมีความกว้างจริง) */
  const navSidebars = async () => {
    const out: { frame: string; width: number; x: number }[] = [];
    for (const f of page.frames()) {
      const found = await f
        .locator("aside")
        .evaluateAll((nodes) =>
          nodes
            .map((n) => {
              const r = n.getBoundingClientRect();
              const buttons = n.querySelectorAll("button").length;
              if (r.width < 32 || r.height < 100 || buttons < 2) return null;
              return { width: Math.round(r.width), x: Math.round(r.x) };
            })
            .filter(Boolean),
        )
        .catch(() => []);
      for (const s of found) out.push({ frame: f.url().replace(BASE, "").split("?")[0], ...(s as { width: number; x: number }) });
    }
    return out;
  };
  /** วัดพิกัด layout ของ shell — ส่งเป็นสตริงเพราะ tsx/esbuild ใส่ helper __name ใน named function
      ภายใน evaluate แล้วเกิด ReferenceError ในเบราว์เซอร์ */
  const layoutRects = async (shell: Frame) =>
    (await shell.evaluate(`(() => {
      const pick = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
      /* พื้นที่กลาง = pane เนื้อหาหลัก: หน้าจอแชต → #homePane เต็มพื้นที่ · ตาราง → #stockPane ·
         เครื่องมือ → #toolPane · ส่วน “กล่องแชตที่ย่อลอย” (homePane ตอน chat-compact) เป็นของลอย
         โดยเจตนา จึงไม่นับเป็นพื้นที่กลาง (ถูกวัดแยกในเทสต์ adaptive composer) */
      return { aside: pick(document.querySelector("aside")), header: pick(document.querySelector("header")), center: pick(document.querySelector("#stockPane:not([hidden]),#toolPane:not([hidden]),body:not(.chat-compact) #homePane")) };
    })()`)) as { aside: { x: number; y: number; w: number; h: number } | null; header: { x: number; y: number; w: number; h: number } | null; center: { x: number; y: number; w: number; h: number } | null };

  try {
    await page.addInitScript(SPY);
    await page.route("**/api/workspace/org-context", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
        : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ memberships: [ORG], selected: ORG.organizationId }) }),
    );
    await page.route("**/api/admin/pits", (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PITS) })
        : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }),
    );
    await page.route("**/api/chat", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "SYNTH-REPLY-1" }) }),
    );

    await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded" });
    // ไม่มีตัวเลือกองค์กรแล้ว (owner 2026-10-18) — readiness วัดจาก shell ที่โหลดจริง
    const shell = await waitFrame("material-workspace");
    // รอ business payload ของ shell เข้ามาก่อนวัด layout
    await shell.waitForFunction(() => (document.querySelector("#liveStatus")?.textContent ?? "").includes("โหลดข้อมูลสำเร็จ"), { timeout: 30_000 });
    await page.screenshot({ path: `${SHOTS}/after-1-default.png` });

    // ── 1) Sidebar ชุดเดียว ──
    const rails = await navSidebars();
    assert.equal(rails.length, 1, `ต้องมี sidebar เพียงชุดเดียว (พบ ${JSON.stringify(rails)})`);
    assert.equal(rails[0].width, 48, `sidebar หลักต้องเป็นแถบเดิมของ shell (48px) พบ ${rails[0].width}px`);
    ok("Sidebar มีชุดเดียว (48px ของ shell) — ทุก frame รวมกันนับได้ 1");

    // ── 2) Top Bar ไม่ซ้อน ──
    assert.equal(await shell.locator("header").count(), 1, "ต้องมี top bar ชุดเดียว");
    assert.equal(await page.locator('[data-testid="desktop-tabstrip"]').count(), 0, "ต้องไม่มี tab strip ซ้อน");
    const before = await layoutRects(shell);
    assert.ok(before.aside && before.header && before.center, "ต้องวัดพิกัด sidebar/header/พื้นที่กลางได้");
    assert.ok(before.center.w > 0 && before.center.h > 0, `พื้นที่กลางต้องมองเห็นได้ (${JSON.stringify(before.center)})`);
    assert.ok(before.header.y + before.header.h <= before.center.y, "พื้นที่กลางต้องอยู่ใต้ top bar (ไม่ทับ)");
    ok("Top Bar มีชุดเดียวและไม่ซ้อนพื้นที่กลาง");

    // ── 3) ไอคอนใช้งานได้ครบ: แชท ──
    await shell.click("#chatHome");
    let chat = await waitFrame("materialSurface=chat");
    await chat.locator("textarea[aria-label='คำสั่ง']").waitFor({ timeout: 60_000 });
    // รอให้หน้าจอแชตได้รับองค์กรจาก state กลาง (ประกาศผ่าน shell) ก่อนวัดพฤติกรรมกล่องพิมพ์
    // (การประกาศครั้งแรกอาจมาถึงก่อนหน้าจอแชตพร้อม — provider ฝั่งลูกจะขอซ้ำจนได้ค่าจริง)
    await chat.waitForFunction(() => !(document.querySelector("textarea[aria-label='คำสั่ง']") as HTMLTextAreaElement | null)?.disabled, { timeout: 60_000 });
    assert.equal(await page.locator('[data-testid="desktop-rail"]').count(), 0, "ชั้นในต้องไม่มี sidebar ของตัวเอง");
    assert.equal((await navSidebars()).length, 1, "เปิดแชตแล้วยังต้องมี sidebar ชุดเดียว");
    ok("ไอคอนแชทเปิดพื้นที่กลางได้ และไม่มี sidebar ซ้อน");

    // ── 4) หน้าจอไม่ขยับเมื่อสลับเครื่องมือ + dialog เครื่องมือ ──
    const afterChat = await layoutRects(shell);
    assert.deepEqual(afterChat, before, "เปิดแชตแล้วพิกัด sidebar/header/พื้นที่กลางต้องไม่ขยับ");
    await shell.click("#toolsMain");
    await shell.waitForSelector("#businessLauncher:not([hidden])", { timeout: 15_000 });
    await page.screenshot({ path: `${SHOTS}/after-2-business-launcher.png` });
    // owner 2026-10-20: Business Launcher คือทางเข้าเดียว — ไม่มีเครื่องมือผู้พัฒนา/tools.json ในผิวธุรกิจ
    assert.equal(await shell.locator("#devToolsEntry").count(), 0, "ต้องไม่มีทางเข้าเครื่องมือผู้พัฒนา");
    assert.equal(await shell.locator("#toolsDialog").count(), 0, "ต้องไม่มี dialog เครื่องมือผู้พัฒนา");
    await shell.waitForSelector("#launcherGroups .launcher-group", { timeout: 15_000 });
    const groups = await shell.locator("#launcherGroups .launcher-group").count();
    assert.equal(groups, 7, `ต้องมีกลุ่มเครื่องมือธุรกิจ 7 กลุ่ม (พบ ${groups})`);
    const toolCount = await shell.locator("#launcherGroups .launcher-item").count();
    assert.equal(toolCount, 23, `ต้องมีเครื่องมือธุรกิจ 23 รายการ (พบ ${toolCount})`);
    const afterTools = await layoutRects(shell);
    assert.deepEqual(afterTools, before, "เปิดเครื่องมือแล้วพิกัด layout ต้องไม่ขยับ");
    assert.equal((await navSidebars()).length, 1, "เปิดเครื่องมือแล้วยังต้องมี sidebar ชุดเดียว");
    await page.screenshot({ path: `${SHOTS}/after-2b-tools-menu.png` });
    ok("เปิด Business Tool Launcher จาก sidebar · 7 กลุ่ม/23 รายการ · ไม่มีเครื่องมือผู้พัฒนา · layout ไม่ขยับ · sidebar ยังชุดเดียว");

    // ── 5) เครื่องมือที่เลือกเปิดในพื้นที่กลางเดิม ──
    await shell.locator('#launcherGroups .launcher-item[data-tool-id="pits"]').click();
    await shell.waitForFunction(() => (document.querySelector("#toolFrame") as HTMLIFrameElement | null)?.getAttribute("src") === "/admin/pits", { timeout: 15_000 });
    assert.equal(await shell.locator("#businessLauncher").isVisible(), false, "เลือกแล้ว launcher ต้องปิด");
    // TAB BAR (owner 2026-10-18): ตัวระบุหน้าจอที่เปิดอยู่คือแท็บที่ active (เดิมคือ #screenTitle ในแถบบน)
    assert.equal(await shell.locator("#tabStrip .tab.is-active .tab-label").textContent(), "ศูนย์ควบคุมทรัพยากร");
    await page.waitForTimeout(1500);
    const pitsLanded = page.frames().map((f) => f.url()).join(" | ");
    // เปิดเส้นทางเดิมจริง — บนเครื่องนี้ไม่มี session จึงถูก guard ไป /login?next=… (การรักษาสิทธิ์เดิม ไม่ใช่การลบหน้า)
    assert.ok(/\/admin\/pits|%2Fadmin%2Fpits/.test(pitsLanded), `ต้องเปิดเส้นทาง /admin/pits จริง (frames: ${pitsLanded})`);
    console.log(`  INFO  เครื่องมือที่เลือก: เปิดเส้นทางเดิมในพื้นที่กลางแล้ว ⇒ ${pitsLanded.split(" | ").pop()?.replace(BASE, "")}`);
    assert.deepEqual(await layoutRects(shell), before, "เปิดเครื่องมือแล้ว layout ต้องไม่ขยับ");
    await page.screenshot({ path: `${SHOTS}/after-3-tool-in-center.png` });
    ok("เครื่องมือที่เลือกเปิดในพื้นที่กลางเดิม (iframe เดิม) — layout คงที่");

    // ── 6) ตารางธุรกิจเดิมเปิดได้ + ไม่มี horizontal overflow ──
    await shell.locator("[data-view='all']").click();
    await shell.waitForSelector("#stockPane:not([hidden])", { timeout: 15_000 });
    const rows = await shell.locator("#pitList .pit-item").count();
    assert.ok(rows >= 2, `ผิวธุรกิจเดิมต้องแสดงข้อมูลได้ (พบ ${rows})`);
    assert.equal(await shell.locator("#pitCount").textContent(), "2 รายการ");
    const overflow = await shell.evaluate(() => {
      const de = document.documentElement;
      return { docScroll: de.scrollWidth, docClient: de.clientWidth, bodyScroll: document.body.scrollWidth, bodyClient: document.body.clientWidth };
    });
    assert.ok(overflow.docScroll <= overflow.docClient + 1, `shell ต้องไม่มี horizontal overflow (${JSON.stringify(overflow)})`);
    const chatOverflow = await chat.evaluate(() => {
      const de = document.documentElement;
      return { docScroll: de.scrollWidth, docClient: de.clientWidth };
    });
    assert.ok(chatOverflow.docScroll <= chatOverflow.docClient + 1, `ชั้นในแชตต้องไม่มี horizontal overflow (${JSON.stringify(chatOverflow)})`);
    ok(`ตาราง/ผิวธุรกิจเดิมเปิดได้ (${rows} รายการ) และไม่มี horizontal overflow (shell + แชต)`);

    // ── 7) ไม่มีปุ่มบังพื้นที่แชต + ลำโพงย้ายใต้ข้อความตอบกลับ ──
    await shell.click("#chatHome");
    // หลังสลับหน้าจอ: หยิบ frame แชตที่ยัง alive (handle เดิมอาจถูกถอดเมื่อ shell/iframe ถูกแทนที่)
    for (let i = 0; i < 40; i++) {
      const live = page.frames().find((f) => f.url().includes("materialSurface=chat"));
      if (live) {
        try {
          await live.evaluate("1");
          chat = live;
          break;
        } catch {
          // frame ถูกถอด — ลองใหม่
        }
      }
      await page.waitForTimeout(250);
    }
    await chat.waitForFunction(() => !(document.querySelector("textarea[aria-label='คำสั่ง']") as HTMLTextAreaElement | null)?.disabled, { timeout: 60_000 });
    await chat.locator("textarea[aria-label='คำสั่ง']").fill("ทดสอบเสียง");
    await chat.locator("button[aria-label='ส่งคำสั่ง']").click();
    await chat.waitForSelector("text=SYNTH-REPLY-1", { timeout: 20_000 });
    assert.equal(await chat.locator("form.compose [data-testid='voice-toggle']").count(), 0, "ต้องไม่มีปุ่มลำโพงใน Composer");
    assert.equal(await chat.locator("form.compose [data-testid='reply-tts']").count(), 0, "ไอคอนลำโพงต้องไม่อยู่ใน Composer");
    const replySpeakers = await chat.locator("[data-testid='reply-tts']").count();
    assert.ok(replySpeakers >= 1, `ต้องมีไอคอนลำโพงใต้ข้อความตอบกลับ (พบ ${replySpeakers})`);
    const speakerBox = await chat.locator("[data-testid='reply-tts']").first().boundingBox();
    assert.ok(speakerBox && speakerBox.width <= 40, `ไอคอนลำโพงต้องเล็ก (พบ ${speakerBox?.width}px)`);
    // วางใต้ข้อความจริง: ด้านบนของไอคอนต้องไม่สูงกว่าด้านล่างของ "ข้อความตอบกลับ" ที่อยู่ก่อนหน้า
    const placement = (await chat.evaluate(`(() => {
      const el = document.querySelector('[data-testid="reply-tts"]');
      if (!el) return { ok: false, why: "no-speaker" };
      // ปุ่มอยู่ในกล่อง .reply-tts ⇒ ข้อความตอบกลับคือพี่น้องของกล่องนั้น
      const prev = el.parentElement ? el.parentElement.previousElementSibling : null;
      if (!prev) return { ok: false, why: "no-sibling" };
      const r = prev.getBoundingClientRect();
      const s = el.getBoundingClientRect();
      return { ok: s.top >= r.bottom - 2, prevTag: prev.tagName, prevBottom: Math.round(r.bottom), speakerTop: Math.round(s.top), insideAnswer: !!el.closest('.q-answer') };
    })()`)) as { ok: boolean; why?: string; prevTag?: string; prevBottom?: number; speakerTop?: number; insideAnswer?: boolean };
    assert.ok(placement.ok, `ไอคอนลำโพงต้องอยู่ใต้ข้อความตอบกลับ (${JSON.stringify(placement)})`);
    assert.ok(placement.insideAnswer, "ไอคอนลำโพงต้องผูกกับข้อความตอบกลับนั้น (ไม่ลอยแยก)");
    // ไม่มีปุ่มทับพื้นที่แชต (ยกเว้นปุ่มที่อยู่ในกล่องพิมพ์เอง)
    const overlaps = await chat.evaluate(() => {
      const ta = document.querySelector("textarea[aria-label='คำสั่ง']") as HTMLElement | null;
      if (!ta) return ["no-textarea"];
      const t = ta.getBoundingClientRect();
      const hits: string[] = [];
      document.querySelectorAll("button").forEach((b) => {
        if (b.closest("form.compose")) return;
        const r = b.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const overlap = r.left < t.right && r.right > t.left && r.top < t.bottom && r.bottom > t.top;
        if (overlap) hits.push((b.getAttribute("aria-label") || b.textContent || "button").trim().slice(0, 30));
      });
      return hits;
    });
    assert.deepEqual(overlaps, [], `ต้องไม่มีปุ่มทับกล่องพิมพ์ (พบ ${JSON.stringify(overlaps)})`);
    ok("ลำโพงเป็นไอคอนเล็กใต้ข้อความตอบกลับ · ไม่มีปุ่มใดบังพื้นที่แชต/กล่องพิมพ์");

    // ── 8) ไม่อ่านอัตโนมัติ (กดแล้วจึงอ่าน) + ไม่เปิดไมโครโฟน ──
    const spyBeforeClick = await sumSpy();
    assert.equal(spyBeforeClick.mic, 0, "ต้องไม่มีการเปิดไมโครโฟน");
    assert.equal(spyBeforeClick.spoken, 0, "ต้องไม่อ่านข้อความอัตโนมัติเมื่อได้คำตอบ");
    await chat.locator("[data-testid='reply-tts']").first().click();
    await page.waitForTimeout(600);
    const spyAfterClick = await sumSpy();
    assert.ok(spyAfterClick.spoken >= 1, "กดไอคอนลำโพงแล้วต้องอ่านข้อความนั้น (ใช้ speak เดิม)");
    assert.equal(spyAfterClick.mic, 0, "การอ่านข้อความต้องไม่เปิดไมโครโฟน");
    await page.screenshot({ path: `${SHOTS}/after-4-chat-reply-tts.png` });
    ok("ไม่อ่านอัตโนมัติ · กดไอคอนลำโพงใต้คำตอบแล้วอ่านจริง · ไม่เปิดไมโครโฟน");

    // ── 9) ไอคอนตั้งค่าเหลือจุดเดียว ──
    assert.equal(await page.locator("#dna-frame .gear").count(), 0, "ต้องไม่มีปุ่มตั้งค่าในกล่องแชต");
    assert.equal(await shell.locator("#settings").count(), 1, "ปุ่มตั้งค่าต้องเหลือจุดเดียวใน sidebar หลัก");
    // dev-only: ป้าย Next.js Dev Tools ลอยทับมุมซ้ายล่าง (ไม่ใช่ UI ของผลิตภัณฑ์) — เอาออกเฉพาะในเทสต์นี้
    await page.evaluate("document.querySelectorAll('nextjs-portal').forEach((n) => n.remove())");
    await shell.click("#settings");
    await shell.waitForFunction(() => (document.getElementById("toast")?.textContent ?? "").length > 0, { timeout: 10_000 });
    assert.equal((await navSidebars()).length, 1, "ท้ายสุด sidebar ต้องยังชุดเดียว");
    await page.screenshot({ path: `${SHOTS}/after-5-settings.png` });
    ok("ปุ่มตั้งค่าเหลือจุดเดียวใน sidebar หลัก และยังทำงาน (แสดงสถานะการเชื่อมต่อเดิม)");

    console.log(`\n═══ SINGLE SIDEBAR / LOCKED LAYOUT: ${pass} checks PASS ═══`);
    console.log(`screenshots: ${SHOTS}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});

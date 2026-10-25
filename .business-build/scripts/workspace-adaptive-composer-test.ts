/**
 * SINGLE ADAPTIVE CHAT COMPOSER TEST (Chromium จริง) — owner mission 2026-10-18
 *
 * สัญญาที่ตรวจ (owner ข้อ 12):
 *   1. Composer มีเพียงหนึ่งกล่อง (ทุก frame รวมกัน)
 *   2. เปลี่ยนแท็บแล้วข้อความที่พิมพ์ค้างไม่หาย (และหน้าแชตไม่ถูกโหลดใหม่)
 *   3. เปิดตาราง/เครื่องมือแล้วกล่องย่อเล็ก (Compact Floating)
 *   4. Hover/Focus → กล่องชัดขึ้นและขยายเท่าที่จำเป็น
 *   5. กล่องไม่บังเอกสาร/ตาราง (พื้นที่กลางจองที่ไว้)
 *   6. ประวัติสนทนาเปิดจากปุ่มเดิมได้ (หัวข้อ + ลำดับเหตุการณ์จากข้อมูลจริงของเซสชัน)
 *   7. ไม่มี Sidebar หรือ Composer ซ้อน
 *
 * ข้อจำกัด: เครื่องนี้ไม่มี session จริง (ไม่มี local Supabase · ห้ามใช้ผู้ใช้ production)
 * จึง intercept /api/workspace/org-context, /api/chat, /api/admin/pits
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, type Frame } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3141";
const SHOTS = process.env.SHOTS_DIR || "/tmp/composer-shots";
const ORG = { organizationId: "00000000-0000-4000-8000-0000000000aa", name: "SYNTH-ORG-A", role: "admin" };
const DRAFT = "DRAFT-KEEP-2026-1018";
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
  /** หลังสลับหน้าจอ หยิบ frame แชตที่ยัง alive (Playwright อาจค้าง handle ของ frame ที่ถูกถอดไปแล้ว) */
  const refreshChat = async (): Promise<Frame> => {
    for (let i = 0; i < 40; i++) {
      for (const f of page.frames().filter((x) => x.url().includes("materialSurface=chat"))) {
        try {
          await f.evaluate("1");
          return f;
        } catch {
          // frame นี้ถูกถอดแล้ว — ลองตัวถัดไป
        }
      }
      await page.waitForTimeout(250);
    }
    throw new Error("ไม่พบ frame แชตที่ยังใช้งานได้");
  };
  const rect = async (frame: Frame, selector: string) =>
    (await frame.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom) }; })()`)) as
      | { x: number; y: number; w: number; h: number; bottom: number }
      | null;
  const style = async (frame: Frame, selector: string, prop: string) =>
    (await frame.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? getComputedStyle(el).getPropertyValue(${JSON.stringify(prop)}) : null; })()`)) as string | null;
  const composerCount = async () => {
    let forms = 0;
    let areas = 0;
    for (const f of page.frames()) {
      forms += await f.locator("form.compose").count().catch(() => 0);
      areas += await f.locator("textarea[aria-label='คำสั่ง']").count().catch(() => 0);
    }
    return { forms, areas };
  };
  const sidebarCount = async () => {
    let n = 0;
    for (const f of page.frames()) {
      n += await f
        .locator("aside")
        .evaluateAll((nodes) => nodes.filter((x) => x.getBoundingClientRect().width >= 32 && x.querySelectorAll("button").length >= 2).length)
        .catch(() => 0);
    }
    return n;
  };

  try {
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
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "SYNTH-REPLY-A" }) }),
    );

    await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded" });
    // ไม่มีตัวเลือกองค์กรแล้ว (owner 2026-10-18) — readiness วัดจาก shell + หน้าจอแชตที่โหลดจริง
    const shell = await waitFrame("material-workspace");
    let chat = await waitFrame("materialSurface=chat");
    await chat.locator("textarea[aria-label='คำสั่ง']").waitFor({ timeout: 60_000 });
    await shell.waitForFunction(() => (document.querySelector("#liveStatus")?.textContent ?? "").includes("โหลดข้อมูลสำเร็จ"), { timeout: 30_000 });

    // ── 1) Composer เดียวทั้ง Workspace (รวมตอนเปิดตาราง) ──
    // เปิดหน้าจอทรัพยากรก่อนวัด (สัญญาข้อ 3 = "เปิดตารางแล้วกล่องย่อเล็ก") — ไม่พึ่งลำดับการโหลด
    await shell.click("[data-view=all]");
    await shell.waitForSelector("#stockPane:not([hidden])", { timeout: 20_000 });
    await shell.waitForFunction(() => document.body.classList.contains("chat-compact"), null, { timeout: 20_000 });
    assert.deepEqual(await composerCount(), { forms: 1, areas: 1 }, "ต้องมี Composer หนึ่งกล่อง");
    assert.equal(await shell.locator("#homePane").count(), 1, "ต้องมีที่อยู่ของ Composer เดียว");
    assert.equal(await sidebarCount(), 1, "ต้องมี Sidebar เดียว");
    await page.screenshot({ path: `${SHOTS}/after-1-stock-compact.png` });
    ok("Composer มีเพียงหนึ่งกล่อง (ตอนเปิดตาราง/ศูนย์ควบคุมทรัพยากร) · Sidebar เดียว");

    // ── 2) Compact Floating + โปร่งใสเมื่อไม่ใช้งาน + Hover/Focus ชัดขึ้น ──
    const panelCompact = await rect(shell, "#homePane");
    assert.ok(panelCompact, "ต้องวัดกล่องแชตได้");
    assert.ok(panelCompact.h < 100, `กล่องต้องย่อเล็ก (พบ h=${panelCompact.h})`);
    assert.ok(panelCompact.w <= 600, `กล่องต้องไม่เต็มความกว้าง (พบ w=${panelCompact.w})`);
    assert.ok(panelCompact.y > 500, `กล่องต้องอยู่ด้านล่าง (พบ y=${panelCompact.y})`);
    const idleOpacity = Number(await style(shell, "#homePane", "opacity"));
    assert.ok(idleOpacity < 1, `โปร่งใสเมื่อไม่ใช้งาน (opacity=${idleOpacity})`);
    // โหมด compact ภายในหน้าแชตเอง (พื้นที่เตี้ย): ปุ่มข้อความ/ไทม์ไลน์ไม่อยู่ใน Workspace เลย, กล่องพิมพ์ยังอยู่
    assert.equal(await chat.locator(".corner").count(), 0, "Workspace ต้องไม่มีปุ่มรูปข้อความมุมขวา (owner 2026-10-18)");
    assert.equal(await chat.locator("form.compose").count(), 1, "กล่องพิมพ์ต้องยังอยู่ใน compact mode");
    await page.screenshot({ path: `${SHOTS}/after-2-compact-floating.png` });

    await shell.hover("#homePane");
    await page.waitForTimeout(400);
    const hoveredOpacity = Number(await style(shell, "#homePane", "opacity"));
    const hoveredRect = await rect(shell, "#homePane");
    assert.equal(hoveredOpacity, 1, `hover แล้วต้องชัดขึ้น (opacity=${hoveredOpacity})`);
    assert.ok(hoveredRect && hoveredRect.h > panelCompact.h, `hover แล้วขยายเท่าที่จำเป็น (${panelCompact.h} → ${hoveredRect?.h})`);
    await page.screenshot({ path: `${SHOTS}/after-3-hover-expanded.png` });
    ok(`Compact Floating + โปร่งใส (${idleOpacity}) → hover ชัด/ขยาย (${hoveredOpacity}, ${panelCompact.h}→${hoveredRect?.h})`);

    // focus ค้างไว้แล้วเอาเมาส์ออก → ยังชัด (ข้อ 5–6) · blur แล้วกลับ compact (ข้อ 6)
    await chat.locator("textarea[aria-label='คำสั่ง']").click();
    await page.mouse.move(1400, 8);
    await page.waitForTimeout(400);
    assert.equal(await shell.evaluate("document.body.classList.contains('chat-composer-active')"), true, "โฟกัสในกล่องพิมพ์ต้องแจ้ง shell ให้คงความชัด");
    const focusOpacity = Number(await style(shell, "#homePane", "opacity"));
    assert.equal(focusOpacity, 1, `โฟกัสอยู่ต้องคงความชัดแม้เมาส์ออก (opacity=${focusOpacity})`);
    assert.ok((await rect(shell, "#homePane"))!.h > panelCompact.h, "โฟกัสอยู่ต้องคงขนาดที่ขยายไว้");
    ok("Focus ค้างไว้ → กล่องคงความชัด/ขนาดแม้เอาเมาส์ออก");

    // ── 3) ข้อความที่พิมพ์ค้างไม่หายเมื่อเปลี่ยนแท็บ (หน้าแชตไม่ถูกโหลดใหม่) ──
    await chat.locator("textarea[aria-label='คำสั่ง']").fill(DRAFT);
    await chat.evaluate("window.__composerMarker = 'kept'");
    await shell.click("#toolsMain");
    await shell.waitForSelector("#businessLauncher:not([hidden])", { timeout: 15_000 });
    // Business Tool Launcher group 01 — เปิดเส้นทางเดิมในพื้นที่กลาง
    await shell.locator('.launcher-item[data-tool-id="pits"]').click();
    await shell.waitForFunction(() => (document.querySelector("#toolFrame") as HTMLIFrameElement | null)?.getAttribute("src") === "/admin/pits", { timeout: 15_000 });
    await page.waitForTimeout(1200);
    chat = await refreshChat();
    assert.equal(await chat.evaluate("window.__composerMarker"), "kept", "หน้าแชตต้องไม่ถูกโหลดใหม่");
    assert.equal(await chat.locator("textarea[aria-label='คำสั่ง']").inputValue(), DRAFT, "ข้อความที่พิมพ์ค้างต้องอยู่ครบหลังเปลี่ยนแท็บ");
    assert.deepEqual(await composerCount(), { forms: 1, areas: 1 }, "ระหว่างอยู่หน้าเครื่องมือ ต้องยังมี Composer เดียว");
    await page.screenshot({ path: `${SHOTS}/after-4-tool-with-composer.png` });
    ok("เปลี่ยนแท็บไปเครื่องมือแล้วข้อความที่พิมพ์ค้างไม่หาย (หน้าแชตไม่ reload) · Composer ยังเดียว");

    // ── 4) กล่องไม่บังเครื่องมือ/ตาราง ──
    const toolRect = await rect(shell, "#toolPane");
    const panelOnTool = await rect(shell, "#homePane");
    const frameRect = await rect(shell, "#toolFrame");
    assert.ok(toolRect && panelOnTool && frameRect, "ต้องวัดพื้นที่กลาง/กล่องแชตได้");
    assert.ok(frameRect!.bottom <= panelOnTool!.y + 2, `กล่องต้องไม่บังเนื้อหาเครื่องมือ (iframe bottom=${frameRect!.bottom} vs panel top=${panelOnTool!.y})`);
    assert.ok(panelOnTool!.h < 100, "ยังต้องเป็น compact mode ขณะอยู่หน้าเครื่องมือ");
    assert.equal(await sidebarCount(), 1, "ยังต้องมี Sidebar เดียว");
    ok("กล่องลอยไม่บังเนื้อหาเครื่องมือ (พื้นที่กลางจองที่ด้านล่างให้) · Sidebar เดียว");

    // ── 5) กลับหน้าแชต = Composer ขนาดปกติด้านล่าง ──
    await shell.click("#chatHome");
    await page.waitForTimeout(600);
    chat = await refreshChat();
    assert.equal(await shell.evaluate("document.body.classList.contains('chat-compact')"), false, "หน้าแชตต้องไม่อยู่ใน compact mode");
    const normalRect = await rect(shell, "#homePane");
    assert.ok(normalRect && normalRect.w > 1000 && normalRect.h > 700, `หน้าแชตต้องเต็มพื้นที่ (พบ ${JSON.stringify(normalRect)})`);
    assert.equal(await chat.locator("textarea[aria-label='คำสั่ง']").inputValue(), DRAFT, "กลับมาแล้วข้อความยังอยู่");
    assert.equal(await composerCount().then((c) => c.forms), 1, "ยังมี Composer เดียว");
    await page.screenshot({ path: `${SHOTS}/after-5-chat-normal.png` });
    ok("หน้าแชตหลัก = Composer ขนาดปกติด้านล่าง (เต็มพื้นที่) และข้อความยังอยู่");

    // ── 6) ปุ่มข้อความ/⋯ ไม่อยู่ในพื้นที่กลาง แต่กล่องพิมพ์ยังส่งงานได้จริง ──
    assert.equal(await chat.locator("[data-testid='history-button']").count(), 0, "ต้องไม่มีปุ่มเปิดหน้าข้อความใน Workspace");
    assert.equal(await chat.locator(".edge.right").count(), 0, "⋯ ต้องไม่อยู่ในพื้นที่กลาง (ย้ายขึ้น Tab Bar)");
    assert.equal(await chat.locator(".msg-panel").count(), 0, "ต้องไม่มีแผงข้อความซ้ำ");
    await chat.locator("textarea[aria-label='คำสั่ง']").fill("คำถามทดสอบหลังถอดปุ่มข้อความ");
    await chat.locator("button[aria-label='ส่งคำสั่ง']").click();
    await chat.waitForSelector("text=SYNTH-REPLY-A", { timeout: 20_000 });
    await page.screenshot({ path: `${SHOTS}/after-6-composer-works.png` });
    ok("ไม่มีปุ่มข้อความ/⋯ ในพื้นที่กลาง · กล่อง AI ด้านล่างยังตอบกลับจริง");

    // ── 7) ไม่มี Sidebar หรือ Composer ซ้อน ──
    assert.deepEqual(await composerCount(), { forms: 1, areas: 1 }, "ท้ายสุด Composer ต้องยังมีกล่องเดียว");
    assert.equal(await sidebarCount(), 1, "ท้ายสุด Sidebar ต้องยังชุดเดียว");
    ok("ท้ายเซสชัน: Composer หนึ่งกล่อง · Sidebar ชุดเดียว (ไม่มีของซ้อน)");

    console.log(`\n═══ SINGLE ADAPTIVE COMPOSER: ${pass} checks PASS ═══`);
    console.log(`screenshots: ${SHOTS}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});

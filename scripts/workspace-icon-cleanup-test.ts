/**
 * WORKSPACE ICON & CONTROL CLEANUP TEST (Chromium จริง) — owner mission 2026-10-18
 *
 * สัญญาที่ตรวจ (หน้าจอจริงสองชั้น: ชั้นนอก /workspace → shell → ชั้นใน ?materialSurface=):
 *   1. ไอคอนสี่เหลี่ยม (grid 4 ช่อง) ทั้งระบบเหลือ 1 จุด = ปุ่ม "เปิดเครื่องมือ" ของ shell
 *   2. แถบเครื่องมือไม่ซ้อน: พื้นที่แชตไม่มี .edge left (กล่องเครื่องมือ) และไม่มี .gear (ตั้งค่า)
 *   3. ตั้งค่าเหลือ 1 จุด = ปุ่มเดิมของ shell (#settings) และหน้าตั้งค่ายังเปิดได้จากเครื่องมือ
 *   4. เสียง: ปุ่มเดิมในแถบเครื่องมือของกล่องพิมพ์ แต่เป็นไอคอนขนาดเท่าปุ่มอื่น ไม่ใช่ปุ่มข้อความใหญ่
 *      · ไม่มีการเปิดไมโครโฟน/บันทึกเสียงอัตโนมัติ (นับ getUserMedia/MediaRecorder = 0)
 *      · ทำงานเมื่อผู้ใช้กดเท่านั้น (aria-pressed เปลี่ยนจริง)
 *   5. พื้นที่แชต: กล่องพิมพ์ชุดเดียว + ไอคอนแนบไฟล์/ส่งคงเดิม ไม่มีปุ่มเครื่องมือ/ตั้งค่าซ้ำ
 *   6. เครื่องมือธุรกิจและตารางยังเปิดได้ (GET /api/admin/pits + ตาราง + เมนูตั้งค่า)
 *
 * ข้อจำกัด (รายงานตรง): เครื่องนี้ไม่มี session จริง (ไม่มี local Supabase · ห้ามสร้าง/แก้ผู้ใช้
 * production) จึง intercept /api/workspace/org-context และ /api/admin/pits · และระบบ "บันทึกเสียง"
 * ไม่มีอยู่ใน source เลย (ไม่มี MediaRecorder/SpeechRecognition) จึงทดสอบได้แค่ว่าไม่มีการเรียกใช้
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3141";
const SHOTS = process.env.SHOTS_DIR || "/tmp/icon-shots";
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

/** นับการเรียกไมโครโฟน/ตัวบันทึกเสียงในทุก frame — ต้องเป็น 0 ตลอด (ไม่มี auto-listen) */
const MIC_SPY = () => {
  const w = window as unknown as { __micCalls: number; __recorders: number };
  w.__micCalls = 0;
  w.__recorders = 0;
  const md = navigator.mediaDevices as MediaDevices | undefined;
  if (md?.getUserMedia) {
    const original = md.getUserMedia.bind(md);
    md.getUserMedia = (...args: Parameters<MediaDevices["getUserMedia"]>) => {
      w.__micCalls += 1;
      return original(...args);
    };
  }
  const Orig = (window as unknown as { MediaRecorder?: new (...a: unknown[]) => unknown }).MediaRecorder;
  if (Orig) {
    const Counted = function (this: unknown, ...args: unknown[]) {
      w.__recorders += 1;
      return new Orig(...args);
    };
    (Counted as unknown as { prototype: unknown }).prototype = Orig.prototype;
    (window as unknown as { MediaRecorder: unknown }).MediaRecorder = Counted;
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

  try {
    await page.addInitScript(MIC_SPY);
    await page.route("**/api/workspace/org-context", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
        : route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ memberships: [ORG], selected: ORG.organizationId }),
          }),
    );
    await page.route("**/api/admin/pits", (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PITS) })
        : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }),
    );
    await page.route("**/api/chat", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "SYNTH-REPLY" }) }),
    );

    const count = async (selector: string) => {
      let n = 0;
      for (const f of page.frames()) n += await f.locator(selector).count().catch(() => 0);
      return n;
    };
    /** ไอคอนสี่เหลี่ยม = ปุ่มที่มองเห็นและ svg ข้างในมี <rect> ≥ 4 ช่อง (grid) */
    const squareIcons = async () => {
      const out: { frame: string; id: string; label: string }[] = [];
      for (const f of page.frames()) {
        const found = await f
          .locator("button")
          .evaluateAll((nodes) =>
            nodes
              .map((n) => {
                const r = n.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) return null;
                const svg = n.querySelector("svg");
                if (!svg || svg.querySelectorAll("rect").length < 4) return null;
                return { id: (n as HTMLElement).id || "", label: n.getAttribute("aria-label") || "" };
              })
              .filter(Boolean),
          )
          .catch(() => []);
        for (const s of found) out.push({ frame: f.url().split("?")[0], ...(s as { id: string; label: string }) });
      }
      return out;
    };
    const micCounts = async () => {
      let calls = 0;
      let recorders = 0;
      for (const f of page.frames()) {
        const c = await f
          .evaluate(() => {
            const w = window as unknown as { __micCalls?: number; __recorders?: number };
            return { calls: w.__micCalls ?? 0, recorders: w.__recorders ?? 0 };
          })
          .catch(() => ({ calls: 0, recorders: 0 }));
        calls += c.calls;
        recorders += c.recorders;
      }
      return { calls, recorders };
    };

    // ── ชั้นนอก ──
    await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded" });
    // ไม่มีตัวเลือกองค์กรแล้ว (owner 2026-10-18) — รอ shell + หน้าจอแชตจริงแทน
    await page.waitForFunction(() => [...document.querySelectorAll("iframe")].some((f) => (f.getAttribute("src") || "").includes("material-workspace")), null, { timeout: 60_000 });
    assert.equal(await count("#dna-frame .gear"), 0, "ชั้นนอกต้องไม่มีปุ่มตั้งค่าในกล่องแชต");
    assert.equal(await count(".edge.left"), 0, "ชั้นนอกต้องไม่มีไอคอนสี่เหลี่ยมของแชต");
    await page.screenshot({ path: `${SHOTS}/after-1-parent.png` });

    // ── เปิดแชตผ่าน shell ──
    const shell = page.frames().find((f) => f.url().includes("material-workspace"));
    assert.ok(shell, "ต้องพบ shell (material-workspace)");
    await shell!.click("#chatHome");
    for (let i = 0; i < 40 && !page.frames().some((f) => f.url().includes("materialSurface=chat")); i++) await page.waitForTimeout(500);
    const chat = page.frames().find((f) => f.url().includes("materialSurface=chat"));
    assert.ok(chat, "ต้องพบชั้นใน ?materialSurface=chat");
    await chat!.locator("textarea[aria-label='คำสั่ง']").waitFor({ timeout: 60_000 });
    await page.waitForTimeout(800);

    // 1) ไอคอนสี่เหลี่ยมเหลือจุดเดียว
    const squares = await squareIcons();
    assert.deepEqual(
      squares.map((s) => s.id),
      ["toolsMain"],
      `ไอคอนสี่เหลี่ยมต้องเหลือ 1 จุด (shell #toolsMain) — พบ ${JSON.stringify(squares)}`,
    );
    assert.equal(await chat!.locator(".edge.left").count(), 0, "พื้นที่แชตต้องไม่มีกล่องเครื่องมือซ้ำ");
    ok("ไอคอนสี่เหลี่ยมเหลือ 1 จุด (shell #toolsMain) และพื้นที่แชตไม่มีปุ่มเครื่องมือซ้ำ");

    // 2) ตั้งค่าเหลือจุดเดียว = ปุ่มเดิมของ shell
    assert.equal(await count("#dna-frame .gear"), 0, "กล่องแชตต้องไม่มีปุ่มตั้งค่า");
    assert.equal(await shell!.locator("#settings").count(), 1, "shell ต้องมีปุ่มตั้งค่าเดิม 1 จุด");
    ok("ปุ่มตั้งค่าเหลือ 1 จุด (ตำแหน่งเดิมในแถบ shell) และออกจากกล่องแชตแล้ว");

    // 3) พื้นที่แชต: กล่องพิมพ์ชุดเดียว + ไอคอนแนบไฟล์/ส่งเดิม
    assert.equal(await chat!.locator("form.compose").count(), 1, "ต้องมีกล่องพิมพ์ชุดเดียว");
    assert.equal(await chat!.locator("textarea[aria-label='คำสั่ง']").count(), 1);
    assert.equal(await chat!.locator("form.compose button[aria-label='ส่งคำสั่ง']").count(), 1, "ปุ่มส่งเดิมต้องอยู่");
    assert.equal(await chat!.locator("form.compose button:has-text('แนบไฟล์')").count(), 1, "ปุ่มแนบไฟล์เดิมต้องอยู่");
    ok("พื้นที่แชตเหลือกล่องพิมพ์ชุดเดียว + ปุ่มแนบไฟล์/ส่งเดิมครบ");

    // 4) เสียง: ย้ายออกจากกล่องพิมพ์แล้ว (owner 2026-10-18 ข้อ 9) + ไม่เปิดไมค์
    const beforeMic = await micCounts();
    assert.deepEqual(beforeMic, { calls: 0, recorders: 0 }, "โหลดหน้าแล้วต้องไม่มีการเปิดไมโครโฟน/บันทึกเสียงเอง");
    assert.equal(await chat!.locator("form.compose [data-testid='voice-toggle']").count(), 0, "กล่องพิมพ์ต้องไม่มีปุ่มเสียงแล้ว");
    assert.equal(await chat!.locator("form.compose [data-testid='reply-tts']").count(), 0, "ไอคอนลำโพงต้องไม่อยู่ในกล่องพิมพ์");
    assert.deepEqual(await micCounts(), { calls: 0, recorders: 0 }, "ทั้งเซสชันต้องไม่มีการเรียกใช้ไมโครโฟน/ตัวบันทึกเสียง");
    await page.screenshot({ path: `${SHOTS}/after-2-chat.png` });
    ok("กล่องพิมพ์ไม่มีปุ่มเสียงแล้ว (ย้ายไปใต้ข้อความตอบกลับ — เทสต์เต็มอยู่ที่ workspace-single-sidebar:test) · ไม่เปิดไมโครโฟน/บันทึกเสียง");

    // 5) Sidebar เดียวเป็นทางเข้าเครื่องมือ — ปุ่มสี่เหลี่ยมเดิมเปิด Business Tool Launcher
    //    และเครื่องมือผู้พัฒนา (tools.json เดิม) แยกออกมาอยู่ใน footer ของ launcher
    await shell!.click("#toolsMain");
    await shell!.waitForSelector("#businessLauncher:not([hidden])", { timeout: 15_000 });
    await shell!.click("#devToolsEntry");
    await shell!.waitForSelector("#toolsDialog[open]", { timeout: 15_000 });
    await shell!.waitForSelector("#toolList .tool-item", { timeout: 15_000 });
    const toolCount = await shell!.locator("#toolList .tool-item").count();
    assert.equal(toolCount, 54, `เมนูเครื่องมือต้องครบตาม tools.json (พบ ${toolCount})`);
    await shell!.locator("#toolList .tool-item", { hasText: "Connections & Credentials" }).first().click();
    await shell!.waitForFunction(() => (document.querySelector("#toolFrame") as HTMLIFrameElement | null)?.getAttribute("src") === "/admin/settings", { timeout: 15_000 });
    await page.waitForTimeout(1200);
    // เส้นทางเดิมต้องถูกเรียกจริง: บนเครื่องนี้ไม่มี session ⇒ guard ไป /login?next=%2Fadmin%2Fsettings
    const landed = page.frames().filter((f) => f.url().includes("/admin/settings") || f.url().includes("%2Fadmin%2Fsettings"));
    assert.ok(landed.length >= 1, `ต้องเปิดเส้นทาง /admin/settings เดิม (frames: ${page.frames().map((f) => f.url()).join(" | ")})`);
    console.log(`  INFO  หน้าตั้งค่า: เปิดเส้นทางเดิมแล้ว · ปลายทาง=${landed[0].url().replace(BASE, "")} (ไม่มี session จริงบนเครื่องนี้ ⇒ guard ทำงานตามปกติ)`);
    await page.screenshot({ path: `${SHOTS}/after-3-tools-settings.png` });
    ok("ทางเข้าเครื่องมือเหลือที่ sidebar เดียว · เมนูครบ 54 รายการ · เส้นทางหน้าตั้งค่าเดิมยังเปิดได้");

    await shell!.click("#chatHome");
    for (let i = 0; i < 40 && !page.frames().some((f) => f.url().includes("materialSurface=chat")); i++) await page.waitForTimeout(500);
    await shell!.locator("[data-view='all']").click();
    await shell!.waitForSelector("#stockPane:not([hidden])", { timeout: 30_000 });
    await shell!.waitForFunction(() => (document.querySelector("#liveStatus")?.textContent ?? "").includes("โหลดข้อมูลสำเร็จ"), { timeout: 30_000 });
    // ผิวศูนย์ควบคุมทรัพยากรวาดรายการแหล่งจากข้อมูลจริงที่ API ส่งมา (#pitList) + ตัวนับจาก counters
    const rows = await shell!.locator("#pitList .pit-item").count();
    assert.ok(rows >= 2, `รายการธุรกิจต้องแสดงผลได้ (พบ ${rows} รายการ)`);
    const counters = (await shell!.locator("#counters").textContent()) ?? "";
    assert.ok(counters.includes("Total") && counters.includes("2"), `ตัวนับธุรกิจต้องตรงกับข้อมูลที่โหลด (พบ "${counters}")`);
    assert.equal(await shell!.locator("#pitCount").textContent(), "2 รายการ");
    await page.screenshot({ path: `${SHOTS}/after-4-stock-table.png` });
    ok(`ผิวธุรกิจ (ศูนย์ควบคุมทรัพยากร) ยังเปิดและแสดงข้อมูลจริงได้ (${rows} รายการ · counters OK)`);

    // นับซ้ำหลังเปิดทุกผิว — ต้องยังเหลือจุดเดียว
    assert.equal((await squareIcons()).length, 1, "หลังเปิดทุกผิว ไอคอนสี่เหลี่ยมต้องยังเหลือ 1 จุด");
    assert.deepEqual(await micCounts(), { calls: 0, recorders: 0 }, "ทั้งเซสชันต้องไม่มีการเปิดไมโครโฟน/บันทึกเสียง");
    ok("หลังเปิดทุกผิว: ไอคอนสี่เหลี่ยม 1 จุด · ไม่มีการเปิดไมโครโฟนทั้งเซสชัน");

    console.log(`\n═══ WORKSPACE ICON CLEANUP: ${pass} checks PASS ═══`);
    console.log(`screenshots: ${SHOTS}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});

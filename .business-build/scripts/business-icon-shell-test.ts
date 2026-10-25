/**
 * BUSINESS ICON SHELL BASELINE — Browser test (Chromium จริง, owner 2026-10-18)
 *
 * ตรวจ Phase 6 ของคำสั่ง:
 *   · Tool Launcher เหลือจุดเดียว (ปุ่มสี่เหลี่ยมเดิม #toolsMain) · hover เปิด · click เปิด/ปิด
 *   · 6 กลุ่ม 01–06 · โลโก้ผู้ให้บริการจริงโหลดได้ · ไม่มีไอคอน/รายการซ้ำ
 *   · สถานะมาจาก Connect Registry เดิมเท่านั้น (CONNECTED / NOT CONNECTED / NOT CONFIGURED / UNAVAILABLE)
 *   · เครื่องมือผู้พัฒนาแยกออกจากรายการธุรกิจ (Railway/Supabase/GitHub ไม่อยู่ใน launcher ธุรกิจ)
 *   · Company Profile: เมนูเดิม (ข้อมูลบริษัท/ตั้งค่า/ค่าใช้จ่าย) + อัปโหลดโลโก้ผ่าน Storage/สิทธิ์เดิม
 *   · Sidebar ไม่ซ้อน · Tab/Header ไม่ขยับ · Back/Forward ทำงาน · หน้าจอไม่ล้น/ทับ
 *
 * ข้อจำกัดของเครื่องนี้: ไม่มี session จริง ⇒ intercept เฉพาะ API ที่ต้องใช้ตรวจ UI
 * (รูปแบบ response คัดจาก route เดิมจริง — ไม่ได้แก้ route หรือข้อมูลธุรกิจ)
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { chromium, type Frame, type Page } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3141";
const SHOTS = process.env.SHOTS_DIR || "/tmp/business-icon-shots";
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
const CONNECTORS = {
  connectors: [
    { id: "c-line", slug: "line", name: "LINE OA", config: { provider: "line_messaging_api" }, status: "connected", enabled: true },
    { id: "c-gmail", slug: "gmail", name: "Gmail", config: { provider: "gmail" }, status: "connected", enabled: true },
    { id: "c-facebook", slug: "facebook", name: "Facebook", config: { provider: "facebook" }, status: "error", enabled: true },
    { id: "c-kbank", slug: "kasikorn", name: "Kasikorn", config: { provider: "kasikorn_bank" }, status: "connected", enabled: false },
  ],
};
const PROVIDERS = {
  providers: [
    { provider_id: "instagram", connection_status: "DISCOVERED_NOT_CONNECTED" },
    { provider_id: "tiktok", connection_status: "WAITING_FOR_CREDENTIAL" },
    { provider_id: "google_drive", connection_status: "NOT_YET_VERIFIED" },
    { provider_id: "pdf", connection_status: "CONNECTED" },
  ],
};
const COMPANY = {
  companyName: "SYNTH COMPANY",
  companyTaxId: "0100000000000",
  paymentBankName: "Kasikornbank",
  paymentAccountNumber: "000-0-00000-0",
  paymentAccountName: "SYNTH COMPANY",
  vatRate: 0.07,
  documentTerms: "",
  documentFooterNote: "",
  companyLogoPath: "",
  debtReminderAutoEnabled: false,
  debtReminderHour: 9,
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
  const logoUploadRequests: Record<string, unknown>[] = [];

  await page.route("**/api/workspace/org-context", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ memberships: [ORG], selected: ORG.organizationId }) }),
  );
  await page.route("**/api/admin/pits", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PITS) }),
  );
  await page.route("**/api/admin/connectors", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CONNECTORS) }),
  );
  await page.route("**/api/admin/connectors/providers", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROVIDERS) }),
  );
  await page.route("**/api/admin/pulse", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ pendingDocs: [], activeJobs: [] }) }),
  );
  await page.route("**/api/admin/outbound-drafts", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ drafts: [] }) }),
  );
  await page.route("**/api/admin/settings", async (route) => {
    const req = route.request();
    if (req.method() === "PUT") {
      const body = JSON.parse(req.postData() || "{}");
      logoUploadRequests.push(body);
      COMPANY.companyLogoPath = String(body.companyLogoPath ?? "");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ settings: COMPANY }) });
  });
  await page.route("**/api/admin/upload?path=*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: "/brand/providers/line.svg?company-logo=1" }) }),
  );
  await page.route("**/api/admin/upload", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ path: "company-profile/1_logo.png", name: "logo.png", size: 1234, type: "image/png" }),
    });
  });

  await page.goto(`${BASE}/workspace`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  const shell = page.frames().find((f) => f.url().includes("material-workspace"));
  assert.ok(shell, "ต้องพบ shell (material-workspace)");
  const s = shell as Frame;

  const rect = async (selector: string) =>
    (await s.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })()`)) as
      | { x: number; y: number; w: number; h: number }
      | null;
  const navSidebars = async () =>
    (await s.evaluate(`(() => Array.from(document.querySelectorAll('aside')).map((n) => { const r = n.getBoundingClientRect(); return { width: Math.round(r.width), x: Math.round(r.x), buttons: n.querySelectorAll('button').length }; }).filter((x) => x.width >= 32 && x.buttons >= 2))()`)) as { width: number; x: number; buttons: number }[];
  const statusOf = async (id: string) =>
    (await s.locator(`.launcher-item[data-tool-id="${id}"]`).getAttribute("data-status")) ?? null;

  await page.screenshot({ path: `${SHOTS}/before-1-default.png` });

  // ── 1) Tool Launcher เหลือจุดเดียว + 6 กลุ่ม + ไม่มีรายการซ้ำ ───────────────
  assert.equal(await s.locator("#toolsMain").count(), 1, "ปุ่มสี่เหลี่ยมต้องมีจุดเดียว");
  await s.locator("#toolsMain").hover();
  await s.waitForSelector("#businessLauncher:not([hidden])", { timeout: 15_000 });
  await s.waitForFunction(() => (document.querySelector("#launcherRegistryNote")?.textContent ?? "").includes("Connect Registry เดิม"), { timeout: 15_000 });
  const groupIds = await s.locator(".launcher-group").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-group")));
  assert.deepEqual(groupIds, ["01", "02", "03", "04", "05", "06"], `ต้องมี 6 กลุ่มตามลำดับ (พบ ${JSON.stringify(groupIds)})`);
  const itemIds = await s.locator(".launcher-item").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-tool-id")));
  assert.equal(new Set(itemIds).size, itemIds.length, "ต้องไม่มีเครื่องมือซ้ำ");
  assert.equal(itemIds.length, 22, `ต้องมี 22 รายการ (พบ ${itemIds.length})`);
  ok("Tool Launcher จุดเดียว · 6 กลุ่ม 01–06 · 22 รายการ · ไม่มีรายการซ้ำ");

  // ── 2) โลโก้จริงโหลดได้ + สถานะจาก Connect Registry ─────────────────────────
  const logoCount = await s.locator(".launcher-item .tool-logo img").count();
  assert.equal(logoCount, 12, `ต้องมีโลโก้ผู้ให้บริการ 12 ตัว (พบ ${logoCount})`);
  const broken = await s.locator(".launcher-item .tool-logo img").evaluateAll((imgs) =>
    imgs
      .map((img) => {
        const el = img as HTMLImageElement;
        return { src: el.getAttribute("src"), ok: el.complete && el.naturalWidth > 0 };
      })
      .filter((x) => !x.ok || !x.src?.startsWith("/brand/providers/")),
  );
  assert.deepEqual(broken, [], `โลโก้ต้องโหลดจาก asset จริงใน /brand/providers (${JSON.stringify(broken)})`);
  assert.equal(await statusOf("line-oa"), "CONNECTED", "LINE ต้องเป็น CONNECTED จาก connector จริง");
  assert.equal(await statusOf("gmail"), "CONNECTED", "Gmail ต้องเป็น CONNECTED จาก connector จริง");
  assert.equal(await statusOf("facebook"), "UNAVAILABLE", "Facebook status error ต้องเป็น UNAVAILABLE");
  assert.equal(await statusOf("instagram"), "NOT CONNECTED", "Instagram (provider registry) ต้องเป็น NOT CONNECTED");
  assert.equal(await statusOf("tiktok"), "NOT CONFIGURED", "TikTok WAITING_FOR_CREDENTIAL ต้องเป็น NOT CONFIGURED");
  assert.equal(await statusOf("google-drive"), "NOT CONNECTED", "Drive NOT_YET_VERIFIED ต้องเป็น NOT CONNECTED");
  assert.equal(await statusOf("pdf"), "CONNECTED", "PDF (provider registry) ต้องเป็น CONNECTED");
  assert.equal(await statusOf("kasikorn-bank"), "NOT CONNECTED", "KBank connected แต่ disabled ต้องเป็น NOT CONNECTED");
  assert.equal(await statusOf("outlook"), "NOT CONFIGURED", "Outlook ที่ไม่มี Connect Registry entry ต้องเป็น NOT CONFIGURED");
  assert.equal(await statusOf("google-docs"), "NOT CONFIGURED", "Google Docs ที่ไม่มี Connect Registry entry ต้องเป็น NOT CONFIGURED");
  ok("โลโก้จริง 12 ตัวโหลดจาก /brand/providers · สถานะ 4 แบบตรงกับ Connect Registry · โลโก้ไม่ถูกตีความเป็น connected");
  await page.screenshot({ path: `${SHOTS}/after-1-launcher.png` });

  // ── 3) click เปิด/ปิดได้ (hover เปิดแล้ว click = pin, click อีกครั้ง = ปิด) ──
  await s.locator("#toolsMain").click();
  await page.waitForTimeout(200);
  assert.equal(await s.locator("#businessLauncher").isVisible(), true, "click ครั้งแรกต้อง pin เปิดไว้");
  await s.locator("#toolsMain").click();
  await page.waitForTimeout(200);
  assert.equal(await s.locator("#businessLauncher").isVisible(), false, "click อีกครั้งต้องปิด");
  await s.locator("#toolsMain").click();
  await s.waitForSelector("#businessLauncher:not([hidden])", { timeout: 15_000 });
  ok("hover เปิดชั่วคราว · click เปิด/ปิด (pin) จากปุ่มเดิมจุดเดียว");

  // ── 4) เครื่องมือผู้พัฒนาแยกออกจากรายการธุรกิจ ──────────────────────────────
  const launcherText = (await s.locator("#businessLauncher").innerText()).toLowerCase();
  for (const forbidden of ["railway", "supabase", "github"]) {
    assert.equal(launcherText.includes(forbidden), false, `Business launcher ต้องไม่มี ${forbidden}`);
  }
  assert.equal(await s.locator("#devToolsEntry").count(), 1, "ต้องมีทางเข้าเครื่องมือผู้พัฒนาแยกจุดเดียว");
  await s.locator("#devToolsEntry").click();
  await s.waitForSelector("#toolsDialog[open]", { timeout: 15_000 });
  await s.waitForSelector("#toolList .tool-item", { timeout: 15_000 });
  assert.equal(await s.locator("#toolList .tool-item").count(), 54, "เครื่องมือผู้พัฒนาต้องยังครบ 54 รายการเดิม");
  await page.screenshot({ path: `${SHOTS}/after-2-developer-tools.png` });
  await s.locator("#closeTools").click();
  ok("Business launcher แยกจากเครื่องมือผู้พัฒนา · ไม่มี Railway/Supabase/GitHub ในรายการธุรกิจ");

  // ── 5) Company Profile: เมนูเดิม + อัปโหลดโลโก้ผ่าน storage/settings เดิม ──
  await s.locator("#companyProfile").click();
  await s.waitForSelector("#profileMenu:not([hidden])", { timeout: 15_000 });
  const profileRoutes = await s.locator("#profileMenu [data-profile-route]").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-profile-route")));
  assert.deepEqual(profileRoutes, ["/admin/settings", "/admin/settings#connections-credentials", "/admin/infrastructure"]);
  for (const route of profileRoutes) {
    const path = route!.split("#")[0].replace(/^\//, "");
    assert.ok(existsSync(`app/${path}/page.tsx`), `เมนูต้องชี้ route เดิมที่มีอยู่จริง: ${route}`);
  }
  assert.match((await s.locator("#profileCompanyName").textContent()) ?? "", /SYNTH COMPANY/, "ต้องแสดงชื่อบริษัทจาก /api/admin/settings เดิม");

  await s.locator("#profileLogoInput").setInputFiles("public/icons/icon-192.png");
  await s.waitForFunction(
    () => {
      const img = document.querySelector("#companyLogo") as HTMLImageElement | null;
      return !!img && !img.hidden && img.getAttribute("src") === "/brand/providers/line.svg?company-logo=1";
    },
    { timeout: 15_000 },
  );
  assert.equal(logoUploadRequests.length, 1, "ต้องบันทึก companyLogoPath ผ่าน /api/admin/settings เดิม 1 ครั้ง");
  assert.equal(logoUploadRequests[0].companyLogoPath, "company-profile/1_logo.png");
  assert.equal(logoUploadRequests[0].companyName, "SYNTH COMPANY", "ต้องคงข้อมูลบริษัทเดิมครบเมื่อบันทึกโลโก้");
  assert.equal(await s.locator("#companyLogo").isVisible(), true, "รูปโปรไฟล์ต้องแสดงโลโก้ที่อัปโหลด");
  await page.screenshot({ path: `${SHOTS}/after-3-profile-logo.png` });
  ok("Company Profile เปิดเมนูเดิม 3 รายการ · โลโก้บริษัทอัปโหลดผ่าน /api/admin/upload + บันทึก /api/admin/settings เดิม");

  // ── 6) layout lock: sidebar/header/center ไม่ขยับ + ไม่มี overflow ─────────
  const layout = async () =>
    (await s.evaluate(`(() => {
      const pick = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
      return { aside: pick(document.querySelector('aside')), header: pick(document.querySelector('header')), center: pick(document.querySelector('#stockPane:not([hidden]),#toolPane:not([hidden]),body:not(.chat-compact) #homePane')) };
    })()`)) as { aside: unknown; header: unknown; center: unknown };
  await s.locator("#companyProfile").click(); // close profile menu
  const before = await layout();
  assert.equal(await navSidebars().then((x) => x.length), 1, "ต้องมี sidebar ชุดเดียว");
  const overflow = await s.evaluate(() => ({ doc: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  assert.ok(overflow.doc <= overflow.client + 1, `shell ต้องไม่มี horizontal overflow (${JSON.stringify(overflow)})`);
  await s.locator("#toolsMain").click();
  await s.waitForSelector("#businessLauncher:not([hidden])", { timeout: 15_000 });
  const launcherRect = await rect("#businessLauncher");
  assert.ok(launcherRect && launcherRect.x >= 0 && launcherRect.x + launcherRect.w <= 1440, `launcher ต้องไม่ล้นจอ (${JSON.stringify(launcherRect)})`);
  assert.deepEqual(await layout(), before, "เปิด/ปิด launcher ต้องไม่ขยับ sidebar/header/พื้นที่กลาง");
  await s.locator("#toolsMain").click(); // close launcher
  await page.waitForTimeout(200);
  ok("Sidebar ชุดเดียว · Header/Tab ไม่ขยับ · launcher ไม่ล้นจอ · ไม่มี horizontal overflow");

  // ── 7) ทุกเครื่องมือชี้ route เดิม + Back/Forward ทำงาน ────────────────────
  await s.locator("#toolsMain").click();
  await s.waitForSelector("#businessLauncher:not([hidden])", { timeout: 15_000 });
  const routeItems = await s.locator(".launcher-item[data-route]").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-route")));
  for (const route of routeItems) {
    if (!route || route.startsWith("/admin/settings")) continue;
    const path = route.replace(/^\//, "");
    assert.ok(existsSync(`app/${path}/page.tsx`), `route ต้องมีหน้าจอเดิมจริง: ${route}`);
  }
  await s.locator('.launcher-item[data-tool-id="pits"]').click();
  await s.waitForFunction(() => (document.querySelector("#toolFrame") as HTMLIFrameElement | null)?.getAttribute("src") === "/admin/pits", { timeout: 15_000 });
  assert.equal(await s.locator("#screenTitle").textContent(), "ศูนย์ควบคุมทรัพยากร");
  await s.locator("#back").click();
  await s.waitForTimeout(300);
  assert.equal(await s.locator("#stockPane").isVisible(), true, "Back ต้องกลับหน้าจอเดิม");
  await s.locator("#forward").click();
  await s.waitForTimeout(300);
  assert.equal(await s.locator("#toolPane").isVisible(), true, "Forward ต้องกลับหน้าเครื่องมือเดิม");
  assert.equal(await s.locator("#toolFrame").getAttribute("src"), "/admin/pits");
  await page.screenshot({ path: `${SHOTS}/after-4-tool-route.png` });
  ok("เครื่องมือทุกตัวชี้ route เดิม · Back/Forward ทำงาน · เปิดในพื้นที่กลางเดิม");

  // ── 8) ไม่มีปุ่มซ้ำ/ไอคอนซ้ำ (นับจาก DOM จริงทั้ง shell) ───────────────────
  assert.equal(await s.locator("#toolsMain").count(), 1);
  assert.equal(await s.locator("#businessLauncher").count(), 1);
  assert.equal(await s.locator("#companyProfile").count(), 1);
  assert.equal(await s.locator("#profileMenu").count(), 1);
  assert.equal(await s.locator("#settings").count(), 1);
  ok("Launcher/โปรไฟล์/ตั้งค่า อย่างละจุดเดียว — ไม่มีชุดซ้ำ");

  console.log(`\n${pass} checks PASS`);
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

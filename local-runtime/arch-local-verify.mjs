// PHASE 2 local verify — browser จริงบน dev server localhost:3000 (vm ที่ deploy แล้ว = ห้ามแตะ)
// ตรวจตามโจทย์ STEP 09: Architecture Navigation (anchor + เมนูไปตำแหน่งถูก) · ข้อมูลแสดงจริง
// มาจาก /api/admin/system-reality (ไม่ใช่ mock) · บันทึกเฉพาะ: final URL, title, console errors,
// network (method/status/url), system-reality body sanity · ห้ามพริ้น cookie/token ทุกกรณี
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";

// session เจ้าของจริง (mint ผ่าน email OTP → supabase-ssr cookie) จาก admin route ลัด magiclink
const STATE_FILE = "local-runtime/tmp-local-login-state.json";

const summary = { base: BASE, steps: [], console_errors: [], network: [], checks: {}, screenshots: [] };
const step = (name, detail) => summary.steps.push({ name, detail: String(detail ?? "") });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: JSON.parse(readFileSync(STATE_FILE, "utf8")) });
const page = await ctx.newPage();

page.on("console", (m) => { if (m.type() === "error") summary.console_errors.push(m.text().slice(0, 300)); });
page.on("response", async (res) => {
  const url = res.url();
  if (url.includes("/api/")) {
    summary.network.push({ method: res.request().method(), status: res.status(), url: url.split(BASE)[1] ?? url });
    if (res.url().includes("/api/admin/system-reality") && res.status() === 200) {
      try {
        const body = await res.json();
        const rep = body.report ?? {};
        summary.checks.api_report = {
          has_audit: !!rep.audit,
          audit_keys: rep.audit ? Object.keys(rep.audit).sort() : [],
          rule_compliance_present: !!rep.audit?.rule_compliance,
          rc_authority_ok: rep.audit?.rule_compliance?.authority_ok === true,
          rc_first_row: rep.audit?.rule_compliance?.rows?.[0] ?? null,
          test_counts: rep.audit?.test_results?.counts ?? null,
          readiness_count: Array.isArray(rep.audit?.capability_readiness) ? rep.audit.capability_readiness.length : 0,
          defects_count: Array.isArray(rep.audit?.open_defects) ? rep.audit.open_defects.length : 0,
        };
      } catch { /* อ่าน body ไม่ได้ — บันทึกว่างไว้ ไม่เดา */ }
    }
  }
});

// 1) session จริงจาก storageState — ยืนยันเข้าหน้า / ได้ในแชแนล (ไม่ใช่ redirect login)
const respLogin = await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 90000 });
step("open /", `${respLogin?.status() ?? "n/a"} → ${page.url()}`);
summary.checks.login_landed = !page.url().includes("/login") ? "ok" : "redirect-to-login";

// 2) เข้าหน้า / พร้อม hash → ตรวจ anchor มีจริง + browser scroll ไปถึง (ถึงตำแหน่งไม่ติดบน)
const r1 = await page.goto(`${BASE}/#architecture`, { waitUntil: "networkidle", timeout: 90000 });
step("goto /#architecture", `${r1?.status() ?? "n/a"} → ${page.url()}`);
await page.waitForTimeout(1200);
const anchorExists = await page.evaluate(() => !!document.getElementById("architecture"));
const anchorTop = await page.evaluate(() => document.getElementById("architecture")?.getBoundingClientRect().top ?? -1);
summary.checks.anchor_exists = anchorExists;
summary.checks.hash_scroll_top_px = anchorTop;
summary.screenshots.push("/tmp/arch-local-a-hash.png");
await page.screenshot({ path: "/tmp/arch-local-a-hash.png", fullPage: false });

// 3) กลับขึ้นบน แล้วกดเมนู "Inspect System Map" → ต้อง scroll ไปตำแหน่ง anchor จริง
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);
const navClicked = await page.getByRole("link", { name: /Inspect System Map/i }).click({ timeout: 15000 }).then(() => true).catch((e) => step("nav_click_error", e.message));
await page.waitForTimeout(1200);
const afterNavTop = await page.evaluate(() => document.getElementById("architecture")?.getBoundingClientRect().top ?? -1);
summary.checks.nav_clicked = navClicked === true;
summary.checks.after_nav_anchor_top_px = afterNavTop;
summary.screenshots.push("/tmp/arch-local-b-nav.png");
await page.screenshot({ path: "/tmp/arch-local-b-nav.png", fullPage: false });

// 4) โหลด system-reality API ตรง ๆ (session เดียวกัน) → ตรวจข้อมูล audit จริง
const apiResp = await page.evaluate(async () => {
  const res = await fetch("/api/admin/system-reality", { headers: { accept: "application/json" } });
  return { status: res.status, json: await res.json().catch(() => null) };
});
summary.checks.api_status = apiResp.status;
const rep = apiResp.json?.report ?? {};
summary.checks.api_report = summary.checks.api_report ?? {
  has_audit: !!rep.audit,
  audit_keys: rep.audit ? Object.keys(rep.audit).sort() : [],
};

// 5) ตรวจการแสดงจริงบนหน้า (DOM) — 4 หมวด + ไม่ใช่ mock
for (const marker of ["02 · RULE COMPLIANCE", "04 · CAPABILITY READINESS", "05 · TEST RESULTS", "07 · OPEN DEFECTS"]) {
  summary.checks[`dom_has:${marker}`] = await page.getByText(marker).first().isVisible().catch(() => false);
}
const pageHtml = await page.content();
summary.checks.dom_no_mock_markers = ["lorem", "mock data", "ตัวอย่างเท่านั้น", "dummy"].every((m) => !pageHtml.toLowerCase().includes(m));

// scroll ไปหมวดใหม่แล้วถ่ายภาพหลักฐาน
await page.evaluate(() => document.getElementById("system-reality")?.scrollIntoView());
await page.waitForTimeout(600);
summary.screenshots.push("/tmp/arch-local-c-reality.png");
await page.screenshot({ path: "/tmp/arch-local-c-reality.png", fullPage: false });

// สรุป PASS/FAIL ภายใน script (ห้าม AI ตัดสินเกินหลักฐาน — เราข้ามเฉพาะที่ evidence ชี้)
const c = summary.checks;
const core = [
  ["api system-reality 200", apiResp.status === 200],
  ["api รายงาน audit ครบ 4 บล็อก", !!rep.audit?.rule_compliance && !!rep.audit?.test_results && Array.isArray(rep.audit?.capability_readiness) && Array.isArray(rep.audit?.open_defects)],
  ["anchor #architecture มีตาม hash", c.anchor_exists === true],
  ["hash ทำ scroll ไปถึง (~0-140px ใต้ header)", c.hash_scroll_top_px !== undefined && c.hash_scroll_top_px >= -1 && c.hash_scroll_top_px < 140],
  ["เมนู Inspect System Map กดแล้ว anchor อยู่บนจอ", c.nav_clicked === true && c.after_nav_anchor_top_px >= -1 && c.after_nav_anchor_top_px < 140],
];
for (const marker of ["02 · RULE COMPLIANCE", "04 · CAPABILITY READINESS", "05 · TEST RESULTS", "07 · OPEN DEFECTS"]) core.push([`DOM แสดง ${marker}`, c[`dom_has:${marker}`] === true]);
core.push(["ไม่มี mock marker บนหน้า", c.dom_no_mock_markers === true]);

let pass = 0; const fails = [];
for (const [name, ok] of core) { ok ? pass++ : fails.push(name); }
console.log(JSON.stringify({ PASS: pass, FAIL: fails.length, failed: fails }, null, 1));

writeFileSync("/tmp/arch-local-verify.json", JSON.stringify(summary, null, 2));
await browser.close();
console.log(`screenshots: ${summary.screenshots.join(" | ")} · detail: /tmp/arch-local-verify.json`);
if (fails.length > 0) process.exit(1);

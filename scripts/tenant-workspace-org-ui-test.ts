/**
 * STEP 3 — WORKSPACE ORG UI TEST (browser จริงด้วย Playwright/Chromium)
 *
 * ทดสอบ UI จริงบน Next dev server (local UI review shell) โดย intercept
 * /api/workspace/org-context และ /api/chat — เพื่อพิสูจน์พฤติกรรม UI ล้วน:
 *   1. มีตัวเลือกเฉพาะองค์กรที่ผู้ใช้เป็นสมาชิก (ไม่มี "DNA OS"/tenant เริ่มต้น)
 *   2. ยังไม่เลือก org → placeholder "เลือกองค์กรก่อนเริ่มใช้งาน" + composer ปิด + เครื่องมือถูกกัน
 *   3. เลือก org → placeholder "ถาม <ชื่อองค์กร>..." + composer ใช้ได้
 *   4. สลับ org → ผลลัพธ์/แชตของ org เดิมหายทั้งหมด (remount key) + placeholder เปลี่ยนตาม org ใหม่
 *
 * ข้อจำกัดที่รายงานตรง: session จริง (Supabase) ใช้ไม่ได้บนเครื่องนี้ (ไม่มี local stack,
 * ห้ามสร้าง/แก้ผู้ใช้ production) — จึงใช้ route interception แทน และรายงานแยกจาก STEP 2 HTTP
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer(); s.unref(); s.on("error", rej);
    s.listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); });
  });
}
async function waitReady(base: string, timeoutMs: number) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { const r = await fetch(base + "/login", { signal: AbortSignal.timeout(5000) }); if (r.status < 500) return; } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Next dev server ไม่พร้อมภายในเวลา");
}

async function main() {
  const port = await freePort();
  // localhost (ไม่ใช่ 127.0.0.1) — Next dev บล็อก dev asset/hydration ข้าม origin
  const base = `http://localhost:${port}`;
  const repo = path.join(__dirname, "..");
  let server: ChildProcess | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let pass = 0;
  const ok = (name: string) => { pass++; console.log(`PASS  ${name}`); };

  try {
    server = spawn(process.execPath, [path.join(repo, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(port)], {
      cwd: repo,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
      detached: true,
      stdio: "ignore",
    });
    await waitReady(base, 180_000);

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const state = { selected: "" as string };
    const orgs = [
      { organizationId: "00000000-0000-4000-8000-0000000000aa", name: "SYNTH-ORG-A", role: "admin" },
      { organizationId: "00000000-0000-4000-8000-0000000000bb", name: "SYNTH-ORG-B", role: "member" },
    ];
    await page.route("**/api/workspace/org-context", async (route) => {
      if (route.request().method() === "POST") {
        const body = JSON.parse(route.request().postData() ?? "{}");
        if (!orgs.some((o) => o.organizationId === body.organizationId)) {
          return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "ORG_NOT_MEMBER" }) });
        }
        state.selected = body.organizationId;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ memberships: orgs, selected: state.selected }),
      });
    });
    await page.route("**/api/chat", async (route) => {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "SYNTH-STALE-RESULT" }) });
    });

    // พื้นที่แชตจริงของผู้ใช้ = /workspace?materialSurface=chat (หน้าจอเดิม ไม่ใช่ dashboard ใหม่)
    await page.goto(`${base}/workspace?materialSurface=chat`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="org-context-control"]', { timeout: 60_000 });
    ok("org control แสดงหลังโหลด membership (browser จริง)");

    const opts = await page.locator("#workspace-org option").allTextContents();
    assert.deepEqual(opts, ["— เลือกองค์กร —", "SYNTH-ORG-A", "SYNTH-ORG-B"]);
    assert.ok(!opts.some((o) => /DNA OS|AOS/.test(o)), "ต้องไม่มี DNA OS/AOS เป็นตัวเลือกองค์กร");
    ok("ตัวเลือกมีเฉพาะ org ที่เป็นสมาชิก (ไม่มี DNA OS/tenant เริ่มต้น)");

    const textarea = page.locator("textarea[aria-label='คำสั่ง']");
    assert.equal(await textarea.getAttribute("placeholder"), "เลือกองค์กรก่อนเริ่มใช้งาน");
    assert.equal(await textarea.isDisabled(), true);
    ok("ยังไม่เลือก org → placeholder กัน + composer ปิด");

    await page.locator(".edge.left").click();
    await page.waitForSelector('[data-testid="org-required-note"]');
    assert.equal(await page.locator(".tools button").count(), 0);
    await page.getByRole("button", { name: "ปิด", exact: true }).click();
    ok("ยังไม่เลือก org → เครื่องมือถูกกัน (แจ้งให้เลือกองค์กร)");

    await page.selectOption("#workspace-org", orgs[0].organizationId);
    await page.waitForFunction(
      (name) => (document.querySelector("textarea[aria-label='คำสั่ง']") as HTMLTextAreaElement | null)?.getAttribute("placeholder") === `ถาม ${name}...`,
      orgs[0].name,
      { timeout: 15_000 },
    );
    assert.equal(await textarea.isDisabled(), false);
    ok("เลือก org A → placeholder 'ถาม SYNTH-ORG-A...' + composer ใช้ได้");

    await textarea.fill("ทดสอบงาน");
    // textarea ไม่ submit ด้วย Enter เอง — ผู้ใช้กดปุ่มส่ง (aria-label="ส่งคำสั่ง")
    await page.locator("button[aria-label='ส่งคำสั่ง']").click();
    await page.waitForSelector("text=SYNTH-STALE-RESULT", { timeout: 15_000 });
    ok("มีผลลัพธ์ของ org A อยู่บนจอ (ใช้พิสูจน์การล้างภายหลัง)");

    await page.locator(".edge.left").click();
    await page.waitForSelector(".tools button");
    assert.ok((await page.locator(".tools button").count()) > 0);
    await page.getByRole("button", { name: "ปิด", exact: true }).click();
    ok("เลือก org แล้ว → เครื่องมือโหลดตามบริบทองค์กร");

    await page.selectOption("#workspace-org", orgs[1].organizationId);
    await page.waitForFunction(
      (name) => (document.querySelector("textarea[aria-label='คำสั่ง']") as HTMLTextAreaElement | null)?.getAttribute("placeholder") === `ถาม ${name}...`,
      orgs[1].name,
      { timeout: 15_000 },
    );
    assert.equal(await page.locator("text=SYNTH-STALE-RESULT").count(), 0, "ผลลัพธ์ org A ต้องหายหลังสลับ");
    assert.equal(await page.locator(".q-entry").count(), 0, "แชตของ org A ต้องถูกล้าง");
    ok("สลับ org → แชต/ผลลัพธ์เดิมถูกล้างทั้งหมด + placeholder เปลี่ยนเป็น org B");

    console.log(`\n═══ WORKSPACE ORG UI: ${pass} checks PASS ═══`);
  } finally {
    await browser?.close().catch(() => {});
    if (server?.pid) {
      try { process.kill(-server.pid, "SIGTERM"); } catch {}
      await new Promise((r) => setTimeout(r, 800));
      try { process.kill(-server.pid, "SIGKILL"); } catch {}
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });

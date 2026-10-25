/**
 * WORKSPACE NAV / ORG-CONTEXT TEST (browser จริงด้วย Playwright/Chromium)
 * อัปเดตตามคำสั่ง owner 2026-10-18: "ลบตัวเลือก องค์กร/สำนักงานใหญ่ ออกจากมุมขวาบน"
 *
 * เดิมเทสต์นี้พิสูจน์ "ตัวเลือกองค์กรชุดเดียว + สลับ org ได้" — ตอนนี้ UI ตัวเลือกถูกลบตามคำสั่ง
 * จึงเปลี่ยนไปพิสูจน์สัญญาใหม่โดยไม่ลดความเข้มของส่วนที่เหลือ:
 *   1. ไม่มีตัวเลือกองค์กรในทุก frame (ไม่มี #workspace-org / [data-testid=org-context-control])
 *   2. บริบทองค์กรยังมาถึงแชตจริง: placeholder "ถาม <org>..." + composer ใช้ได้
 *      (ค่ามาจาก GET /api/workspace/org-context ที่อ่าน cookie เดิม — ไม่ใช่ UI ใหม่)
 *   3. ส่งคำสั่งแล้วได้ผลลัพธ์จริง ⇒ ระบบแชตเดิมทำงานเหมือนเดิมหลังถอดปุ่ม
 *   4. ไม่มีปุ่มซ้ำในพื้นที่กลาง: .gear / .edge left / .edge right (⋯) / .corner (ข้อความ) = 0
 *      และยังมี Composer/แผงข้อความชุดเดียว (แผงประวัติไม่ถูกสร้างขึ้นมาใหม่)
 *
 * ข้อจำกัดที่รายงานตรง: session จริง (Supabase) ใช้ไม่ได้บนเครื่องนี้ (ไม่มี local stack ·
 * ห้ามสร้าง/แก้ผู้ใช้ production) — จึง intercept /api/workspace/org-context และ /api/chat
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";

const SHOTS = process.env.SHOTS_DIR || "/tmp/dna-workspace-shots";

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer(); s.unref(); s.on("error", rej);
    s.listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); });
  });
}
async function waitReady(base: string, timeoutMs: number, child: ChildProcess) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`Next dev ออกก่อนพร้อม (exit ${child.exitCode})`);
    try { const r = await fetch(base + "/login", { signal: AbortSignal.timeout(5000) }); if (r.status < 500) return; } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Next dev server ไม่พร้อมภายในเวลา");
}

async function main() {
  const repo = path.join(__dirname, "..");
  const external = process.env.BASE_URL;
  const port = external ? 0 : await freePort();
  const base = external ?? `http://localhost:${port}`;
  let server: ChildProcess | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let pass = 0;
  const ok = (name: string) => { pass++; console.log(`PASS  ${name}`); };
  mkdirSync(SHOTS, { recursive: true });

  try {
    if (!external) {
      server = spawn(process.execPath, [path.join(repo, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(port)], {
        cwd: repo,
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
        detached: true,
        stdio: "ignore",
      });
      await waitReady(base, 180_000, server);
    } else {
      console.log(`ใช้ dev server ที่รันอยู่: ${base}`);
    }

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const orgs = [
      { organizationId: "00000000-0000-4000-8000-0000000000aa", name: "SYNTH-ORG-A", role: "admin" },
      { organizationId: "00000000-0000-4000-8000-0000000000bb", name: "SYNTH-ORG-B", role: "member" },
    ];
    // org ที่ "เลือกไว้แล้ว" มาจาก cookie/เซิร์ฟเวอร์เดิม — ไม่มี UI ให้สลับแล้ว
    await page.route("**/api/workspace/org-context", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ memberships: orgs, selected: orgs[0].organizationId }),
      }));
    await page.route("**/api/chat", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "SYNTH-NAV-RESULT" }) }));

    const controlsTotal = async () => {
      let n = 0;
      for (const f of page.frames()) n += await f.locator('[data-testid="org-context-control"]').count().catch(() => 0);
      return n;
    };
    const orgSelects = async () => {
      let n = 0;
      for (const f of page.frames()) n += await f.locator("#workspace-org, select[aria-label='เลือกองค์กร']").count().catch(() => 0);
      return n;
    };
    const shellFrame = () => page.frames().find((f) => f.url().includes("material-workspace"));
    const chatFrame = () => page.frames().find((f) => f.url().includes("materialSurface=chat"));

    // ── 1. ไม่มีตัวเลือกองค์กรที่มุมขวาบน (ทุกชั้น) ──
    await page.goto(`${base}/workspace`, { waitUntil: "domcontentloaded" });
    const shell = shellFrame();
    assert.ok(shell, "ต้องพบ shell iframe (material-workspace)");
    await shell!.waitForSelector("#tabStrip .tab", { timeout: 60_000 });
    assert.equal(await controlsTotal(), 0, "ต้องไม่มีตัวเลือกองค์กรในหน้า Workspace");
    assert.equal(await orgSelects(), 0, "ต้องไม่มี dropdown องค์กร/สำนักงานใหญ่");
    const orgText = await page.evaluate(() => document.body.innerText);
    assert.ok(!/สำนักงานใหญ่/.test(orgText), "ต้องไม่มีชื่อองค์กร 'สำนักงานใหญ่' ค้างอยู่ที่มุมขวาบน");
    assert.equal(await page.locator("text=องค์กร").count(), 0, "ต้องไม่มีข้อความ 'องค์กร' ในหน้า Workspace");
    await page.screenshot({ path: `${SHOTS}/after-1-no-org-control.png` });
    ok("ไม่มีตัวเลือก องค์กร/สำนักงานใหญ่ ที่มุมขวาบน (ทุก frame = 0)");

    // ── 2. บริบทองค์กรยังมาถึงแชตเดิม (ค่าจากเซิร์ฟเวอร์ ไม่ใช่ UI ที่ถูกถอด) ──
    await shell!.click("#chatHome");
    for (let i = 0; i < 40 && !chatFrame(); i++) await page.waitForTimeout(500);
    const chat = chatFrame();
    assert.ok(chat, "ต้องพบชั้นใน /workspace?materialSurface=chat");
    const innerTextarea = chat!.locator("textarea[aria-label='คำสั่ง']");
    await innerTextarea.waitFor({ timeout: 60_000 });
    await chat!.waitForFunction(
      (name) => (document.querySelector("textarea[aria-label='คำสั่ง']") as HTMLTextAreaElement | null)?.getAttribute("placeholder") === `ถาม ${name}...`,
      orgs[0].name,
      { timeout: 30_000 },
    );
    assert.equal(await innerTextarea.isDisabled(), false, "composer ต้องใช้งานได้ด้วย org จาก cookie เดิม");
    await page.screenshot({ path: `${SHOTS}/after-2-chat-org-context.png` });
    ok("แชตได้รับ org จาก cookie/เซิร์ฟเวอร์เดิม (ถาม SYNTH-ORG-A...) และ composer ใช้ได้");

    // ── 3. ส่งคำสั่งได้จริง (ระบบแชตเดิมไม่ถูกกระทบ) ──
    await innerTextarea.fill("ทดสอบหลังถอดตัวเลือกองค์กร");
    await chat!.locator("button[aria-label='ส่งคำสั่ง']").click();
    await chat!.waitForSelector("text=SYNTH-NAV-RESULT", { timeout: 20_000 });
    ok("ส่งคำสั่งแล้วได้ผลลัพธ์จริง — กล่อง AI ด้านล่างทำงานเหมือนเดิม");

    // ── 4. ไม่มีปุ่มซ้ำในพื้นที่กลาง + กล่องข้อความ/แชตชุดเดียว ──
    assert.equal(await chat!.locator(".gear").count(), 0, "ชั้นในต้องไม่มีไอคอนตั้งค่าซ้ำกับ shell");
    assert.equal(await chat!.locator(".edge.left").count(), 0, "ชั้นในต้องไม่มีไอคอนกล่องเครื่องมือซ้ำกับ shell");
    assert.equal(await chat!.locator(".edge.right").count(), 0, "⋯ ต้องไม่อยู่ในพื้นที่กลางอีก (ย้ายขึ้น Tab Bar)");
    assert.equal(await chat!.locator(".corner").count(), 0, "ต้องไม่มีปุ่มรูปข้อความที่มุมขวาของพื้นที่กลาง");
    assert.equal(await chat!.locator("[data-testid='history-button']").count(), 0, "ต้องไม่มีปุ่มเปิดหน้าข้อความ/ประวัติใน Workspace");
    assert.equal(await chat!.locator("textarea[aria-label='คำสั่ง']").count(), 1, "ต้องมี Composer ชุดเดียว");
    assert.equal(await chat!.locator(".msg-panel").count(), 0, "ต้องไม่มีแผงข้อความซ้ำเปิดค้างใน Workspace");
    assert.equal(await shell!.locator("#tabBar #tabOverflow").count(), 1, "⋯ ต้องอยู่บน Tab Bar");
    assert.equal(await shell!.locator("#tabBar #tabSearch").count(), 1, "แว่นขยายต้องอยู่บน Tab Bar");
    await page.screenshot({ path: `${SHOTS}/after-3-no-dup-buttons.png` });
    ok("ไม่มีปุ่มข้อความ/⋯ ในพื้นที่กลาง · กล่อง AI ด้านล่างชุดเดียว · ⋯ อยู่บน Tab Bar");

    console.log(`\n═══ WORKSPACE NAV CLEANUP: ${pass} checks PASS ═══`);
    console.log(`screenshots: ${SHOTS}`);
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

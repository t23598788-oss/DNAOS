/**
 * WORKSPACE TAB BAR TEST (Chromium จริง) — owner mission 2026-10-18
 *
 * สัญญาที่ตรวจบนหน้าจอจริง (ชั้นนอก /workspace → shell public/material-workspace):
 *   1. Tab Bar ล็อกด้านบนเสมอ (y = 0 · position:sticky · ไม่ขยับเมื่อเนื้อหาเลื่อน)
 *   2. ช่องค้นหา "ค้นหาแหล่ง / วัสดุ…" · ตัวกรองประเภทแหล่ง · "+ เพิ่มทรัพยากร" · ↻
 *      ไม่ปรากฏบนแถบบนอีก — อยู่ภายในหน้าจอทรัพยากร (#stockPane) เท่านั้น
 *   3. แท็บ = หน้าจอที่เปิดจริง: โลโก้/ไอคอน · ชื่อ · ปุ่มปิด · สถานะ active
 *   4. กดเครื่องมือจากแถบซ้าย → เปิดในพื้นที่กลาง + เพิ่มแท็บอัตโนมัติ
 *      เปิดซ้ำ = สลับไปแท็บเดิม ไม่สร้างซ้ำ
 *   5. สลับแท็บด้วยการคลิกแท็บ · ปิดแท็บ · ‹ › ใช้ประวัติการนำทางจริง
 *   6. แพลตฟอร์มภายนอก (Facebook/LINE/Gmail/…): เปิด Official URL ในเบราว์เซอร์ของผู้ใช้เท่านั้น
 *      ไม่ฝัง iframe / ไม่มี Website Renderer / Remote Browser · ไม่สร้างแท็บเลียนแบบ
 *   7. กล่อง AI ด้านล่างยังมีชุดเดียว (iframe แชตเดิม 1 อัน · Composer 1 อัน)
 *   8. ปุ่ม ＋ · 🔍 · ⋯ อยู่บน Tab Bar เท่านั้น · ⋯ = เมนูจัดการแท็บ/หน้าต่าง · 🔍 เปิด URL เป็นแท็บจริง
 *   9. ไม่มีตัวเลือกองค์กร ("องค์กร"/"สำนักงานใหญ่") และไม่มีปุ่มรูปข้อความ/⋯ ในพื้นที่กลาง
 *
 * ข้อจำกัด (รายงานตรง): เครื่องนี้ไม่มี session จริง ⇒ /api/admin/* ตอบ 401 ตามปกติ
 * (เทสต์ไม่ mock ข้อมูลธุรกิจ) · เส้นทาง /admin/* ที่เปิดในแท็บจะถูก guard ไป /login เอง
 * · การทดสอบ "เว็บภายนอกเปิดเบราว์เซอร์" ใช้ https://example.com ผ่านฟังก์ชัน UI เดิม
 *   (window.openExternalTool) — ยืนยันว่าไม่มีแท็บ/iframe ถูกสร้างสำหรับเว็บภายนอก
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, type Frame } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3141";
const SHOTS = process.env.SHOTS_DIR || "/tmp/tabbar-shots";

type TabState = {
  id: string;
  label: string;
  active: boolean;
  closable: boolean;
  icon: boolean;
  logo: boolean;
};

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  let pass = 0;
  const ok = (name: string) => {
    pass += 1;
    console.log(`PASS  ${name}`);
  };

  try {
    await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded" });
    let shell: Frame | undefined;
    for (let i = 0; i < 40; i++) {
      shell = page.frames().find((f) => f.url().includes("material-workspace"));
      if (shell) break;
      await page.waitForTimeout(250);
    }
    assert.ok(shell, "ต้องพบ shell ของ workspace (public/material-workspace)");
    await shell.waitForSelector("#tabStrip .tab", { timeout: 20_000 });

    const tabState = (): Promise<TabState[]> =>
      shell!.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("#tabStrip .tab")].map((el) => ({
          id: el.getAttribute("data-tab-id") || "",
          label: el.querySelector(".tab-label")?.textContent || "",
          active: el.classList.contains("is-active"),
          closable: !!el.querySelector(".tab-close"),
          icon: !!el.querySelector(".tab-icon svg"),
          logo: !!el.querySelector(".tab-icon img"),
        })),
      );

    const panes = () =>
      shell!.evaluate(() => ({
        stock: !(document.getElementById("stockPane") as HTMLElement).hidden,
        tool: !(document.getElementById("toolPane") as HTMLElement).hidden,
        chatCompact: document.body.classList.contains("chat-compact"),
        toolSrc: document.getElementById("toolFrame")?.getAttribute("src") ?? null,
      }));

    // ── 1) Tab Bar ล็อกด้านบน ────────────────────────────────────────────────
    const header = () =>
      shell!.evaluate(() => {
        const bar = document.getElementById("tabBar") as HTMLElement;
        const rect = bar.getBoundingClientRect();
        return {
          count: document.querySelectorAll("header").length,
          y: Math.round(rect.top),
          x: Math.round(rect.left),
          h: Math.round(rect.height),
          position: getComputedStyle(bar).position,
          width: Math.round(rect.width),
        };
      });
    const h0 = await header();
    assert.equal(h0.count, 1, "ต้องมี header เดียว (Tab Bar เดียว)");
    assert.equal(h0.y, 0, `Tab Bar ต้องเริ่มที่ขอบบน (y=0) — พบ ${h0.y}`);
    assert.equal(h0.position, "sticky", "Tab Bar ต้องถูกล็อกด้วย position:sticky");
    assert.ok(h0.h >= 36 && h0.h <= 48, `ความสูง Tab Bar ต้องอยู่ในช่วง 36–48px — พบ ${h0.h}`);
    ok(`Tab Bar ล็อกด้านบน: y=${h0.y} · height=${h0.h} · position=${h0.position}`);

    // ── 2) เครื่องมือค้นหา/กรอง/เพิ่มทรัพยากร ไม่อยู่บนแถบบน ────────────────
    const headerTools = await shell.evaluate(`(() => {
      const h = document.getElementById("tabBar");
      return ["search", "category", "add", "refresh"].map((id) => !!h.querySelector("#" + id));
    })()`) as boolean[];
    assert.deepEqual(headerTools, [false, false, false, false], "ห้ามมี #search/#category/#add/#refresh บน Tab Bar");
    const stockTools = await shell.evaluate(`(() => {
      const pane = document.getElementById("stockPane");
      return ["search", "category", "add", "refresh"].map((id) => !!pane.querySelector("#" + id));
    })()`) as boolean[];
    assert.deepEqual(stockTools, [true, true, true, true], "เครื่องมือทรัพยากรต้องอยู่ในหน้าจอทรัพยากร (#stockPane)");
    const headerText = await shell.evaluate(`document.getElementById("tabBar").textContent || ""`) as string;
    assert.ok(!headerText.includes("ค้นหาแหล่ง"), "ต้องไม่มีช่องค้นหาบนแถบบน");
    await page.screenshot({ path: `${SHOTS}/01-workspace-tab.png` });
    ok("ช่องค้นหา · ตัวกรองประเภทแหล่ง · เพิ่มทรัพยากร · ↻ ไม่อยู่บน Tab Bar (อยู่เฉพาะหน้าจอทรัพยากร)");

    // ── 3) แท็บเริ่มต้น = Workspace เท่านั้น ────────────────────────────────
    let tabs = await tabState();
    assert.equal(tabs.length, 1, `เริ่มต้นต้องมีแท็บเดียว — พบ ${tabs.length}`);
    assert.equal(tabs[0].label, "Workspace");
    assert.equal(tabs[0].active, true);
    assert.equal(tabs[0].icon, true, "แท็บต้องมีไอคอน");
    assert.equal(tabs[0].closable, false, "แท็บหลัก Workspace ปิดไม่ได้");
    ok("แท็บ Workspace เริ่มต้น: มีไอคอน · active · ไม่มีปุ่มปิด (แท็บหลัก)");

    // ── 4) แถบซ้าย → เปิดหน้าจอ + เพิ่มแท็บอัตโนมัติ ───────────────────────
    await shell.click("[data-view=all]");
    await shell.waitForFunction(`document.querySelectorAll("#tabStrip .tab").length === 2`, null, { timeout: 10_000 });
    tabs = await tabState();
    assert.equal(tabs[1].label, "ศูนย์ควบคุมทรัพยากร");
    assert.equal(tabs[1].active, true);
    assert.equal(tabs[1].closable, true, "แท็บที่เปิดจากเครื่องมือต้องปิดได้");
    let p = await panes();
    assert.equal(p.stock, true, "พื้นที่กลางต้องเป็นหน้าจอทรัพยากร");
    assert.equal(p.tool, false);
    await page.screenshot({ path: `${SHOTS}/02-resource-tab.png` });
    ok("กดไอคอนศูนย์ควบคุมทรัพยากรในแถบซ้าย → เปิดในพื้นที่กลาง + เพิ่มแท็บ");

    await shell.click("[data-view=all]");
    await page.waitForTimeout(300);
    tabs = await tabState();
    assert.equal(tabs.length, 2, "เปิดหน้าจอเดิมซ้ำต้องไม่สร้างแท็บใหม่");
    ok("เปิดหน้าจอเดิมซ้ำ → สลับแท็บเดิม ไม่สร้างแท็บซ้ำ");

    // ── 5) เปิดเครื่องมือจาก launcher → แท็บมีโลโก้จริง + ชื่อ + ปุ่มปิด ────
    await shell.click("#toolsMain");
    await shell.waitForSelector("#launcherGroups [data-tool-id]", { timeout: 20_000 });
    await shell.click('[data-tool-id="line-oa"]');
    await shell.waitForFunction(`document.querySelectorAll("#tabStrip .tab").length === 3`, null, { timeout: 10_000 });
    tabs = await tabState();
    const lineTab = tabs.find((t) => t.label === "LINE Official Account");
    assert.ok(lineTab, `ต้องมีแท็บ LINE Official Account (พบ ${tabs.map((t) => t.label).join(" | ")})`);
    assert.equal(lineTab!.logo, true, "แท็บ LINE ต้องใช้โลโก้จริงของผู้ให้บริการ");
    assert.equal(lineTab!.closable, true);
    assert.equal(lineTab!.active, true);
    p = await panes();
    assert.equal(p.tool, true, "พื้นที่กลางต้องเป็นหน้าจอเครื่องมือ");
    assert.equal(p.toolSrc, "/admin/line-customers", "ต้องเปิดเส้นทางเดิมของ DNA OS");
    await page.screenshot({ path: `${SHOTS}/03-line-tab.png` });
    ok("เปิด LINE จากแถบซ้าย → แท็บใหม่ (โลโก้จริง · ชื่อ · ปุ่มปิด · active) + เปิดในพื้นที่กลาง");

    await shell.click("#toolsMain");
    await shell.waitForSelector("#launcherGroups [data-tool-id]", { timeout: 20_000 });
    await shell.click('[data-tool-id="line-oa"]');
    await page.waitForTimeout(600);
    tabs = await tabState();
    assert.equal(tabs.length, 3, "เปิดเครื่องมือเดิมซ้ำต้องไม่สร้างแท็บซ้ำ");
    assert.equal(tabs.filter((t) => t.active)[0]?.label, "LINE Official Account");
    ok("เปิดเครื่องมือเดิมซ้ำ → สลับไปแท็บเดิม");

    // ── 6) สลับแท็บด้วยการคลิกแท็บ ─────────────────────────────────────────
    await shell.click('[data-tab-activate="workspace"]');
    await page.waitForTimeout(250);
    p = await panes();
    assert.equal(p.stock, false, "แท็บ Workspace ต้องไม่แสดงหน้าจอทรัพยากร");
    assert.equal(p.chatCompact, false, "แท็บ Workspace ต้องเป็นหน้าจอแชตเต็ม");
    assert.equal((await tabState()).find((t) => t.active)?.label, "Workspace");
    await shell.click('[data-tab-activate="resources"]');
    await page.waitForTimeout(250);
    assert.equal((await panes()).stock, true, "สลับไปแท็บทรัพยากรต้องแสดงหน้าจอทรัพยากร");
    ok("สลับแท็บด้วยการคลิกแท็บ → พื้นที่กลางเปลี่ยนตามแท็บจริง");

    // ── 7) ปิดแท็บ ─────────────────────────────────────────────────────────
    await shell.click('[data-tab-close="route:/admin/line-customers"]');
    await page.waitForTimeout(250);
    tabs = await tabState();
    assert.equal(tabs.length, 2, "ปิดแท็บแล้วต้องเหลือ 2 แท็บ");
    assert.ok(!tabs.some((t) => t.label === "LINE Official Account"), "แท็บที่ปิดต้องหายไป");
    assert.equal(tabs.find((t) => t.active)?.label, "ศูนย์ควบคุมทรัพยากร", "ต้องสลับไปแท็บข้างเคียง");
    await page.screenshot({ path: `${SHOTS}/04-closed-tab.png` });
    ok("ปิดแท็บ → แท็บหาย + สลับไปแท็บข้างเคียงอัตโนมัติ");

    // ── 8) ‹ › ใช้ประวัติการนำทางจริง ───────────────────────────────────────
    await shell.click('[data-tab-activate="workspace"]');
    await page.waitForTimeout(200);
    await shell.click("#back");
    await page.waitForTimeout(200);
    assert.equal((await tabState()).find((t) => t.active)?.label, "ศูนย์ควบคุมทรัพยากร", "ย้อนกลับต้องกลับไปแท็บก่อนหน้า");
    await shell.click("#forward");
    await page.waitForTimeout(200);
    assert.equal((await tabState()).find((t) => t.active)?.label, "Workspace", "ไปข้างหน้าต้องกลับไปแท็บถัดไป");
    const backDisabled = await shell.evaluate(`(() => { const b = document.getElementById("back"); b.click(); return b.disabled; })()`) as boolean;
    assert.equal(backDisabled, false, "ปุ่มย้อนกลับต้องถูกเปิดใช้เมื่อยังมีประวัติ");
    ok("ปุ่มย้อนกลับ/ไปข้างหน้าเดินตามประวัติการนำทางจริงของ shell");

    // ── 9) Tab Bar ไม่เลื่อนหายเมื่อเนื้อหาเลื่อน ───────────────────────────
    await shell.click("[data-view=all]");
    await page.waitForTimeout(250);
    const scrolled = await shell.evaluate(`(() => {
      const list = document.getElementById("pitList");
      list.scrollTop = 400;
      const scroller = document.scrollingElement;
      scroller.scrollTop = 400;
      const r = document.getElementById("tabBar").getBoundingClientRect();
      return { y: Math.round(r.top), docScroll: scroller.scrollTop, listScroll: list.scrollTop };
    })()`) as { y: number; docScroll: number; listScroll: number };
    assert.equal(scrolled.docScroll, 0, "หน้า shell ต้องไม่ scroll ทั้งหน้า (เนื้อหา scroll ภายใน)");
    assert.equal(scrolled.y, 0, `Tab Bar ต้องอยู่y=0 หลังเลื่อนเนื้อหา — พบ ${scrolled.y}`);
    ok("Tab Bar ไม่เลื่อนหาย: เนื้อหา scroll ภายใน · แถบบนคงที่ y=0");

    // ── 10) เว็บที่ห้าม iframe → เปิดเบราว์เซอร์ภายนอก (ไม่สร้างแท็บ) ───────
    const before = (await tabState()).length;
    await shell.click("#toolsMain");
    await shell.waitForSelector("#launcherGroups [data-tool-id]", { timeout: 20_000 });
    const popupPromise = page.waitForEvent("popup", { timeout: 25_000 }).catch(() => null);
    await shell.click('[data-tool-id="facebook"]');
    const popup = await popupPromise;
    await page.waitForTimeout(800);
    assert.ok(popup, "Facebook (external platform) → ต้องเปิด Official URL ในเบราว์เซอร์");
    assert.ok(popup!.url().includes("facebook.com"), `ต้องเปิดเว็บ Facebook จริง — พบ ${popup!.url()}`);
    const afterExternal = await tabState();
    assert.equal(afterExternal.length, before, "ห้ามสร้างแท็บสำหรับแพลตฟอร์มภายนอก");
    assert.ok(!afterExternal.some((t) => t.label === "Facebook"), "ห้ามมีแท็บ Facebook ที่เป็นหน้าเลียนแบบ");
    await page.screenshot({ path: `${SHOTS}/05-facebook-external.png` });
    await popup!.close();
    ok(`เว็บที่ห้าม iframe → เปิดเบราว์เซอร์ภายนอกจริง (${popup!.url().slice(0, 48)}…) และไม่สร้างแท็บ`);

    // ── 11) เว็บภายนอกทุกเว็บ → เปิดเบราว์เซอร์เท่านั้น (ไม่มีแท็บ/iframe) ────
    const sitePopupPromise = page.waitForEvent("popup", { timeout: 25_000 }).catch(() => null);
    await shell.evaluate(`window.openExternalTool("https://example.com", "เว็บไซต์ตัวอย่าง")`);
    const sitePopup = await sitePopupPromise;
    assert.ok(sitePopup, "ต้องเปิด Official URL ในเบราว์เซอร์ของผู้ใช้");
    await page.waitForTimeout(500);
    const afterSite = await tabState();
    assert.equal(afterSite.length, before, "ห้ามสร้างแท็บสำหรับเว็บภายนอก");
    p = await panes();
    assert.equal(p.tool, false, "ห้ามฝังเว็บภายนอกใน iframe");
    await sitePopup!.close();
    await page.screenshot({ path: `${SHOTS}/06-external-browser.png` });
    ok("เว็บภายนอก → เปิดเบราว์เซอร์จริงเท่านั้น (ไม่มีแท็บ/iframe/Website Renderer)");

    // ── 12) กล่อง AI ด้านล่างชุดเดียว ───────────────────────────────────────
    assert.equal(await shell.locator("#chatFrame").count(), 1, "shell ต้องมี iframe แชตเดิม 1 อัน");
    const chatFrames = page.frames().filter((f) => f.url().includes("materialSurface=chat"));
    assert.equal(chatFrames.length, 1, `ต้องมีหน้าจอแชตเดิม 1 อัน — พบ ${chatFrames.length}`);
    const composers = await chatFrames[0].locator("textarea").count();
    assert.equal(composers, 1, `ต้องมี Composer ตัวจริงชุดเดียวในหน้าจอแชตเดิม — พบ ${composers}`);
    ok("กล่อง AI ด้านล่างยังชุดเดียว (iframe แชตเดิม 1 · Composer 1 — ไม่มีหน้าแชต/กล่องใหม่)");

    // ── 13) ปุ่มจัดการบน Tab Bar: ＋ · 🔍 · ⋯ (owner 2026-10-18) ──────────────
    const barControls = await shell.evaluate(() => ({
      newTab: document.querySelectorAll("#tabBar #newTab").length,
      search: document.querySelectorAll("#tabBar #tabSearch").length,
      overflow: document.querySelectorAll("#tabBar #tabOverflow").length,
      searchLabel: document.getElementById("tabSearch")?.getAttribute("aria-label") || "",
      overflowLabel: document.getElementById("tabOverflow")?.getAttribute("aria-label") || "",
    }));
    assert.deepEqual(barControls, {
      newTab: 1,
      search: 1,
      overflow: 1,
      searchLabel: "ค้นหาหรือเปิดเว็บไซต์ด้วย URL",
      overflowLabel: "จัดการแท็บและหน้าต่าง",
    }, `ปุ่ม ＋/🔍/⋯ ต้องอยู่บน Tab Bar เท่านั้น — พบ ${JSON.stringify(barControls)}`);
    await shell.click("#newTab");
    await shell.waitForSelector("#businessLauncher:not([hidden])", { timeout: 10_000 });
    await shell.click("#closeLauncher");
    ok("Tab Bar มี ＋ (เปิดแท็บใหม่ผ่านเมนูเครื่องมือเดิม) · 🔍 · ⋯ ครบและใช้งานได้");

    // ── 14) ไม่มีตัวเลือกองค์กร/ปุ่มข้อความซ้ำในพื้นที่กลาง ─────────────────
    assert.equal(await page.locator('[data-testid="org-context-control"]').count(), 0, "ต้องไม่มีตัวเลือกองค์กรที่มุมขวาบน");
    assert.equal(await page.locator("#workspace-org").count(), 0, "ต้องไม่มี dropdown องค์กร/สำนักงานใหญ่");
    const innerChat = page.frames().find((f) => f.url().includes("materialSurface=chat"));
    assert.ok(innerChat, "ต้องพบหน้าจอแชตเดิม");
    assert.equal(await innerChat!.locator(".corner").count(), 0, "ต้องไม่มีปุ่มรูปข้อความมุมขวาของพื้นที่กลาง");
    assert.equal(await innerChat!.locator(".edge.right").count(), 0, "⋯ ต้องไม่อยู่ในพื้นที่กลางอีก");
    assert.equal(await innerChat!.locator(".edge.left").count(), 0, "ต้องไม่มีปุ่มเครื่องมือซ้ำจาก shell");
    await page.screenshot({ path: `${SHOTS}/07-tabbar-controls.png` });
    ok("ไม่มีตัวเลือกองค์กร · ไม่มีปุ่มข้อความ/⋯ ในพื้นที่กลาง (⋯ อยู่บน Tab Bar)");

    // ── 15) ⋯ = เมนูจัดการแท็บ/หน้าต่าง (สลับ + ปิดแท็บจากเมนู) ────────────
    // ต้องมีแท็บอื่นที่ปิดได้ — เดิมได้จากแท็บเว็บตัวอย่าง ซึ่งตอนนี้เปิดเบราว์เซอร์แทน (ไม่มี iframe)
    await shell.evaluate(() => window.openToolRoute("/admin/jobs", "งาน"));
    await shell.waitForFunction(() => document.querySelectorAll("#tabStrip .tab").length >= 3, null, { timeout: 15_000 });
    await page.waitForTimeout(300);
    const beforeMenu = await tabState();
    await shell.click("#tabOverflow");
    await shell.waitForSelector("#tabOverflowPanel:not([hidden])", { timeout: 10_000 });
    const menuRows = await shell.locator("#tabMenuList .tab-menu-item").count();
    assert.equal(menuRows, beforeMenu.length, `เมนูต้องแสดงแท็บที่เปิดอยู่ครบ (${beforeMenu.length})`);
    assert.equal(await shell.locator("#tabMenuList .tab-menu-item.is-active").count(), 1, "ต้องมีแท็บปัจจุบัน 1 แถวในเมนู");
    await shell.click('[data-menu-activate="resources"]');
    await page.waitForTimeout(200);
    assert.equal((await tabState()).find((t) => t.active)?.label, "ศูนย์ควบคุมทรัพยากร", "เลือกจากเมนูแล้วต้องสลับแท็บจริง");
    assert.equal(await shell.locator("#tabOverflowPanel").isHidden(), true, "เลือกแท็บแล้วเมนูต้องปิด");
    await shell.click("#tabOverflow");
    await shell.click("#tabMenuCloseOthers");
    await page.waitForTimeout(250);
    const afterCloseOthers = await tabState();
    assert.deepEqual(afterCloseOthers.map((t) => t.label), ["Workspace", "ศูนย์ควบคุมทรัพยากร"], `ปิดแท็บอื่นต้องเหลือแท็บหลัก + แท็บปัจจุบัน — พบ ${afterCloseOthers.map((t) => t.label).join(" | ")}`);
    await page.screenshot({ path: `${SHOTS}/08-tab-overflow-menu.png` });
    ok("⋯ บน Tab Bar = เมนูจัดการแท็บ/หน้าต่าง: แสดงทุกแท็บ · สลับ · ปิดแท็บอื่น · ปิดเมนูเอง");

    // ── 16) 🔍 = ค้นหาแท็บ/เครื่องมือ · เปิด URL ในเบราว์เซอร์จริง (ไม่มี iframe) ──
    await shell.click("#tabSearch");
    await shell.waitForSelector("#tabSearchPanel:not([hidden])", { timeout: 10_000 });
    assert.equal(await shell.locator("#tabSearchResults .tab-pop-empty").count(), 1, "ยังไม่พิมพ์อะไรต้องแสดงคำใบ้ ไม่ค้าง");
    await shell.fill("#tabSearchInput", "ศูนย์ควบคุม");
    await page.waitForTimeout(200);
    const tabHits = await shell.locator("#tabSearchResults .tab-pop-row").count();
    assert.ok(tabHits >= 1, `ค้นหาชื่อแท็บ/เครื่องมือต้องเจอ (พบ ${tabHits})`);
    await shell.fill("#tabSearchInput", "https://example.org");
    await page.waitForTimeout(200);
    const siteRow = await shell.locator("#tabSearchResults [data-search-index=\"0\"]").textContent();
    assert.ok((siteRow ?? "").includes("example.org"), `URL ต้องเสนอ "เปิดเว็บไซต์" — พบ ${siteRow}`);
    const tabsBeforeSearch = (await tabState()).length;
    const searchPopupPromise = page.waitForEvent("popup", { timeout: 25_000 }).catch(() => null);
    await shell.press("#tabSearchInput", "Enter");
    const searchPopup = await searchPopupPromise;
    assert.ok(searchPopup && searchPopup.url().includes("example.org"), "URL จากช่องค้นหาต้องเปิด Official URL ในเบราว์เซอร์");
    await page.waitForTimeout(500);
    assert.equal((await tabState()).length, tabsBeforeSearch, "ห้ามสร้างแท็บสำหรับเว็บภายนอก");
    p = await panes();
    assert.notEqual(p.toolSrc, "https://example.org", "ห้ามฝังเว็บภายนอกใน iframe");
    await searchPopup!.close();
    await page.screenshot({ path: `${SHOTS}/09-tab-search-url.png` });
    ok("🔍 บน Tab Bar: ค้นหาแท็บ/เครื่องมือ + เปิด URL ในเบราว์เซอร์จริง (ไม่มีแท็บ/iframe)");

    const fatal = pageErrors.filter((e) => !/ResizeObserver/.test(e));
    assert.deepEqual(fatal, [], `ต้องไม่มี JS error: ${fatal.join(" | ")}`);
    ok("ไม่มี JavaScript error ระหว่างทั้งชุดการทดสอบ");

    console.log(`\n═══ WORKSPACE TAB BAR: ${pass} checks PASS ═══`);
    console.log(`screenshots: ${SHOTS}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error("\nFAIL:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

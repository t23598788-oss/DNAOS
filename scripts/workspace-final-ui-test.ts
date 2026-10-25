/**
 * WORKSPACE APPEARANCE STANDARD — owner lock 2026-10-18
 *
 * Runs against the real dev server on http://localhost:3141/workspace (Chromium).
 * Presentation-only checks; no business engine, canonical writer, database schema,
 * AI gateway, connector registry, auth, or document engine is exercised or changed.
 *
 * No real session exists in this test context, so the test stubs ONLY the browser
 * endpoints the shell already calls (org-context, ui-preferences, pits, connector
 * status, embed-check). No production data is written.
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, type Frame, type Page } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3141";
const SHOTS =
  process.env.SHOTS_DIR || "docs/workspace-screenshots/workspace-appearance-2026-10-18";

const ORG = {
  organizationId: "00000000-0000-4000-8000-0000000000aa",
  name: "SYNTH-ORG-A",
  role: "admin",
};

type ThemePrefs = {
  preset: string;
  mode: string;
  tone: string;
  opacity: number;
  blur: number;
  radius: number;
  fontSize: number;
  iconSize: number;
};

type Prefs = {
  theme: ThemePrefs;
  shortcuts: { id: string; label: string; kind: string; value: string; icon: string }[];
};

const DEFAULT_PREFS: Prefs = {
  theme: {
    preset: "clear",
    mode: "light",
    tone: "#e6e0d6",
    opacity: 78,
    blur: 8,
    radius: 14,
    fontSize: 13,
    iconSize: 20,
  },
  shortcuts: [],
};

declare global {
  interface Window {
    WorkspaceCustomization: {
      get(): Prefs;
      getResolved(): ThemePrefs;
      systemMode(): "light" | "dark";
      setPreset(name: string): void;
      updateTheme(patch: Partial<ThemePrefs>): void;
      resetTheme(): void;
    };
    openToolRoute(route: string, label?: string): void;
  }
}

const PITS = {
  pits: Array.from({ length: 18 }, (_, i) => ({
    id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`,
    name: `SYNTH-PIT-${i + 1}`,
    company_name: "SYNTH COMPANY",
    contact_name: "SYNTH CONTACT",
    address: "SYNTH ADDRESS",
    lat: 13.7,
    lng: 100.5,
    active: true,
    is_open: true,
    business_type: "factory",
    business_type_label: "โรงงาน",
    materials: [{ material_type_id: "m1", name: "SYNTH-MATERIAL", price: 120 }],
  })),
  materialTypes: [{ id: "m1", name: "SYNTH-MATERIAL" }],
  facilityTypes: [],
  counters: { total: 18, active: 18, inactive: 0, missing_price: 0, missing_gps: 0 },
};

let pass = 0;
const ok = (name: string) => {
  pass += 1;
  console.log(`PASS  ${name}`);
};

function rgb(luminanceValue: string): number {
  const numbers = luminanceValue.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const [r = 0, g = 0, b = 0] = numbers;
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function hexToRgbCss(hex: string): string {
  const value = hex.replace("#", "");
  return `rgb(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)})`;
}

async function waitFrame(page: Page, part: string, timeoutMs = 60_000): Promise<Frame> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const frame = page.frames().find((f) => f.url().includes(part));
    if (frame) return frame;
    await page.waitForTimeout(250);
  }
  throw new Error(`frame not found: ${part}`);
}

async function removeDevOverlay(page: Page) {
  await page.evaluate(() => document.querySelectorAll("nextjs-portal").forEach((n) => n.remove()));
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  const captured: { stored: Prefs | null; put: Prefs | null } = { stored: null, put: null };

  await page.route("**/api/workspace/ui-preferences", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          userId: "00000000-0000-4000-8000-00000000aa11",
          stored: Boolean(captured.stored),
          preferences: captured.stored ?? DEFAULT_PREFS,
        }),
      });
    }
    const body = route.request().postDataJSON() as { preferences?: Prefs } | null;
    if (body?.preferences) {
      captured.stored = body.preferences;
      captured.put = body.preferences;
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
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
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PITS) }),
  );
  await page.route("**/api/admin/connectors", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ connectors: [] }) }),
  );
  await page.route("**/api/admin/connectors/providers", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ providers: [] }) }),
  );
  await page.route("**/api/workspace/embed-check*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ embeddable: true }) }),
  );

  try {
    await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded" });
    const shell = await waitFrame(page, "material-workspace");
    const chat = await waitFrame(page, "materialSurface=chat");
    const ta = chat.locator("textarea[aria-label='คำสั่ง']");
    await ta.waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1400);
    await removeDevOverlay(page);

    const shellTheme = (frame: Frame = shell) =>
      frame.evaluate(() => {
        const html = document.documentElement;
        const root = getComputedStyle(html);
        const body = getComputedStyle(document.body);
        const aside = document.querySelector("aside");
        const tabBar = document.getElementById("tabBar");
        return {
          preset: html.dataset.wsPreset || "",
          mode: html.dataset.wsTheme || "",
          bg: body.backgroundColor,
          color: body.color,
          font: body.fontFamily,
          aside: aside ? getComputedStyle(aside).backgroundColor : "",
          tabbar: tabBar ? getComputedStyle(tabBar).backgroundColor : "",
          vars: {
            bg: root.getPropertyValue("--ws-bg").trim(),
            sidebar: root.getPropertyValue("--ws-sidebar-bg").trim(),
            tabbar: root.getPropertyValue("--ws-tabbar-bg").trim(),
            ink: root.getPropertyValue("--ws-ink").trim(),
            radius: root.getPropertyValue("--ws-radius").trim(),
            icon: root.getPropertyValue("--ws-icon-size").trim(),
            fontSize: root.getPropertyValue("--ws-font-size").trim(),
            blur: root.getPropertyValue("--ws-blur").trim(),
          },
        };
      });

    const chatTheme = (frame: Frame = chat) =>
      frame.evaluate(() => {
        const frame = document.getElementById("dna-frame");
        const form = document.querySelector("form.compose");
        if (!frame || !form) return null;
        const cs = getComputedStyle(frame);
        const compose = getComputedStyle(form);
        return {
          theme: frame.dataset.wsTheme || "",
          bg: cs.backgroundColor,
          color: cs.color,
          font: cs.fontFamily,
          fontSize: cs.fontSize,
          composerBg: compose.backgroundColor,
          composerBorder: compose.borderTopColor,
          composerBlur: compose.backdropFilter,
          composerRadius: compose.borderTopLeftRadius,
        };
      });

    const openSettings = async (frame: Frame = shell) => {
      if (await frame.locator("#workspaceSettings").isHidden()) {
        await frame.click("#settings");
        await page.waitForTimeout(250);
      }
    };

    const closeSettings = async (frame: Frame = shell) => {
      if (await frame.locator("#workspaceSettings").isVisible()) {
        await frame.click("#wsSettingsClose");
        await page.waitForTimeout(200);
      }
    };

    const pickPreset = async (name: string, frame: Frame = shell) => {
      await openSettings(frame);
      await frame.locator(`#workspaceSettings [data-ws-preset="${name}"]`).click();
      await page.waitForTimeout(500);
      return shellTheme(frame);
    };

    const setRange = async (id: string, value: number) => {
      await shell.locator(id).evaluate((el, v) => {
        (el as HTMLInputElement).value = String(v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);
      await page.waitForTimeout(180);
    };

    // ── 01 — NO BOTTOM BAR / FULL HEIGHT ─────────────────────────────────────
    assert.equal(await shell.locator("footer").count(), 0, "shell ต้องไม่มี footer/bottom bar");
    assert.equal(await chat.locator("footer").count(), 0, "หน้าแชตต้องไม่มี footer");
    const homeBox = await shell.evaluate(() => {
      const r = document.getElementById("homePane")!.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
    });
    assert.ok(homeBox.bottom >= 898, `พื้นที่กลางต้องเต็มถึงขอบล่าง (${JSON.stringify(homeBox)})`);
    const chatGap = await chat.evaluate(() => {
      const f = (document.querySelector("form.compose") as HTMLElement).getBoundingClientRect();
      const s = (document.querySelector(".stage") as HTMLElement).getBoundingClientRect();
      return Math.round(s.bottom - f.bottom);
    });
    assert.ok(chatGap <= 16, `Composer ต้องอยู่ชิดขอบล่าง ไม่มีแถบกินที่ (${chatGap}px)`);
    await page.screenshot({ path: `${SHOTS}/01-no-bottom-bar.png` });
    ok(`01 ไม่มี Bottom Bar/Footer · พื้นที่กลางถึง y=${homeBox.bottom} · ช่องว่างล่างแชต ${chatGap}px`);

    // ── 02 — ONE TRANSPARENT QAI COMPOSER ────────────────────────────────────
    const emptyComposer = await chatTheme();
    assert.ok(emptyComposer, "ต้องมี #dna-frame + form.compose");
    const emptyBox = await chat.evaluate(() => {
      const f = document.querySelector("form.compose")!.getBoundingClientRect();
      return { height: Math.round(f.height) };
    });
    assert.ok(emptyBox.height >= 48 && emptyBox.height <= 56, `กล่องเปล่าต้องกะทัดรัด (${emptyBox.height})`);
    assert.match(emptyComposer!.composerBg, /rgba\(\d+, \d+, \d+, 0\.\d+\)/, `Composer ต้องโปร่งแสง (${emptyComposer!.composerBg})`);
    const defaultBg = emptyComposer!.composerBg;
    await chat.locator("form.compose").hover();
    await page.waitForTimeout(320);
    const hoverComposer = await chatTheme();
    assert.notEqual(hoverComposer!.composerBg, defaultBg, "Hover ต้องเห็นพื้นผิวชัดขึ้น");
    await ta.click();
    await ta.fill("ข้อความที่ยังไม่ส่ง");
    await page.waitForTimeout(350);
    const focusComposer = await chatTheme();
    assert.notEqual(focusComposer!.composerBg, defaultBg, "Focus ต้องชัดขึ้น");
    await chat.locator(".stage").click({ position: { x: 4, y: 4 } });
    await page.waitForTimeout(450);
    assert.equal(await ta.inputValue(), "ข้อความที่ยังไม่ส่ง", "ออกจาก Focus ต้องไม่ลบข้อความ");
    assert.equal(await chat.locator("form.compose").count(), 1, "Composer ต้องมีกล่องเดียว");
    assert.equal(await chat.locator("textarea[aria-label='คำสั่ง']").count(), 1, "ช่องพิมพ์ต้องมีช่องเดียว");
    assert.equal(await chat.locator("[data-compose-plus]").count(), 1, "(+) ต้องมี");
    assert.equal(await chat.locator("[data-testid='compose-mic']").count(), 1, "ไมค์ต้องมี");
    assert.equal(await chat.locator("button[aria-label='ส่งคำสั่ง']").count(), 1, "ปุ่มส่งต้องมี");
    await page.screenshot({ path: `${SHOTS}/02-composer-transparent.png` });
    ok(`02 Composer โปร่งใส ${defaultBg} · hover/focus เปลี่ยนพื้นผิว · ข้อความค้างอยู่ · ปุ่ม +/ไมค์/ส่ง ครบ`);

    // ── 03 — ONE APPEARANCE POINT, SIX CONTROLS, NO DUPLICATE PROFILE ────────
    await removeDevOverlay(page);
    await openSettings();
    assert.equal(await shell.locator("#workspaceSettings").isVisible(), true, "ปุ่มตั้งค่าเดิมต้องเปิดแผงหน้าตา");
    const presets = await shell.locator("#workspaceSettings [data-ws-preset]").allTextContents();
    assert.deepEqual(presets, ["กระจกใส", "กระจกสว่าง", "กระจกเข้ม", "กระจกสี", "อัตโนมัติ", "ปรับแต่งเอง"]);
    assert.equal(await shell.locator("#workspaceSettings input[type=color]").count(), 1, "ต้องมีโทนสีกลางจุดเดียว");
    assert.equal(await shell.locator("#workspaceSettings input[type=range]").count(), 5, "ต้องมี 5 สไลเดอร์");
    assert.equal(await shell.locator("#wsTone").count(), 1);
    assert.equal(await shell.locator("#wsOpacity").count(), 1);
    assert.equal(await shell.locator("#wsBlur").count(), 1);
    assert.equal(await shell.locator("#wsFontSize").count(), 1);
    assert.equal(await shell.locator("#wsIconSize").count(), 1);
    assert.equal(await shell.locator("#wsRadius").count(), 1);
    for (const forbidden of ["#wsSidebar", "#wsTabbar", "#wsComposer", "#wsBackground", "#wsBorder", "#wsTexture", "#wsAvatarPick"]) {
      assert.equal(await shell.locator(`#workspaceSettings ${forbidden}`).count(), 0, `${forbidden} ต้องไม่อยู่ในแผงหน้าตา`);
    }
    const panelText = await shell.locator("#workspaceSettings").innerText();
    for (const forbidden of ["โปรไฟล์ของฉัน", "รูปโปรไฟล์บัญชีนี้", "เปลี่ยนรูป"]) {
      assert.equal(panelText.includes(forbidden), false, `ต้องไม่มี "${forbidden}" ในแผงหน้าตา`);
    }
    assert.equal(await shell.locator("#companyProfile").count(), 1, "ระบบโปรไฟล์บริษัทเดิมต้องยังอยู่");
    assert.equal(await shell.locator("#profileMenu").count(), 1, "เมนูโปรไฟล์บริษัทเดิมต้องยังอยู่");
    assert.equal(await shell.locator('#profileMenu [data-profile-route="/admin/settings"]').count(), 1);
    ok("03 แผงหน้าตาเหลือจุดเดียว · 6 ธีม · 6 ตัวควบคุมกลาง · ไม่มีโปรไฟล์ซ้ำ · โปรไฟล์บริษัทเดิมอยู่");

    // ── 04 — FIVE STANDARD THEMES, ONE TOKEN SET ──────────────────────────────
    const clear = await pickPreset("clear");
    assert.equal(clear.preset, "clear");
    assert.equal(clear.mode, "light");
    assert.ok(rgb(clear.bg) > 0.7, `Clear Glass ต้องสว่าง (${clear.bg})`);
    const clearChat = await chatTheme();
    assert.equal(clearChat!.bg, hexToRgbCss(clear.vars.bg), "QAI Composer ต้องใช้พื้นเดียวกับ shell");
    assert.equal(clearChat!.fontSize, "14px", "ขนาดตัวอักษรเริ่มต้นต้อง 13+1px");
    await page.screenshot({ path: `${SHOTS}/03-clear-glass.png` });
    ok(`04a กระจกใส (ค่าเริ่มต้น) · shell=${clear.bg} · composer=${clearChat!.bg}`);

    const light = await pickPreset("light");
    assert.equal(light.preset, "light");
    assert.equal(light.mode, "light");
    assert.notEqual(light.bg, clear.bg, "กระจกสว่างต้องต่างจากกระจกใส");
    assert.notEqual(light.aside, clear.aside, "Sidebar ต้องเปลี่ยนตามโทนกลาง");
    assert.notEqual(light.tabbar, clear.tabbar, "Tab Bar ต้องเปลี่ยนตามโทนกลาง");
    await page.screenshot({ path: `${SHOTS}/04-light-glass.png` });
    ok(`04b กระจกสว่าง · Sidebar/Tab Bar เปลี่ยนพร้อมกัน (${light.aside} / ${light.tabbar})`);

    const tinted = await pickPreset("tinted");
    assert.equal(tinted.preset, "tinted");
    assert.equal(tinted.mode, "light");
    assert.notEqual(tinted.bg, light.bg, "กระจกสีต้องต่างจากกระจกสว่าง");
    await page.screenshot({ path: `${SHOTS}/05-tinted-glass.png` });
    ok(`04c กระจกสี · พื้นผิวโทนสีเดียวทั้ง shell (${tinted.bg})`);

    const dark = await pickPreset("dark");
    assert.equal(dark.preset, "dark");
    assert.equal(dark.mode, "dark");
    assert.ok(rgb(dark.bg) < 0.25, `กระจกเข้มต้องมืด (${dark.bg})`);
    const darkChat = await chatTheme();
    assert.equal(darkChat!.theme, "dark", "Composer ต้องเข้าธีมเข้ม");
    assert.equal(darkChat!.bg, hexToRgbCss(dark.vars.bg), "Composer ต้องใช้พื้นเดียวกับ shell");
    assert.ok(rgb(darkChat!.composerBg) < 0.5, `Composer ต้องมืด (${darkChat!.composerBg})`);
    await page.screenshot({ path: `${SHOTS}/06-dark-glass.png` });

    // The resource table must stay on the same tokens and must not overflow.
    await closeSettings();
    await shell.click("[data-view='all']");
    await shell.waitForSelector("#stockPane:not([hidden])", { timeout: 30_000 });
    await shell.waitForFunction(() => document.querySelectorAll("#pitList .pit-item").length > 0, { timeout: 30_000 });
    const stock = await shell.evaluate(() => {
      const pane = document.getElementById("stockPane")!;
      const list = document.getElementById("pitList")!;
      const paneStyle = getComputedStyle(pane);
      const listStyle = getComputedStyle(list);
      return {
        bg: paneStyle.backgroundColor,
        ink: listStyle.color,
        overflow: list.scrollWidth > list.clientWidth + 1,
        rows: list.querySelectorAll(".pit-item").length,
      };
    });
    assert.equal(stock.bg, dark.bg, "ตาราง/resources ต้องใช้พื้นเดียวกับ Workspace");
    assert.equal(stock.ink, hexToRgbCss(dark.vars.ink), "ตัวอักษรตารางต้องใช้ ink กลาง");
    assert.equal(stock.overflow, false, "ตารางต้องไม่เสียรูปแบบ/ไม่ล้นแนวนอน");
    assert.ok(stock.rows > 0, "ตารางต้องแสดงข้อมูลเดิม");
    await page.screenshot({ path: `${SHOTS}/06b-dark-resource-table.png` });
    await shell.click("#chatHome");
    await page.waitForTimeout(300);
    ok(`04d กระจกเข้ม · shell/ตาราง/Composer เข้าชุดกัน (${dark.bg} / ${darkChat!.composerBg})`);

    // ── 05 — AUTO FOLLOWS prefers-color-scheme ───────────────────────────────
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(300);
    const autoDark = await pickPreset("auto");
    assert.equal(autoDark.preset, "auto");
    assert.equal(autoDark.mode, "dark", "Auto + OS dark ต้องเป็น Dark Glass");
    const autoDarkChat = await chatTheme();
    assert.equal(autoDarkChat!.theme, "dark", "Composer ต้องเป็น dark ตาม Auto");
    await page.screenshot({ path: `${SHOTS}/07-auto-dark.png` });

    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForTimeout(650);
    const autoLight = await shellTheme();
    const autoLightChat = await chatTheme();
    assert.equal(autoLightChat!.theme, "light", "Composer ต้องเป็น light ตาม Auto");
    assert.equal(autoLight.preset, "auto", "ยังต้องเป็นโหมดอัตโนมัติ");
    assert.equal(autoLight.mode, "light", "Auto ต้องเปลี่ยนตาม OS โดยไม่ต้องเลือกใหม่");
    assert.notEqual(autoLight.bg, autoDark.bg, "Auto light/dark ต้องใช้คนละมาตรฐาน");
    await page.screenshot({ path: `${SHOTS}/08-auto-light.png` });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(550);
    const autoDarkAgain = await shellTheme();
    assert.equal(autoDarkAgain.mode, "dark");
    ok("05 Auto ใช้ prefers-color-scheme มาตรฐาน · OS dark→Dark Glass · OS light→Light Glass · เปลี่ยนสด");

    // ── 06 — CUSTOM: ONLY SIX CENTRAL CONTROLS ───────────────────────────────
    await pickPreset("clear");
    await shell.locator('#workspaceSettings [data-ws-preset="custom"]').click();
    await page.waitForTimeout(350);
    await shell.locator("#wsTone").evaluate((el) => {
      (el as HTMLInputElement).value = "#c94f4f";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await setRange("#wsOpacity", 55);
    await setRange("#wsBlur", 20);
    await setRange("#wsFontSize", 17);
    await setRange("#wsIconSize", 26);
    await setRange("#wsRadius", 24);
    await page.waitForTimeout(650);

    const custom = await shellTheme();
    const customPrefs = await shell.evaluate(() => window.WorkspaceCustomization.get().theme);
    assert.equal(custom.preset, "custom");
    assert.equal(customPrefs.preset, "custom");
    assert.equal(custom.vars.radius, "24px");
    assert.equal(custom.vars.icon, "26px");
    assert.equal(custom.vars.fontSize, "17px");
    assert.equal(custom.vars.blur, "20px");
    assert.equal(customPrefs.opacity, 55);
    assert.ok(rgb(custom.bg) > 0.5, "โทน custom ยังอ่านชัด");
    const customChat = await chatTheme();
    assert.equal(customChat!.fontSize, "18px", "Composer ต้องรับขนาดตัวอักษรกลาง");
    assert.equal(customChat!.composerRadius, "24px", "Composer ต้องรับความโค้งกลาง");
    assert.match(customChat!.composerBg, /0\.55\)/, "Composer ต้องรับความโปร่งใส 55%");
    await page.screenshot({ path: `${SHOTS}/09-custom.png` });
    ok(`06 ปรับเอง 6 ตัวควบคุม · ตัวอักษร 17px · ไอคอน 26px · มุม 24px · โปร่งใส 55% · Composer ตามทันที`);

    // ── 07 — PERSISTENCE + RESET ─────────────────────────────────────────────
    await page.waitForTimeout(800);
    assert.ok(captured.put, "ต้องบันทึกผ่านระบบ preferences เดิม");
    assert.equal(captured.put!.theme.preset, "custom");
    assert.equal(captured.put!.theme.fontSize, 17);
    await closeSettings();
    await page.reload({ waitUntil: "domcontentloaded" });
    const shell2 = await waitFrame(page, "material-workspace");
    const chat2 = await waitFrame(page, "materialSurface=chat");
    await chat2.locator("textarea[aria-label='คำสั่ง']").waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    await removeDevOverlay(page);

    const reloaded = await shell2.evaluate(() => {
      const html = document.documentElement;
      const root = getComputedStyle(html);
      return {
        preset: html.dataset.wsPreset || "",
        bg: getComputedStyle(document.body).backgroundColor,
        fontSize: root.getPropertyValue("--ws-font-size").trim(),
        radius: root.getPropertyValue("--ws-radius").trim(),
      };
    });
    assert.equal(reloaded.preset, "custom", "เปิดใหม่แล้วต้องคงธีมที่บันทึก");
    assert.equal(reloaded.bg, custom.bg, "พื้นหลังต้องคงค่า");
    assert.equal(reloaded.fontSize, "17px");
    assert.equal(reloaded.radius, "24px");

    await shell2.click("#settings");
    await shell2.click("#wsReset");
    await page.waitForTimeout(600);
    const reset = await shell2.evaluate(() => {
      const html = document.documentElement;
      const root = getComputedStyle(html);
      return {
        preset: html.dataset.wsPreset || "",
        bg: getComputedStyle(document.body).backgroundColor,
        icon: root.getPropertyValue("--ws-icon-size").trim(),
        radius: root.getPropertyValue("--ws-radius").trim(),
      };
    });
    assert.equal(reset.preset, "clear");
    assert.ok(rgb(reset.bg) > 0.7);
    assert.equal(reset.icon, "20px");
    assert.equal(reset.radius, "14px");
    ok("07 บันทึกตามบัญชี (PUT → reload → GET) · คงค่า custom · คืนค่าเริ่มต้นกลับ Clear Glass/20px/14px");

    // ── 08 — SAME TOKENS REACH EXISTING TOOL PAGES ───────────────────────────
    await closeSettings(shell2);
    await pickPreset("dark", shell2);
    await closeSettings(shell2);
    await shell2.evaluate(() => window.openToolRoute("/admin/ui-gallery", "UI Gallery"));
    const tool = await waitFrame(page, "/admin/ui-gallery");
    await tool.locator("h1").first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1000);

    const toolTheme = () =>
      tool.evaluate(() => {
        const html = document.documentElement;
        const root = getComputedStyle(html);
        const body = getComputedStyle(document.body);
        const h1 = document.querySelector("h1");
        const select = document.querySelector("select");
        return {
          theme: html.dataset.dnaWsTheme || "",
          preset: html.dataset.dnaWsPreset || "",
          bg: body.backgroundColor,
          color: body.color,
          font: body.fontFamily,
          h1Color: h1 ? getComputedStyle(h1).color : "",
          selectColor: select ? getComputedStyle(select).color : "",
          vars: {
            bg: root.getPropertyValue("--dna-bg").trim(),
            surface: root.getPropertyValue("--dna-surface").trim(),
            ink: root.getPropertyValue("--dna-ink").trim(),
            muted: root.getPropertyValue("--dna-muted").trim(),
            border: root.getPropertyValue("--dna-border").trim(),
          },
        };
      });

    const toolDark = await toolTheme();
    assert.equal(toolDark.theme, "dark", "หน้าจอเครื่องมือต้องรับธีมเข้ม");
    assert.equal(toolDark.bg, dark.bg, "พื้นหน้าจอเครื่องมือต้องเท่ากับ Workspace");
    assert.match(toolDark.font, /Sarabun/i, "ฟอนต์ต้องเป็นฟอนต์กลาง");
    assert.equal(toolDark.h1Color, hexToRgbCss(toolDark.vars.ink), "ตัวอักษรต้องใช้ ink กลาง");

    const probe = await tool.evaluate(() => {
      const el = document.createElement("div");
      el.id = "dna-token-probe";
      el.className = "bg-white border border-stone-200 text-stone-500 rounded-lg";
      el.textContent = "token probe";
      document.body.appendChild(el);
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, border: cs.borderTopColor, color: cs.color, radius: cs.borderTopLeftRadius };
    });
    assert.equal(probe.bg, hexToRgbCss(toolDark.vars.surface), "การ์ด bg-white ต้องใช้ surface กลาง");
    assert.equal(probe.border, hexToRgbCss(toolDark.vars.border), "เส้นขอบต้องใช้ border กลาง");
    assert.equal(probe.color, hexToRgbCss(toolDark.vars.muted), "ข้อความรองต้องใช้ muted กลาง");
    assert.equal(probe.radius, "18px", "มุมต้องใช้ radius กลาง");
    await tool.evaluate(() => document.getElementById("dna-token-probe")?.remove());
    await page.screenshot({ path: `${SHOTS}/10-tool-page-dark.png` });
    ok(`08 หน้าจอเครื่องมือเดียวกันรับ token กลาง (${toolDark.bg}) · ฟอนต์/การ์ด/ขอบ/มุมตรงกัน`);

    // Switch theme while the tool page is open — it must change without reload.
    const tintedAgain = await pickPreset("tinted", shell2);
    await page.waitForTimeout(600);
    const toolTinted = await toolTheme();
    assert.equal(toolTinted.theme, "light");
    assert.equal(toolTinted.bg, tintedAgain.bg, "ธีมใหม่ต้องถึงหน้าจอเครื่องมือที่เปิดอยู่");
    assert.notEqual(toolTinted.bg, toolDark.bg);

    // ── 09 — DOCUMENT / PDF OUTPUT IS NOT RESTYLED ───────────────────────────
    await tool.evaluate(async () => {
      const frame = document.createElement("iframe");
      frame.id = "dna-document-probe";
      frame.style.width = "320px";
      frame.style.height = "120px";
      document.body.appendChild(frame);
      await new Promise<void>((resolve) => {
        frame.onload = () => resolve();
        frame.srcdoc =
          '<!doctype html><html><body style="background:#ffffff;color:#111111;font-family:Times New Roman,serif">เอกสารต้นฉบับ</body></html>';
      });
    });
    const documentBefore = await tool.evaluate(() => {
      const frame = document.getElementById("dna-document-probe") as HTMLIFrameElement;
      const doc = frame.contentDocument!;
      return {
        theme: doc.documentElement.dataset.dnaWsTheme || null,
        bg: getComputedStyle(doc.body).backgroundColor,
        color: getComputedStyle(doc.body).color,
        font: getComputedStyle(doc.body).fontFamily,
      };
    });
    await pickPreset("dark", shell2);
    await page.waitForTimeout(700);
    const documentAfter = await tool.evaluate(() => {
      const frame = document.getElementById("dna-document-probe") as HTMLIFrameElement;
      const doc = frame.contentDocument!;
      return {
        theme: doc.documentElement.dataset.dnaWsTheme || null,
        bg: getComputedStyle(doc.body).backgroundColor,
        color: getComputedStyle(doc.body).color,
        font: getComputedStyle(doc.body).fontFamily,
      };
    });
    assert.deepEqual(documentAfter, documentBefore, "เอกสาร/PDF ต้องไม่เปลี่ยนตามธีม");
    assert.equal(documentBefore.bg, "rgb(255, 255, 255)");
    assert.match(documentBefore.font, /Times New Roman/i);
    assert.equal(documentBefore.theme, null);
    await page.screenshot({ path: `${SHOTS}/11-document-output-unchanged.png` });
    await tool.evaluate(() => document.getElementById("dna-document-probe")?.remove());
    ok("09 เอกสาร/PDF ใน nested document ไม่ถูกแต่งสี/ฟอนต์ตามธีม (ขาว/ดำ/Times เดิม)");

    // ── 10 — EXISTING PROFILE + TAB BAR STILL WORK ───────────────────────────
    await closeSettings(shell2);
    await shell2.click("#chatHome");
    await page.waitForTimeout(400);
    assert.ok(await shell2.locator("#tabStrip .tab.is-active").count() >= 1, "Tab Bar ยังเลือกแท็บได้");
    await shell2.click("#tabOverflow");
    assert.equal(await shell2.locator("#tabOverflowPanel").isVisible(), true, "เมนูจัดการแท็บเดิมยังทำงาน");
    await page.keyboard.press("Escape");

    await shell2.click("#companyProfile");
    assert.equal(await shell2.locator("#profileMenu").isVisible(), true, "เมนูโปรไฟล์บริษัทเดิมยังเปิดได้");
    const profileText = await shell2.locator("#profileMenu").innerText();
    assert.ok(profileText.includes("ข้อมูลบริษัท"), "เมนูเดิมต้องมีข้อมูลบริษัท");
    assert.ok(profileText.includes("เปลี่ยนโลโก้บริษัท"), "ระบบโลโก้บริษัทเดิมต้องยังอยู่");
    const menuColors = await shell2.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const menu = document.getElementById("profileMenu")!;
      const button = menu.querySelector("button")!;
      const title = document.getElementById("profileCompanyName")!;
      return {
        menuBg: getComputedStyle(menu).backgroundColor,
        menuInk: getComputedStyle(button).color,
        titleInk: getComputedStyle(title).color,
        ink: root.getPropertyValue("--ws-ink").trim(),
        panel: root.getPropertyValue("--ws-panel-bg").trim(),
      };
    });
    assert.equal(menuColors.menuBg, hexToRgbCss(menuColors.panel), "เมนูโปรไฟล์ต้องใช้พื้น panel กลาง");
    assert.equal(menuColors.menuInk, hexToRgbCss(menuColors.ink), "เมนูโปรไฟล์ต้องใช้ ink กลาง");
    assert.equal(menuColors.titleInk, hexToRgbCss(menuColors.ink), "ชื่อบริษัทในเมนูต้องใช้ ink กลาง");
    await shell2.click("#companyProfile");

    await shell2.click("#toolsMain");
    await shell2.waitForSelector("#businessLauncher:not([hidden])", { timeout: 20_000 });
    const launcherColors = await shell2.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const launcher = document.getElementById("businessLauncher")!;
      const title = launcher.querySelector(".launcher-title strong");
      return {
        bg: getComputedStyle(launcher).backgroundColor,
        title: title ? getComputedStyle(title).color : "",
        ink: root.getPropertyValue("--ws-ink").trim(),
        panel: root.getPropertyValue("--ws-panel-bg").trim(),
      };
    });
    assert.equal(launcherColors.bg, hexToRgbCss(launcherColors.panel), "Launcher ต้องใช้พื้น panel กลาง");
    assert.equal(launcherColors.title, hexToRgbCss(launcherColors.ink), "หัวข้อ Launcher ต้องใช้ ink กลาง");
    await shell2.click("#closeLauncher");
    assert.equal(await shell2.locator("footer").count(), 0, "ยังต้องไม่มี Bottom Bar");
    ok("10 โปรไฟล์บริษัทเดิม + Launcher + Tab Bar เดิมยังทำงาน · เมนูใช้ token กลาง · ไม่มี Bottom Bar");

    assert.deepEqual(pageErrors, [], `ต้องไม่มี JavaScript error: ${pageErrors.join(" | ")}`);
    console.log(`\n═══ WORKSPACE APPEARANCE STANDARD: ${pass} checks PASS ═══`);
    console.log(`screenshots: ${SHOTS}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exit(1);
  });

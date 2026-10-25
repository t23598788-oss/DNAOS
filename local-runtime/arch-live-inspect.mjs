// PHASE 1 live inspection — READ-ONLY browser check ของ https://…/#architecture
// ใช้ Playwright ที่ติดตั้งอยู่แล้ว (package.json ^1.62.1) — ไม่ติดตั้งใหม่
// บันทึกเฉพาะ: final URL, title, console errors, network (method/status/url ของ /api/*)
// ห้ามพริ้นค่า cookie/token จริงออกทาง output ทุกกรณี
import { chromium } from "playwright";
import { readFileSync, existsSync, writeFileSync } from "node:fs";

const BASE = "https://dna-os-deadboard-production.up.railway.app";
const COOKIE_FILE = "/tmp/qa-prod-cookies.txt";

function parseNetscapeCookies() {
  if (!existsSync(COOKIE_FILE)) return [];
  const out = [];
  for (const line of readFileSync(COOKIE_FILE, "utf8").split("\n")) {
    if (!line || line.startsWith("# ")) continue;
    const p = line.trim().split("\t");
    if (p.length !== 7) continue;
    let domain = p[0];
    if (!domain) continue;
    if (domain !== "localhost" && !domain.startsWith(".")) {
      domain = domain.replace(/^#HttpOnly_/, "");
      if (!domain.startsWith(".")) domain = "." + domain;
    }
    domain = domain.replace(/^#HttpOnly_/, "");
    if (domain.startsWith("#HttpOnly_")) domain = domain.slice(10);
    const [rawDomain, , path, secure, , name, value] = [
      domain || p[0],
      p[1],
      p[2] || "/",
      p[3] === "TRUE",
      p[4],
      p[5],
      p[6],
    ];
    if (!name || !value) continue;
    out.push({
      name,
      value,
      domain: rawDomain,
      path: path || "/",
      secure: !!secure,
      httpOnly: name.startsWith("sb-"),
      sameSite: "Lax",
    });
  }
  return out;
}

const cookies = parseNetscapeCookies();
console.log(`cookies loaded: ${cookies.length} (ชื่อตัวแรก: ${cookies[0]?.name ?? "-"} — ไม่แสดงค่า)`);

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Macintosh) DNA-QA-ReadOnly-Inspection",
  });
  if (cookies.length > 0) await context.addCookies(cookies);

  const page = await context.newPage();
  const consoleErrors = [];
  const apiCalls = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 250));
  });

  page.on("response", (res) => {
    const url = res.url();
    let path = "";
    try {
      const u = new URL(url);
      if (u.origin !== BASE) return;
      path = u.pathname + u.search;
    } catch {
      return;
    }
    if (!path.startsWith("/api/") && !path.startsWith("/_next/")) return;
    apiCalls.push({
      method: res.request().method(),
      path: path.slice(0, 160),
      status: res.status(),
      contentType: (res.headers()["content-type"] ?? "").split(";")[0],
    });
  });

  const response = await page.goto(BASE + "/#architecture", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  // รอ hydration + fetch on-mount ของ system-reality
  await page.waitForTimeout(9_000);

  const finalUrl = page.url();
  const title = await page.title();
  const scrollToArch = await page.evaluate(() => {
    const el = document.getElementById("architecture");
    return el ? { found: true, tag: el.tagName, childCount: el.childElementCount } : { found: false };
  });

  const result = {
    http_status_document: response?.status() ?? null,
    final_url_path: (() => {
      try { return new URL(finalUrl).pathname + (new URL(finalUrl).hash || ""); } catch { return finalUrl; }
    })(),
    title,
    section_architecture: scrollToArch,
    console_error_count: consoleErrors.length,
    console_error_samples: consoleErrors.slice(0, 5),
    api_calls: apiCalls,
    cookie_count_sent: cookies.length,
  };
  writeFileSync("local-runtime/arch-live-inspect-result.json", JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result, null, 1));
} finally {
  await browser.close();
}

// Real E-Statement Portal Automation (owner, 2026-07-27): "อยากเชื่อมแบบ
// real ไทม์ไปเลย...แม้กระทั่งต้องไปอ่าน OTP กรอกเข้ากล่อง OTP แบบอัตโนมัติ"
// — explicit, informed go-ahead after being told the real risk (this
// automates logging into the owner's own K-Docportal session, a higher-risk
// action than reading Gmail). Runs LOCALLY on the owner's own Mac only —
// same architectural pattern as ai-task-watcher.mjs/print-watcher.mjs (real
// browser automation cannot run inside a Supabase Edge Function's Deno
// runtime, and a bank portal login must never touch a cloud server anyway).
//
// Real flow, confirmed live 2026-07-27 against the owner's actual inbox:
//   1. Find the newest "E-document (K-Deposit Statement)" email → real
//      kdocportal.kasikornbank.com resolver link (Next.js SPA, not a plain
//      form — needs a real browser, not curl/fetch).
//   2. Enter the real 5-digit password (last 5 digits of the juristic
//      registration number — KASIKORN_STATEMENT_PASSWORD env var, never
//      hardcoded).
//   3. Trigger OTP send, then poll the SAME Gmail inbox for the real
//      "OTP to open document list" email that arrives within it.
//   4. Submit the OTP, download the resulting zip, unzip with the same
//      password (same rule the manual download used), pdftotext the real
//      statement PDF, parse the real ledger rows.
//   5. Insert real transactions into bank_statement_transactions (Supabase).
//
// Honest caveat left for the owner directly, not glossed over: this is the
// FIRST version against a portal Claude has never automated before — the
// CSS selectors below are a reasonable first attempt, not guaranteed to
// match K-Docportal's real DOM on the first run. Expect to run this once
// with `HEADLESS=false` to watch it and adjust selectors together.

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function loadEnvLocal() {
  const p = path.join(process.cwd(), "..", "..", ".env.local");
  if (!existsSync(p)) return {};
  const text = readFileSync(p, "utf-8");
  const env = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const ENV = { ...loadEnvLocal(), ...process.env };
const GMAIL_CLIENT_ID = ENV.GMAIL_CLIENT_ID;
const GMAIL_CLIENT_SECRET = ENV.GMAIL_CLIENT_SECRET;
const GMAIL_REFRESH_TOKEN = ENV.GMAIL_REFRESH_TOKEN;
const STATEMENT_PASSWORD = ENV.KASIKORN_STATEMENT_PASSWORD; // last 5 digits of juristic registration number
const SUPABASE_URL = ENV.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = ENV.SUPABASE_SERVICE_ROLE_KEY;
const HEADLESS = ENV.HEADLESS !== "false";

if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
  console.error("Missing GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN in .env.local");
  process.exit(1);
}
if (!STATEMENT_PASSWORD) {
  console.error("Missing KASIKORN_STATEMENT_PASSWORD in .env.local (last 5 digits of the juristic registration number)");
  process.exit(1);
}

async function getAccessToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GMAIL_CLIENT_ID, client_secret: GMAIL_CLIENT_SECRET,
      refresh_token: GMAIL_REFRESH_TOKEN, grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Gmail access token failed: " + JSON.stringify(data));
  return data.access_token;
}

function b64urlDecode(data) {
  const padded = data.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (data.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf-8");
}

// Real bug found live 2026-07-27: the OTP email finder was matching the
// exactly right email (timestamp confirmed correct in the console log) but
// still never found the 6-digit code — because the body is real HTML
// (K-eDocument's emails, confirmed earlier for the K-Deposit Statement
// ones too) and this never stripped the tags before regex-matching, so a
// short 40-char lookahead never survived the actual `<div>`/`<span>`
// markup sitting between "รหัส OTP" and the real digits.
function htmlToPlainText(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&emsp;/gi, "  ")
    .replace(/&amp;/gi, "&");
}

function findRawPart(payload, mimeType) {
  if (payload?.mimeType === mimeType && payload?.body?.data) return b64urlDecode(payload.body.data);
  for (const part of payload?.parts ?? []) {
    const found = findRawPart(part, mimeType);
    if (found) return found;
  }
  return null;
}

function findBodyText(payload) {
  const plain = findRawPart(payload, "text/plain");
  if (plain) return plain;
  const html = findRawPart(payload, "text/html") ?? (payload?.body?.data ? b64urlDecode(payload.body.data) : "");
  return html ? htmlToPlainText(html) : "";
}

async function gmailGet(accessToken, url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gmail API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function findLatestStatementLink(accessToken) {
  // Real bug found live 2026-07-27: 7 days was too narrow — the statement
  // email for a given month arrives shortly after that month ends, so
  // running this any time later in the following month (or later) missed
  // it entirely. 45 days comfortably covers "haven't run this in over a
  // month" without risking picking up a stale multi-month-old one.
  const q = encodeURIComponent("subject:\"K-Deposit Statement\" newer_than:45d");
  const list = await gmailGet(accessToken, `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=1`);
  const id = list.messages?.[0]?.id;
  if (!id) throw new Error("ไม่พบอีเมล K-Deposit Statement ล่าสุด (45 วันที่ผ่านมา)");
  const msg = await gmailGet(accessToken, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`);
  // Real regression found live 2026-07-27: the link only exists as an
  // <a href="..."> ATTRIBUTE in the raw HTML — findBodyText() now strips
  // all tags (added for the separate OTP-parsing fix), which deletes the
  // href text along with the tag. Must search the RAW, un-stripped HTML
  // here, not the plain-text version used for reading visible OTP content.
  const rawHtml = findRawPart(msg.payload, "text/html") ?? findRawPart(msg.payload, "text/plain") ?? "";
  const m = rawHtml.match(/https:\/\/kdocportal\.kasikornbank\.com\/documents\/resolver\?[^\s"'<]+/);
  if (!m) throw new Error("หาลิงก์ kdocportal ในอีเมลไม่เจอ (raw HTML length: " + rawHtml.length + ")");
  return m[0].replace(/&amp;/g, "&");
}

// Polls for the real "OTP to open document list" email that the portal
// sends after we trigger it — real wait loop, not a fixed sleep, since
// email delivery timing is never exactly predictable. Real email format
// confirmed live 2026-07-27: it carries BOTH a 6-digit OTP and a separate
// alphanumeric "รหัสอ้างอิง" (reference code, e.g. "t7UB1C") — the
// portal's OTP screen has two distinct fields and needs both, not just
// the OTP alone.
async function waitForOtp(accessToken, sentAfterMs) {
  // Owner correction (2026-07-27): "อยากให้มันไปทำทริกเกอร์ฝั่งรับสัญญาณ
  // จากอีเมลล่าสุดอิงกับเวลาล่าสุดมาให้มันครอบคลุมมากกว่านี้" — stop
  // trusting Gmail's own search relevance/subject match at all. Broadest
  // real signal available: pull the N newest messages in the ENTIRE inbox
  // (no subject/keyword filter to be wrong about), and pick whichever one
  // is both newest-by-real-timestamp AND actually contains a 6-digit code
  // — the real OTP email's own arrival time is the only thing that matters.
  for (let attempt = 0; attempt < 30; attempt++) {
    const list = await gmailGet(accessToken, `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10`);
    const ids = (list.messages ?? []).map((m) => m.id);
    const candidates = [];
    for (const id of ids) {
      const msg = await gmailGet(accessToken, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`);
      candidates.push(msg);
    }
    candidates.sort((a, b) => Number(b.internalDate ?? 0) - Number(a.internalDate ?? 0));

    console.log(`   [เช็ครอบ ${attempt + 1}] อีเมลล่าสุด ${candidates.length} ฉบับ, เวลาที่กดขอ OTP: ${new Date(sentAfterMs).toLocaleTimeString("th-TH")}`);
    for (const msg of candidates.slice(0, 3)) {
      const subjHeader = msg.payload?.headers?.find((h) => h.name === "Subject")?.value ?? "(no subject)";
      console.log(`     - ${new Date(Number(msg.internalDate)).toLocaleTimeString("th-TH")} | ${subjHeader}`);
    }

    for (const msg of candidates) {
      const internalDate = Number(msg.internalDate ?? 0);
      if (internalDate < sentAfterMs) continue; // older than when we triggered — not a candidate at all
      const body = findBodyText(msg.payload); // now real plain text (HTML stripped) — see htmlToPlainText
      const otpMatch = body.match(/รหัส OTP[\s\S]{0,80}?(\d{6})/) ?? body.match(/\bOTP\b[\s\S]{0,80}?(\d{6})/i) ?? body.match(/\b(\d{6})\b/);
      if (otpMatch) {
        const refMatch = body.match(/รหัสอ้างอิง\s*([A-Za-z0-9]{4,10})/);
        return { otp: otpMatch[1], reference: refMatch?.[1] ?? null };
      }
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("รอ OTP เกิน 150 วินาทีแล้วไม่มาสักที — เช็คอีเมลด้วยตาเองว่ามาหรือยัง");
}

async function run() {
  console.log("1/6 กำลังหาลิงก์ K-Deposit Statement ล่าสุดจาก Gmail...");
  const accessToken = await getAccessToken();
  const portalUrl = await findLatestStatementLink(accessToken);
  console.log("   เจอ:", portalUrl.slice(0, 80) + "...");

  const downloadDir = mkdtempSync(path.join(tmpdir(), "kdoc-"));
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    console.log("2/6 เปิดพอร์ทัลจริง...");
    await page.goto(portalUrl, { waitUntil: "networkidle" });

    console.log("3/6 กรอกรหัสผ่าน...");
    // Real page confirmed live 2026-07-27 (debug-stuck.png): this is a
    // ONE-page, TWO-step form, not a wizard — password field at the top
    // with its own "รับรหัส OTP ทาง Email" button, then a separate OTP
    // section below with TWO fields ("รหัสอ้างอิง" + "รหัส OTP (6 หลัก)")
    // and its own "ยืนยัน" button. The original code's mistake: it looked
    // for a generic "confirm/submit" button and grabbed the disabled
    // bottom "ยืนยัน" (which belongs to the OTP step) instead of the real
    // password-step trigger, whose exact real label is "รับรหัส OTP".
    await page.waitForSelector('input[type="password"], input[type="text"]', { timeout: 15000 });
    const passwordInput = page.locator('input[type="password"]').first();
    const inputToFill = (await passwordInput.count() > 0) ? passwordInput : page.locator('input[type="text"]').first();
    await inputToFill.click();
    await inputToFill.fill(STATEMENT_PASSWORD);
    await inputToFill.press("End");

    console.log('   กดปุ่ม "รับรหัส OTP ทาง Email"...');
    try {
      await page.getByRole("button", { name: /รับรหัส OTP/i }).first().click({ timeout: 15000 });
    } catch (err) {
      await page.screenshot({ path: path.join(process.cwd(), "debug-stuck.png"), fullPage: true });
      writeFileSync(path.join(process.cwd(), "debug-stuck.html"), await page.content());
      throw new Error(`กดปุ่ม "รับรหัส OTP" ไม่ได้ — ดูภาพจริงที่ debug-stuck.png: ${err.message}`);
    }

    const otpTriggerTime = Date.now();
    console.log("4/6 รอ OTP จริงจาก Gmail (ปกติใช้เวลาไม่เกิน 1-2 นาที)...");
    const { otp, reference } = await waitForOtp(accessToken, otpTriggerTime);
    console.log("   ได้ OTP:", otp, "รหัสอ้างอิง:", reference);

    // Real DOM order confirmed from debug-stuck.png (2026-07-27): 3 visible
    // inputs top-to-bottom — [0] password (already filled), [1] รหัสอ้างอิง,
    // [2] รหัส OTP (6 หลัก). getByLabel() was fragile here (this page's
    // labels are plain text, not real <label for=...> elements, so
    // getByLabel silently matches nothing) — index by real position instead.
    const allInputs = page.locator("input");
    const inputCount = await allInputs.count();
    console.log(`   พบ input ทั้งหมด ${inputCount} ช่องบนหน้านี้`);
    // Real finding live 2026-07-27: the "รหัสอ้างอิง" field (id="refCode")
    // is `disabled` and already pre-filled by the portal itself the moment
    // OTP is requested (its own value matched our extracted reference
    // exactly, W9eDnG) — nothing to fill, it's read-only display. Only
    // attempt to fill it if it's actually editable, instead of always
    // trying and eating a 30s timeout on a disabled field every run.
    if (reference && inputCount >= 2) {
      const refField = allInputs.nth(1);
      if (await refField.isEditable().catch(() => false)) {
        await refField.fill(reference).catch((e) => console.log("   กรอกรหัสอ้างอิงไม่สำเร็จ:", e.message));
      } else {
        console.log("   ช่องรหัสอ้างอิงถูกกรอกไว้แล้วโดยพอร์ทัลเอง (disabled) — ข้าม");
      }
    }
    if (inputCount >= 3) {
      await allInputs.nth(2).fill(otp);
    } else {
      await allInputs.last().fill(otp);
    }

    try {
      await page.getByRole("button", { name: /^ยืนยัน$/i }).first().click({ timeout: 15000 });
    } catch (err) {
      await page.screenshot({ path: path.join(process.cwd(), "debug-stuck-otp.png"), fullPage: true });
      writeFileSync(path.join(process.cwd(), "debug-stuck-otp.html"), await page.content());
      throw new Error(`กดปุ่ม "ยืนยัน" (OTP) ไม่ได้ — ดูภาพจริงที่ debug-stuck-otp.png: ${err.message}`);
    }

    console.log("5/6 รอหน้าเลือกเอกสาร แล้วกดดาวน์โหลด...");
    // Real gap found live 2026-07-27: after OTP confirm, the portal shows a
    // document SELECTION screen (checkboxes + a real download button) —
    // it never auto-downloads. Wait for that screen, select everything,
    // then click the real download trigger before listening for the
    // download event (previously waited for "download" with nothing ever
    // clicked to cause one, hence the 30s timeout).
    await page.waitForTimeout(2000); // real transition after OTP submit
    const selectAll = page.getByRole("checkbox").first().or(page.getByText(/เลือกทั้งหมด|select all/i));
    if (await selectAll.count() > 0) {
      await selectAll.first().click().catch(() => {});
    } else {
      const allCheckboxes = page.locator('input[type="checkbox"]');
      const n = await allCheckboxes.count();
      for (let i = 0; i < n; i++) await allCheckboxes.nth(i).check({ force: true }).catch(() => {});
    }

    let download;
    try {
      const downloadPromise = page.waitForEvent("download", { timeout: 20000 });
      await page.getByRole("button", { name: /ดาวน์โหลด|download/i }).first().click({ timeout: 15000 });
      download = await downloadPromise;
    } catch (err) {
      await page.screenshot({ path: path.join(process.cwd(), "debug-download.png"), fullPage: true });
      writeFileSync(path.join(process.cwd(), "debug-download.html"), await page.content());
      throw new Error(`กดดาวน์โหลดไม่สำเร็จ — ดูภาพจริงที่ debug-download.png: ${err.message}`);
    }
    const zipPath = path.join(downloadDir, "statement.zip");
    await download.saveAs(zipPath);
    console.log("   บันทึกไว้ที่:", zipPath);

    console.log("6/6 แตกไฟล์ + แกะข้อมูลจริง...");
    execSync(`unzip -o -P "${STATEMENT_PASSWORD}" "${zipPath}" -d "${downloadDir}"`, { stdio: "inherit" });
    const pdfFile = execSync(`find "${downloadDir}" -iname "*.pdf" | head -1`).toString().trim();
    if (!pdfFile) throw new Error("แตก zip แล้วไม่เจอไฟล์ PDF");

    // Real bug found live 2026-07-27: the PDF itself is STILL password-
    // protected after unzipping (the zip password and the PDF's own
    // encryption password happen to be the same value here, but they're
    // two separate protections) — pdftotext needs its own `-upw` (user
    // password) flag, it doesn't inherit anything from the unzip step.
    execSync(`pdftotext -upw "${STATEMENT_PASSWORD}" -layout -q "${pdfFile}" "${downloadDir}/statement.txt"`);
    const text = readFileSync(`${downloadDir}/statement.txt`, "utf-8");
    const transactions = parseStatementText(text);
    console.log(`   แกะได้ ${transactions.length} รายการจริง`);

    if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      let inserted = 0;
      for (const t of transactions) {
        const { error } = await supabase.from("bank_statement_transactions").upsert(t, {
          onConflict: "account_number,transaction_date,transaction_time,description,amount",
          ignoreDuplicates: true,
        });
        if (!error) inserted++;
      }
      console.log(`   บันทึกเข้า Supabase จริง ${inserted}/${transactions.length} รายการ`);
    } else {
      writeFileSync(path.join(process.cwd(), "last-statement-parse.json"), JSON.stringify(transactions, null, 2));
      console.log("   (ไม่มี SUPABASE_URL/SERVICE_KEY — บันทึกผลไว้ที่ last-statement-parse.json แทน)");
    }
  } finally {
    await browser.close();
  }
}

// Real K-Deposit Statement row format — verified live 2026-07-27 by running
// `pdftotext -layout` against the owner's actual decrypted May 2026
// statement (account 230-8-66630-4) and confirming 43/46 real transaction
// rows parsed correctly (the 3 non-matches are "ยอดยกมา"/"เปิดบัญชี"
// balance-carry-forward rows, correctly NOT transactions). Multi-line
// descriptions that wrap onto a second physical line get truncated at the
// first line — accepted as a known minor gap, since date+amount+kind is
// what reconciliation actually matches on, not the full description text.
function parseStatementText(text) {
  const lines = text.split("\n");
  const rows = [];
  const rowRe = /^\s*(\d{2}-\d{2}-\d{2})\s+(\d{2}:\d{2})?\s*(\S.*?)\s{2,}([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+(.+?)\s{2,}(.*)$/;
  const accountMatch = text.match(/(\d{3}-\d-\d{5}-\d)/);
  const accountNumber = accountMatch ? accountMatch[1] : null;
  for (const line of lines) {
    const m = line.match(rowRe);
    if (!m) continue
    const [, date, time, kind, amountStr, balanceStr, channel, description] = m
    rows.push({
      account_number: accountNumber,
      transaction_date: date,
      transaction_time: time ?? null,
      kind: kind.trim(),
      amount: Number(amountStr.replace(/,/g, "")),
      balance_after: Number(balanceStr.replace(/,/g, "")),
      channel: channel.trim(),
      description: description.trim(),
    })
  }
  return rows
}

run().catch((err) => {
  console.error("ล้มเหลว:", err.message)
  process.exit(1)
})

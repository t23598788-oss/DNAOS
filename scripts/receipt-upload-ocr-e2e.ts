/**
 * receipt-upload-ocr-e2e.ts — E2E: image upload → Apple Vision OCR →
 * normalized OCR payload → receipt_documents → relationship feed card.
 *
 * Reuses EXISTING sources only (no new OCR engine, no parallel DB write path,
 * no core policy/finance canonical writer touched):
 *   OCR    = plugins/platform/mac/window-executor.ts#ocr  (Apple Vision)
 *   upload = POST /api/admin/upload                        (attachments bucket)
 *   write  = POST /api/admin/receipt-documents → engines/canonical/inbound-write.ts
 *            #recordInboundSource                          (the ONE canonical writer)
 *   read   = GET /api/admin/relationships/[id] → app/admin/relationships/feed.ts
 *            #buildFeed → receipt.timeline-card           (existing renderer)
 *
 * Layers: L1 local fixture→OCR (no auth/DB) · L2 real upload→payload (session)
 * · L3 canonical write→feed card (session). Auth = the single email magic
 * link (/login → signInWithOtp → /auth/confirm); /api/auth/auto-login is
 * RETIRED410. L2/L3 stay BLOCKED until the Owner opens an emailed link
 * (scripted sessions intentionally no longer exist). Test data defaults to an
 * ISOLATED, labeled test company (override: TARGET_COMPANY_ID=<companies.id>).
 * No camera/print/Ollama/daemon/TCC/commit/push. Exit1 unless all3 pass.
 */
import { readFile, access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { ocr } from "../plugins/platform/mac/window-executor";
import { buildFeed } from "../app/admin/relationships/feed";

const execFileP = promisify(execFile);
const BASE = process.env.E2E_BASE_URL || "http://localhost:3100";
const ROOT = process.cwd();
const FIXTURE = join(ROOT, "tmp", "e2e-ocr", "fixture.png");
const MAGICK = "/opt/homebrew/bin/magick"; // PATH often misses /opt/homebrew/bin
const FONT = "/System/Library/Fonts/Helvetica.ttc";
const EXPECT = ["E2E TEST SHOP", "E2E-001", "150.00"];

let pass = 0;
let fail = 0;
let blocked = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function block(name: string, why: string): void {
  blocked += 1;
  console.log(`  BLOCKED  ${name} — ${why}`);
}

async function ensureFixture(): Promise<void> {
  try {
    await access(FIXTURE);
    return;
  } catch {
    /* generate below */
  }
  await execFileP(MAGICK, [
    "-size", "700x360", "xc:white",
    "-font", FONT, "-pointsize", "34", "-fill", "black",
    "-annotate", "+30+70", "E2E TEST SHOP  receipt E2E-001",
    "-annotate", "+30+150", "Total 150.00 THB",
    FIXTURE,
  ]);
}

// Minimal, deterministic field extraction from Vision's raw text. NOT an OCR
// engine (Vision already did the OCR) and NOT an AI classifier (none allowed
// this round). document_type is caller-decided (this fixture IS a receipt);
// amount is parsed only from a clear "Total/ยอดรวม <number>" pattern;
// confidence stays null because Vision returns no classifier confidence —
// never fabricated.
function normalizeOcrPayload(rawText: string, mediaPath: string, companyId: string) {
  const m = rawText.match(/(?:Total|ยอดรวม)\s*([0-9][0-9,]*\.?\d*)/i);
  const parsed = m ? parseFloat(m[1].replace(/,/g, "")) : NaN;
  return {
    channel: "upload",
    media_path: mediaPath,
    document_type: "receipt", // inert: NOT transfer_slip/payment_advice → never enters money flow
    raw_ocr_text: rawText.trim(),
    amount: Number.isFinite(parsed) ? parsed : null,
    customer_company_id: companyId,
    confidence: null,
  };
}

async function autoLogin(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/api/auth/auto-login`, { method: "POST" });
    if (!res.ok) return null;
    const h = res.headers as unknown as { getSetCookie?: () => string[] };
    const setCookies = typeof h.getSetCookie === "function" ? h.getSetCookie() : [];
    const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
    return cookie || null;
  } catch {
    return null;
  }
}

async function resolveTargetCompany(cookie: string): Promise<{ id: string; created: boolean }> {
  const envId = process.env.TARGET_COMPANY_ID;
  if (envId) return { id: envId, created: false };
  // ISOLATED test company via the EXISTING match route (synthetic LINE subject)
  // so the test never attaches data to a real customer.
  const synthetic = `e2e-ocr-test-${Date.now()}`;
  const res = await fetch(`${BASE}/api/admin/relationships/${synthetic}/match`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ newCompany: { name: `E2E OCR TEST ${Date.now()} (ลบได้)` } }),
  });
  const j = (await res.json()) as { ok?: boolean; companyId?: string; error?: string };
  if (!res.ok || !j.ok || !j.companyId) throw new Error(`create test company failed: ${JSON.stringify(j)}`);
  return { id: j.companyId, created: true };
}

async function uploadFixture(cookie: string): Promise<string> {
  const buf = await readFile(FIXTURE);
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array(buf)], "fixture.png", { type: "image/png" }));
  const res = await fetch(`${BASE}/api/admin/upload`, { method: "POST", headers: { Cookie: cookie }, body: fd });
  const j = (await res.json()) as { path?: string; error?: string };
  if (!res.ok || !j.path) throw new Error(`upload failed: ${JSON.stringify(j)}`);
  return j.path;
}

async function writeReceipt(cookie: string, payload: object): Promise<{ id: string; status: string }> {
  const res = await fetch(`${BASE}/api/admin/receipt-documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(payload),
  });
  const j = (await res.json()) as { receipt_document?: { id: string; status: string }; error?: string };
  if (!res.ok || !j.receipt_document) throw new Error(`receipt write failed: ${JSON.stringify(j)}`);
  return { id: j.receipt_document.id, status: j.receipt_document.status };
}

async function assertCardInFeed(cookie: string, companyId: string, receiptId: string) {
  const res = await fetch(`${BASE}/api/admin/relationships/${companyId}`, { headers: { Cookie: cookie } });
  const detail = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`relationship read failed: ${JSON.stringify(detail)}`);
  const receipts = (detail.receipts ?? []) as { id: string }[];
  const inReceipts = receipts.some((r) => r.id === receiptId);
  const feed = buildFeed(detail as never, []);
  const card = feed.find(
    (i) =>
      i.source_type === "receipt" &&
      "receipt" in i &&
      (i.receipt as { id?: string } | undefined)?.id === receiptId,
  );
  return {
    inReceipts,
    cardOk: Boolean(card) && card?.presentation_template === "receipt.timeline-card",
    feedCount: feed.length,
  };
}

async function main(): Promise<void> {
  const cleanup: string[] = [];
  console.log(`\n=== receipt-upload-ocr-e2e (base=${BASE}) ===`);

  // ── L1: fixture → real Vision OCR → text matches source ───────────────────
  console.log("\n[ L1 · local Vision OCR ]");
  await ensureFixture();
  const rawText = await ocr(FIXTURE);
  for (const e of EXPECT) check(`L1 OCR contains ${JSON.stringify(e)}`, rawText.includes(e));
  console.log(`  OCR_RAW: ${JSON.stringify(rawText)}`);

  // ── auth (gates L2/L3) ────────────────────────────────────────────────────
  const cookie = await autoLogin();
  if (!cookie) {
    block("L2 upload", "no session — single auth is now the emailed magic link (/login → /auth/confirm); auto-login is RETIRED410 by design. Owner opens the emailed link to establish a session.");
    block("L3 write+feed", "gated on the same admin session.");
    summary(cleanup);
    process.exit(1);
  }

  try {
    const target = await resolveTargetCompany(cookie);
    const companyId = target.id;
    if (target.created) cleanup.push(`company ${companyId} (E2E OCR TEST — delete after inspection)`);
    console.log(`\n  target company: ${companyId}${target.created ? " (isolated test company)" : " (TARGET_COMPANY_ID)"}`);

    // ── L2: upload via real route → normalized payload ──────────────────────
    console.log("\n[ L2 · real upload route → normalized OCR payload ]");
    const mediaPath = await uploadFixture(cookie);
    check("L2 upload returns a storage path", Boolean(mediaPath), mediaPath);
    const payload = normalizeOcrPayload(rawText, mediaPath, companyId);
    check("L2 payload.raw_ocr_text === OCR source", payload.raw_ocr_text === rawText.trim());
    check("L2 payload.amount parsed from text (=150)", payload.amount === 150, String(payload.amount));
    check("L2 payload.document_type=receipt (inert)", payload.document_type === "receipt");
    check("L2 payload.customer_company_id set", payload.customer_company_id === companyId);
    check("L2 payload.channel=upload", payload.channel === "upload");
    cleanup.push(`storage ${mediaPath} (delete via /api/admin/upload?path=)`);

    // ── L3: write via canonical route → card in feed ────────────────────────
    console.log("\n[ L3 · canonical write → relationship feed card ]");
    const { id: receiptId, status } = await writeReceipt(cookie, payload);
    cleanup.push(`receipt ${receiptId} (type=receipt, ai_read — delete after inspection)`);
    check("L3 canonical writer created receipt (status ai_read)", Boolean(receiptId) && status === "ai_read", `id=${receiptId} status=${status}`);
    const { inReceipts, cardOk, feedCount } = await assertCardInFeed(cookie, companyId, receiptId);
    check("L3 receipt present in relationship detail.receipts", inReceipts);
    check("L3 buildFeed renders receipt.timeline-card for it", cardOk, `feedItems=${feedCount}`);
  } catch (e) {
    fail += 1;
    console.log(`  FAIL  L2/L3 execution — ${e instanceof Error ? e.message : String(e)}`);
  }

  summary(cleanup);
  process.exit(fail > 0 || blocked > 0 ? 1 : 0);
}

function summary(cleanup: string[]): void {
  console.log(`\n=== RESULT: ${pass} PASS / ${fail} FAIL / ${blocked} BLOCKED ===`);
  if (cleanup.length) {
    console.log("\nTest artifacts to clean up in the DB (created via real routes):");
    for (const c of cleanup) console.log("  - " + c);
  }
}

main().catch((e) => {
  console.error("E2E_ERROR", e);
  process.exit(1);
});

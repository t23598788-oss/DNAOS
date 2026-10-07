/**
 * หน้าที่: turn one real billing email into one NormalizedExpense, using
 * only what the email actually says. The vendor is derived from the real
 * sender domain — this file holds no vendor allow-list, so a provider that
 * has never been seen before still normalizes, and adding a vendor needs no
 * code change here.
 * Input: an email record as `connections/email-alert-source` returns it.
 * Output: ExpenseExtraction.
 * Dependency ที่อนุญาต: ./types, node:crypto.
 * สิ่งที่ห้ามแตะ: ห้ามเดาจำนวนเงินหรือสกุลเงินที่อีเมลไม่ได้ระบุ — ทุกอย่าง
 * ที่หาไม่เจอต้องเป็น UNKNOWN พร้อมเหตุผลใน extraction_reasons เสมอ.
 */
import { createHash } from "node:crypto";
import { UNKNOWN, type ExpenseExtraction, type NormalizedExpense } from "./types";

export interface SourceEmail {
  readonly message_id: string;
  readonly thread_id?: string;
  readonly sender: string;
  readonly subject: string;
  readonly received_at: string;
  readonly body: string;
}

/** HTML/CSS noise is stripped before matching so a `font-size:14px` can never be read as an amount. */
function plainText(body: string): string {
  return body
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/\{[^{}]*\}/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CURRENCY_SYMBOL: ReadonlyArray<readonly [RegExp, string]> = [
  [/฿/, "THB"],
  [/\bTHB\b/i, "THB"],
  [/\bUSD\b/i, "USD"],
  [/\$/, "USD"],
  [/€/, "EUR"],
  [/\bEUR\b/i, "EUR"],
];

/** `฿1,750.00` -> `1750.00`. Returns null rather than a partial parse. */
function parseAmount(raw: string): string | null {
  const cleaned = raw.replace(/[^\d.,]/g, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return cleaned;
}

const AMOUNT_TOKEN = /(?:฿|\$|€|THB|USD|EUR)\s?([\d][\d,]*(?:\.\d{1,2})?)/gi;
/** A total is only a total when the email labels it one — otherwise the amount stays a plain "last stated amount". */
const TOTAL_LABEL = /(?:รวม|ยอดรวม|ยอดชำระ|Total|Amount\s+(?:due|charged|paid)|Grand\s+total)\s*[:：]?\s*(?:฿|\$|€|THB|USD|EUR)\s?([\d][\d,]*(?:\.\d{1,2})?)/i;
const VAT_LABEL = /(?:VAT|ภาษีมูลค่าเพิ่ม)[^฿$€\d]{0,20}(?:฿|\$|€|THB|USD|EUR)?\s?([\d][\d,]*(?:\.\d{1,2})?)/i;
const INVOICE_LABEL = /(?:invoice|receipt|order|เลขที่ใบสั่งซื้อ|หมายเลขคำสั่งซื้อ|ใบสั่งซื้อ)\s*(?:number|no\.?|id|#|เลขที่)?\s*[:#]?\s*([A-Z0-9][A-Z0-9._-]{5,})/i;

function providerFromSender(sender: string): string {
  const domain = sender.match(/@([A-Za-z0-9.-]+)/)?.[1]?.toLowerCase();
  if (!domain) return UNKNOWN;
  const parts = domain.split(".").filter((p) => p.length > 0);
  // drop the public suffix and any mail-subdomain prefix; "no-reply@mail.anthropic.com" -> "anthropic.com"
  const tail = parts.slice(-2).join(".");
  return tail.length > 0 ? tail : UNKNOWN;
}

function billingPeriodOf(text: string): string {
  if (/\/\s?(?:เดือน|month)\b/i.test(text) || /รายเดือน|monthly/i.test(text)) return "MONTHLY";
  if (/\/\s?(?:ปี|year)\b/i.test(text) || /รายปี|annual|yearly/i.test(text)) return "ANNUAL";
  return UNKNOWN;
}

function paymentStateOf(subject: string, text: string): string {
  if (/success|approved|confirmed|สำเร็จ|ชำระเงินแล้ว|paid/i.test(subject)) return "PAID";
  if (/ใบเสร็จ|receipt/i.test(subject)) return "PAID";
  if (/failed|declined|ล้มเหลว|unsuccessful/i.test(subject)) return "FAILED";
  if (/due|overdue|final notice|ค้างชำระ/i.test(subject) || /final notice/i.test(text)) return "DUE";
  return UNKNOWN;
}

export function extractExpense(email: SourceEmail, sourceQuery: string, ingestedAt: string): ExpenseExtraction {
  const text = plainText(email.body ?? "");
  if (text.length === 0) {
    return { ok: false, expense: null, skipped_reason: "EMPTY_BODY: the email carried no readable text to extract from" };
  }

  const reasons: string[] = [];

  let currency: string = UNKNOWN;
  for (const [pattern, code] of CURRENCY_SYMBOL) {
    if (pattern.test(text)) { currency = code; break; }
  }
  if (currency === UNKNOWN) reasons.push("currency: no currency symbol or ISO code appears in the email text");

  let amount: string = UNKNOWN;
  const labelled = text.match(TOTAL_LABEL);
  if (labelled?.[1]) {
    amount = parseAmount(labelled[1]) ?? UNKNOWN;
    if (amount === UNKNOWN) reasons.push(`amount: a labelled total "${labelled[1]}" did not parse as a number`);
  } else {
    const all = [...text.matchAll(AMOUNT_TOKEN)].map((m) => parseAmount(m[1] ?? "")).filter((v): v is string => v !== null);
    const distinct = [...new Set(all)];
    if (distinct.length === 1) {
      amount = distinct[0]!;
      reasons.push("amount: taken from the single stated amount — the email states no labelled total");
    } else if (distinct.length > 1) {
      reasons.push(`amount: the email states ${distinct.length} different amounts (${distinct.join(", ")}) and labels none of them a total`);
    } else {
      reasons.push("amount: no currency amount appears in the email text");
    }
  }

  const vat = text.match(VAT_LABEL);
  const tax_amount = vat?.[1] ? (parseAmount(vat[1]) ?? UNKNOWN) : UNKNOWN;
  if (tax_amount === UNKNOWN) reasons.push("tax_amount: the email states no VAT/tax line");

  const invoice = text.match(INVOICE_LABEL);
  const invoice_identity = invoice?.[1] ?? UNKNOWN;
  if (invoice_identity === UNKNOWN) reasons.push("invoice_identity: the email states no invoice/receipt/order number");

  // The description is the text immediately around the amount that was used —
  // never a summary this file invents.
  let description: string = UNKNOWN;
  if (amount !== UNKNOWN) {
    const idx = text.search(new RegExp(amount.replace(".", "\\.").replace(/^(\d+)/, "$1") + "|" + amount.replace(/(\d)(?=(\d{3})+\.)/g, "$1,")));
    if (idx > 0) description = text.slice(Math.max(0, idx - 120), idx).trim().slice(-120);
  }
  if (description === UNKNOWN || description.length === 0) {
    description = UNKNOWN;
    reasons.push("description: no service/item text was found next to the extracted amount");
  }

  const expense: NormalizedExpense = {
    expense_id: `expense-${createHash("sha256").update(`gmail:${email.message_id}`).digest("hex").slice(0, 32)}`,
    source_message_id: email.message_id,
    source_thread_id: email.thread_id ?? UNKNOWN,
    source_sender: email.sender,
    source_subject: email.subject,
    source_query: sourceQuery,
    provider: providerFromSender(email.sender),
    invoice_identity,
    billing_period: billingPeriodOf(text),
    charged_at: email.received_at,
    currency,
    amount,
    tax_amount,
    description,
    payment_state: paymentStateOf(email.subject ?? "", text),
    extraction_reasons: reasons,
    ingested_at: ingestedAt,
  };
  return { ok: true, expense, skipped_reason: null };
}

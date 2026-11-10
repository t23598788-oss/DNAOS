/**
 * DNA OS — A4 master renderer
 *
 * The company has exactly ONE document format: public/documents/dna-os-a4-master.html
 * (see presentation/assets/document-a4/style-spec.md). This module is the only
 * thing that puts real data into it — it fills the `data-field` slots that the
 * master already declares and nothing else.
 *
 * Rules enforced here:
 *   - never build HTML from scratch, never restyle the sheet: the master owns the look
 *   - never compute money: totals come from DocResult.summary (generateDoc)
 *   - an empty value leaves the master's own placeholder in place, so a draft
 *     preview stays readable instead of showing empty boxes
 */

import type { DocData } from "./types";
import type { DocResult } from "./engine";

/** ไฟล์เดียว ทั้ง preview และพิมพ์ ใช้ URL นี้ — ห้าม hardcode path อื่น */
export const A4_MASTER_URL = "/documents/dna-os-a4-master.html";

/**
 * ขนาดกล่องที่ต้องใช้แสดง .sheet ของแม่แบบทั้งหน้า:
 * A4 = 210 × 297 mm = 793.7 × 1122.5 px @96dpi, บวก margin 12px ของ .sheet ทั้งสองด้าน
 */
export const A4_PAGE = { width: 818, height: 1147 } as const;

export type A4Field =
  | "ISSUER_NAME" | "ISSUER_NAME_EN" | "ISSUER_TAX_ID" | "ISSUER_ADDRESS"
  | "DOCUMENT_TYPE" | "DOCUMENT_TYPE_EN" | "DOCUMENT_NUMBER" | "DOCUMENT_DATE"
  | "DOCUMENT_SUBJECT" | "DOCUMENT_SUBJECT_EN" | "DOCUMENT_NOTE"
  | "RECIPIENT_NAME" | "RECIPIENT_NAME_EN" | "RECIPIENT_TAX_ID" | "RECIPIENT_ADDRESS"
  | "TRANSACTION_DATE" | "DUE_DATE" | "TRANSACTION_CHANNEL" | "ORDER_REFERENCE"
  | "ITEM_ROWS"
  | "SUBTOTAL" | "VAT_RATE" | "VAT_AMOUNT" | "TOTAL_AMOUNT" | "AMOUNT_IN_WORDS"
  | "PAYMENT_TERMS" | "PAYMENT_STATUS" | "PAYMENT_REFERENCE" | "AUTHORIZED_SIGNATURE";

/** ค่าของช่อง: ข้อความล้วน หรือ HTML ที่ renderer สร้างเอง (เช่นตารางรายการ) */
export type A4Value = string | { html: string };
export type A4Values = Partial<Record<A4Field, A4Value>>;

/**
 * inline style ที่แม่แบบใช้ "แสดงช่องว่าง" (เส้นประ + สีเทา + ตัวเล็ก)
 * พอมีค่าจริงแล้วต้องถอดออก ไม่งั้นเอกสารที่เติมแล้วยังดูเป็นแบบฟอร์มเปล่า
 */
const PLACEHOLDER_DECLARATIONS = [
  /border-bottom:\s*\.?5pt\s+dashed\s*#c2c8c3;?/gi,
  /color:\s*#9aa19c;?/gi,
  /font-size:\s*7\.5pt;?/gi,
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** ข้อความหลายบรรทัด (เช่นรายการสินค้า) ใช้ <br> ภายในช่องเดิม ไม่แตะโครง */
function toFieldHtml(value: string): string {
  return value
    .split("\n")
    .map((line) => escapeHtml(line.trim()))
    .join("<br>");
}

function cleanedStyleAttr(styleAttr: string): string {
  let css = styleAttr;
  for (const pattern of PLACEHOLDER_DECLARATIONS) css = css.replace(pattern, "");
  css = css.replace(/;;+/g, ";").replace(/;\s*$/, "").trim();
  return css ? ` style="${css}"` : "";
}

/**
 * เติมค่าลงช่อง data-field ของแม่แบบ
 * - ค่าที่ไม่มี/ว่าง → คง placeholder ของแม่แบบไว้
 * - ค่าที่มี → แทนที่ข้อความในช่อง และถอด style แบบช่องว่างออก
 */
export function fillA4Master(masterHtml: string, values: A4Values): string {
  return masterHtml.replace(
    /<span data-field="([A-Z_0-9]+)"([^>]*)>(.*?)<\/span>/g,
    (match, field: string, attrs: string) => {
      const value = values[field as A4Field];
      if (value === undefined) return match;

      const styleMatch = attrs.match(/\sstyle="([^"]*)"/);
      const style = styleMatch ? cleanedStyleAttr(styleMatch[1]) : "";
      if (typeof value === "object") return `<span data-field="${field}"${style}>${value.html}</span>`;
      if (value.trim() === "") return match;
      return `<span data-field="${field}"${style}>${toFieldHtml(value)}</span>`;
    }
  );
}

function baht(amount: number): string {
  return amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function asDate(value?: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(parsed.getDate())}/${pad(parsed.getMonth() + 1)}/${parsed.getFullYear()}`;
}

function asDateTime(value?: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${asDate(value)} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

/**
 * จำนวนแถวต่อหนึ่งหน้า A4 — วัดจากแม่แบบจริง (ความสูงที่เหลือหลังหัวเอกสาร/คู่สัญญา
 * และที่ต้องเผื่อยอดรวม/บันทึก/ลายเซ็นไว้หน้าสุดท้าย)
 */
const ROWS_PER_PAGE = { normal: 10, compact: 8, tight: 10 } as const;

function densityFor(rowCount: number): keyof typeof ROWS_PER_PAGE {
  return rowCount > 8 ? "tight" : rowCount > 4 ? "compact" : "normal";
}

function densityClass(density: keyof typeof ROWS_PER_PAGE): string {
  return density === "normal" ? "" : ` class="${density}"`;
}

function itemsTable(rows: string[], density: keyof typeof ROWS_PER_PAGE = "normal"): string {
  return `<table${densityClass(density)}><tbody>${rows.join("")}</tbody></table>`;
}

/** ตัดส่วนท้าย (ยอดรวม/บันทึก/ลายเซ็น) ออก — อยู่เฉพาะหน้าสุดท้ายเท่านั้น */
function withoutClosingSections(html: string): string {
  return html
    .replace(/<section class="total">[\s\S]*?<\/section>/, "")
    .replace(/<section class="memo">[\s\S]*?<\/section>/, "")
    .replace(/<section class="signature">[\s\S]*?<\/section>/, "");
}

function withPageNumber(html: string, page: number, total: number): string {
  return html.replace(
    /<footer class="footer">/,
    `<footer class="footer"><span>หน้า ${page} / ${total}</span>`
  );
}

/**
 * ประกอบเอกสารทั้งฉบับจากแม่แบบเดียว
 * ถ้ารายการยาวเกินหนึ่งหน้า จะได้หลาย .sheet (แต่ละหน้าเป็น A4 เต็มหน้า)
 * — เนื้อหาจึงไม่ล้นออกนอกขอบกระดาษ และไม่มีข้อมูลหายเหมือนการตัดแถวทิ้ง
 */
export function renderA4Document(masterHtml: string, data: DocData, doc: DocResult): string {
  const values = a4ValuesFromDoc(data, doc);
  const items = data.items ?? [];

  if (items.length === 0) return fillA4Master(masterHtml, values);

  const density = densityFor(items.length);
  const perPage = ROWS_PER_PAGE[density];
  const rows = a4ItemRowHtml(items);
  const pages: string[][] = [];
  for (let index = 0; index < rows.length; index += perPage) {
    pages.push(rows.slice(index, index + perPage));
  }
  if (pages.length === 1) return fillA4Master(masterHtml, values);

  return pages
    .map((pageRows, index) => {
      const html = fillA4Master(masterHtml, {
        ...values,
        ITEM_ROWS: { html: itemsTable(pageRows, density) },
      });
      const isLast = index === pages.length - 1;
      return withPageNumber(isLast ? html : withoutClosingSections(html), index + 1, pages.length);
    })
    .join("\n");
}

/** จำนวนแผ่น A4 ในผลลัพธ์ — ใช้คำนวณความสูงของ preview */
export function countA4Sheets(html: string): number {
  return (html.match(/<main class="sheet">/g) ?? []).length || 1;
}

/** หนึ่งแถวรายการ = คำอธิบาย + จำนวน/ราคาต่อหน่วย + ยอดของแถวนั้น (ตารางเดียวกัน) */
export function a4ItemRowHtml(items: DocData["items"]): string[] {
  return items.map((item) => {
    const amount = baht(item.qty * item.unitPrice - (item.discount ?? 0));
    const meta = `${baht(item.qty)} ${item.unit || "หน่วย"} × ${baht(item.unitPrice)}`;
    const detail = item.detail ? `<small>${escapeHtml(item.detail)}</small>` : "";
    return `<tr><td class="desc">${escapeHtml(item.description)}<small>${meta}</small>${detail}</td>`
      + `<td class="amt">${amount}</td></tr>`;
  });
}

/**
 * แปลง DocData + ผลจาก generateDoc เป็นค่าของช่องในแม่แบบ
 * ตัวเลขทุกตัวมาจาก summary ของ engine เท่านั้น (ไม่คำนวณซ้ำที่นี่)
 */
export function a4ValuesFromDoc(data: DocData, doc: DocResult): A4Values {
  const summary = doc.summary;
  const items = data.items ?? [];
  const vatRate = data.precomputedSummary?.vatRate ?? data.vatRate ?? 0;

  const recipientContact = [data.customer?.address, data.customer?.phone]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" · ");

  const payment = data.paymentRequired ? data.payment : undefined;
  const paymentTerms = payment
    ? [payment.bank, payment.account, payment.accountName].filter(Boolean).join(" · ")
    : "";

  return {
    ISSUER_NAME: data.company?.name ?? "",
    ISSUER_TAX_ID: data.company?.taxId ?? "",
    DOCUMENT_TYPE: doc.label.th,
    DOCUMENT_TYPE_EN: doc.label.en,
    DOCUMENT_NUMBER: data.docNumber ?? "",
    DOCUMENT_DATE: asDateTime(data.date),
    DOCUMENT_SUBJECT: data.project ?? "",
    DOCUMENT_NOTE: data.notes ?? "",
    RECIPIENT_NAME: data.customer?.name ?? "",
    RECIPIENT_TAX_ID: data.customer?.taxId ?? "",
    RECIPIENT_ADDRESS: recipientContact,
    TRANSACTION_DATE: asDate(data.date),
    DUE_DATE: payment?.dueDate ?? data.debt?.defaultDate ?? "",
    TRANSACTION_CHANNEL: payment?.bank ?? "",
    ORDER_REFERENCE: data.reference ?? "",
    ITEM_ROWS: { html: itemsTable(a4ItemRowHtml(items), densityFor(items.length)) },
    SUBTOTAL: baht(summary.subtotal),
    // engine รับ vatRate เป็นเศษส่วน (0.07) แต่เอกสารแสดงเป็นเปอร์เซ็นต์
    VAT_RATE: vatRate > 0 ? String(Number((vatRate <= 1 ? vatRate * 100 : vatRate).toFixed(2))) : "",
    VAT_AMOUNT: baht(summary.vat),
    TOTAL_AMOUNT: baht(summary.total),
    PAYMENT_TERMS: paymentTerms,
    PAYMENT_STATUS: data.status ?? "",
    PAYMENT_REFERENCE: data.reference ?? "",
  };
}

/** แคชระดับโมดูล — โหลดแม่แบบครั้งเดียวต่อหน้า ไม่ใช่ทุกครั้งที่พิมพ์ */
let masterPromise: Promise<string> | null = null;

export function loadA4Master(): Promise<string> {
  if (!masterPromise) {
    masterPromise = fetch(A4_MASTER_URL, { cache: "force-cache" })
      .then((res) => {
        if (!res.ok) throw new Error(`โหลดแม่แบบเอกสารไม่สำเร็จ (${res.status})`);
        return res.text();
      })
      .catch((error) => {
        masterPromise = null;
        throw error;
      });
  }
  return masterPromise;
}

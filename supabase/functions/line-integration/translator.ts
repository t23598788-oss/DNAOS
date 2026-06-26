/**
 * AI Translation — Deno version (same logic as lib/v4-ai/translator.ts)
 * แปลภาษาไทย → Intent + Entity → JSON Command
 */

export type Intent =
  | "CREATE_ORDER" | "CHECK_PRICE" | "CHECK_DEBT" | "CHECK_DISTANCE"
  | "FIND_PARTNER" | "CREATE_DOCUMENT" | "OPEN_APP" | "SEND_MESSAGE"
  | "LIST_ITEMS" | "CHECK_STATUS" | "UNKNOWN";

export interface TranslationResult {
  ok: boolean;
  intent: Intent;
  entities: Record<string, unknown>;
  raw: string;
}

const patterns: { intent: Intent; re: RegExp[]; extract: (t: string) => Record<string, unknown> }[] = [
  { intent: "CREATE_ORDER", re: [/สั่ง/, /ต้องการ/, /ขอ.*(คิว|ตัน)/], extract: t => { const m=t.match(/(\d+)\s*(คิว|ตัน)/); return { product: extractProduct(t), quantity: m?Number(m[1]):undefined, unit: m?.[2] }; } },
  { intent: "CHECK_PRICE", re: [/ราคา/, /เท่าไหร่/, /คำนวณราคา/], extract: t => { const m=t.match(/(\d+)\s*(คิว|ตัน)/); return { product: extractProduct(t), quantity: m?Number(m[1]):undefined }; } },
  { intent: "CREATE_DOCUMENT", re: [/ออกใบ/, /สร้างใบ/, /ใบแจ้งหนี้/, /ใบเสนอราคา/, /ใบเสร็จ/], extract: t => ({ document_type: extractDocType(t) }) },
  { intent: "CHECK_DEBT", re: [/^หนี้/, /^ยอดค้าง/, /^ลูกหนี้/, /ค้างชำระ/], extract: t => ({ customer: t.replace(/หนี้|ยอดค้าง|ลูกหนี้|ค้างชำระ/g,"").trim() }) },
  { intent: "CHECK_DISTANCE", re: [/ระยะทาง/, /ไกลเท่าไหร่/], extract: t => { const p=t.split(/ไป|ถึง/); return { origin: p[0]?.trim(), destination: p[1]?.trim() }; } },
  { intent: "FIND_PARTNER", re: [/หาคู่ค้า/, /หาลูกค้า/], extract: t => ({ keyword: t.replace(/หาคู่ค้า|หาลูกค้า/g,"").trim() }) },
  { intent: "LIST_ITEMS", re: [/ทั้งหมด/, /รายการ/], extract: () => ({}) },
  { intent: "CHECK_STATUS", re: [/สถานะ/], extract: () => ({}) },
];

export function translate(text: string): TranslationResult {
  const t = text.trim().toLowerCase();
  for (const p of patterns) {
    if (p.re.some(r => r.test(t))) {
      return { ok: true, intent: p.intent, entities: p.extract(text), raw: text };
    }
  }
  return { ok: false, intent: "UNKNOWN", entities: {}, raw: text };
}

function extractProduct(t: string): string | undefined {
  for (const p of ["หินคลุก","ทรายหยาบ","ดินถม","ดินลูกรัง","หิน","ทราย","ดิน","ลูกรัง","คอนกรีต"]) if (t.includes(p)) return p;
  return undefined;
}

function extractDocType(t: string): string | undefined {
  if (t.includes("แจ้งหนี้")) return "invoice";
  if (t.includes("เสนอราคา")) return "quotation";
  if (t.includes("เสร็จ")) return "receipt";
  if (t.includes("ส่งของ")) return "delivery";
  return undefined;
}

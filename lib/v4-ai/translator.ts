/**
 * DNA OS AI Translation Layer
 *
 * แปลภาษาไทย → Intent + Entity → JSON Command
 * ไม่สร้างข้อมูล ไม่คำนวณ ไม่ตัดสินใจ — แปลอย่างเดียว
 *
 * "สั่งหิน 30 คิว" → { intent: "CREATE_ORDER", entities: { product: "หิน", quantity: 30, unit: "คิว" } }
 */

import { registerCommand } from "@/lib/runtime/engine";

// ── Types ──

export type Intent =
  | "CREATE_ORDER" | "CHECK_PRICE" | "CHECK_DEBT" | "CHECK_DISTANCE"
  | "FIND_PARTNER" | "FIND_MATERIAL" | "FIND_JOB"
  | "CREATE_DOCUMENT" | "OPEN_APP" | "SEND_MESSAGE"
  | "LIST_ITEMS" | "CHECK_STATUS" | "UNKNOWN";

export interface Entity {
  product?: string;
  quantity?: number;
  unit?: string;
  customer?: string;
  destination?: string;
  origin?: string;
  document_type?: string;
  app?: string;
  message?: string;
}

export interface TranslationResult {
  ok: boolean;
  intent: Intent;
  entities: Entity;
  confidence: number;
  raw: string;
  command?: { version: number; command: string; args: Record<string, unknown> };
}

// ── Intent Patterns ──

interface IntentPattern {
  intent: Intent;
  patterns: RegExp[];
  extract: (text: string) => Entity;
}

const intentPatterns: IntentPattern[] = [
  {
    intent: "CREATE_ORDER",
    patterns: [/สั่ง/, /ต้องการ/, /ขอ.*(คิว|ตัน|เที่ยว)/, /จอง/],
    extract: (t) => {
      const qty = t.match(/(\d+)\s*(คิว|ตัน|เที่ยว|ลูก)/);
      const product = extractProduct(t);
      return { product, quantity: qty ? Number(qty[1]) : undefined, unit: qty?.[2] };
    },
  },
  {
    intent: "CHECK_PRICE",
    patterns: [/ราคา/, /เท่าไหร่/, /คำนวณราคา/, /เสนอราคา/, /ถูกสุด/],
    extract: (t) => {
      const qty = t.match(/(\d+)\s*(คิว|ตัน)/);
      return { product: extractProduct(t), quantity: qty ? Number(qty[1]) : undefined, unit: qty?.[2] };
    },
  },
  {
    intent: "CREATE_DOCUMENT",
    patterns: [/ออกใบ/, /สร้างใบ/, /ออกเอกสาร/, /ใบแจ้งหนี้/, /ใบเสนอราคา/, /ใบเสร็จ/, /ใบส่งของ/],
    extract: (t) => ({ document_type: extractDocType(t), customer: extractName(t) }),
  },
  {
    intent: "CHECK_DEBT",
    patterns: [/^หนี้|^ยอดค้าง|^ลูกหนี้|ค้างชำระ|^ทวงหนี้/],
    extract: (t) => ({ customer: extractName(t) }),
  },
  {
    intent: "CHECK_DISTANCE",
    patterns: [/ระยะทาง/, /ไกลเท่าไหร่/, /กี่กิโล/, /เช็คระยะ/],
    extract: (t) => {
      const parts = t.split(/ไป|ถึง|จาก/);
      return { origin: parts[0]?.trim(), destination: parts[1]?.trim() };
    },
  },
  {
    intent: "FIND_PARTNER",
    patterns: [/หาคู่ค้า/, /หาลูกค้า/, /ค้นหาบริษัท/, /ใครเป็น/],
    extract: (t) => ({ customer: extractName(t) }),
  },
  {
    intent: "FIND_MATERIAL",
    patterns: [/หาวัสดุ/, /มีอะไรบ้าง/, /วัสดุ/, /สินค้า/],
    extract: (t) => ({ product: extractProduct(t) }),
  },
  {
    intent: "FIND_JOB",
    patterns: [/งาน/, /โครงการ/, /ส่งของ/],
    extract: (t) => ({ destination: extractName(t) }),
  },
  {
    intent: "OPEN_APP",
    patterns: [/เปิด/],
    extract: (t) => ({ app: extractApp(t) }),
  },
  {
    intent: "SEND_MESSAGE",
    patterns: [/ส่งข้อความ/, /ส่งไลน์/, /ตอบ/, /แจ้ง/],
    extract: (t) => {
      const parts = t.split(/ว่า|ข้อความ/);
      return { customer: parts[0]?.replace(/ส่ง(ข้อความ|ไลน์)\s*/, "").trim(), message: parts[1]?.trim() };
    },
  },
  {
    intent: "LIST_ITEMS",
    patterns: [/ทั้งหมด/, /รายการ/, /แสดง/, /ดู/],
    extract: () => ({}),
  },
  {
    intent: "CHECK_STATUS",
    patterns: [/สถานะ/, /ตอนนี้/, /เป็นไง/],
    extract: () => ({}),
  },
];

// ── Intent → Command Mapping ──

const intentToCommand: Record<Intent, string> = {
  CREATE_ORDER: "business.calculate_price",
  CHECK_PRICE: "business.calculate_price",
  CHECK_DEBT: "business.calculate_debt",
  CHECK_DISTANCE: "registry.get_module",
  FIND_PARTNER: "registry.get_module",
  FIND_MATERIAL: "registry.get_module",
  FIND_JOB: "registry.get_module",
  CREATE_DOCUMENT: "registry.get_module",
  OPEN_APP: "registry.get_driver",
  SEND_MESSAGE: "registry.get_driver",
  LIST_ITEMS: "registry.list_modules",
  CHECK_STATUS: "registry.load",
  UNKNOWN: "registry.load",
};

// ── Main Function ──

export function translate(text: string): TranslationResult {
  const t = text.trim().toLowerCase();

  for (const pattern of intentPatterns) {
    if (pattern.patterns.some((p) => p.test(t))) {
      const entities = pattern.extract(text);
      const command = intentToCommand[pattern.intent];

      return {
        ok: true,
        intent: pattern.intent,
        entities,
        confidence: 0.9,
        raw: text,
        command: { version: 1, command, args: entities as Record<string, unknown> },
      };
    }
  }

  return { ok: false, intent: "UNKNOWN", entities: {}, confidence: 0, raw: text };
}

// ── Extractors ──

function extractProduct(t: string): string | undefined {
  const products = ["หิน", "ทราย", "ดิน", "ลูกรัง", "คอนกรีต", "หินคลุก", "ทรายหยาบ", "ดินถม", "ดินลูกรัง"];
  for (const p of products) { if (t.includes(p)) return p; }
  return undefined;
}

function extractName(t: string): string | undefined {
  const cleaned = t.replace(/หา|คู่ค้า|ลูกค้า|ค้นหา|บริษัท|หนี้|ยอดค้าง|ลูกหนี้|ค้างชำระ|ทวงหนี้|ส่งข้อความ|ส่งไลน์|ออกใบ|สร้างใบ/g, "").trim();
  return cleaned || undefined;
}

function extractDocType(t: string): string | undefined {
  if (t.includes("แจ้งหนี้")) return "invoice";
  if (t.includes("เสนอราคา")) return "quotation";
  if (t.includes("เสร็จ") || t.includes("รับเงิน")) return "receipt";
  if (t.includes("ส่งของ")) return "delivery";
  if (t.includes("สั่งงาน")) return "workorder";
  if (t.includes("ทวงหนี้")) return "debt_notice";
  return undefined;
}

function extractApp(t: string): string | undefined {
  const apps: Record<string, string> = {
    "line": "LINE", "ไลน์": "LINE", "chrome": "Google Chrome", "โครม": "Google Chrome",
    "vscode": "VS Code", "terminal": "Terminal", "finder": "Finder",
    "mail": "Mail", "เมล": "Mail", "แผนที่": "Google Maps",
  };
  const tl = t.toLowerCase();
  for (const [key, val] of Object.entries(apps)) { if (tl.includes(key)) return val; }
  return undefined;
}

// ── Register into Runtime ──

export function registerTranslationCommands(): void {
  registerCommand("ai.translate", async (args) => translate(String(args.text ?? "")));
}

/**
 * DNA OS V4 — AI Bridge
 *
 * หน้าที่: แปลภาษาคน → JSON command
 * ไม่แตะ: business logic, rules, calculations, database
 *
 * ระบบหลังบ้านสั่ง AI ได้ แต่ AI สั่งระบบไม่ได้
 */

export interface BridgeCommand {
  action: string;
  mode: "preview" | "execute";
  payload: Record<string, unknown>;
}

export interface BridgeResult {
  ok: boolean;
  command?: BridgeCommand;
  raw: string;
  error?: string;
}

const TODAY = () => new Date().toISOString().split("T")[0];

interface Pattern {
  match: (t: string) => boolean;
  extract: (t: string) => BridgeCommand;
}

const patterns: Pattern[] = [
  // ---- DEBT FIND ----
  {
    match: (t) => /หา(ลูกหนี้|หนี้).+/.test(t),
    extract: (t) => {
      const name = t.replace(/หา(ลูกหนี้|หนี้)\s*/, "").trim();
      return { action: "debt.find", mode: "preview", payload: { name } };
    },
  },

  // ---- PARTNER FIND ----
  {
    match: (t) => /หา(คู่ค้า|ลูกค้า|partner).+/.test(t),
    extract: (t) => {
      const name = t.replace(/หา(คู่ค้า|ลูกค้า|partner)\s*/, "").trim();
      return { action: "partner.find", mode: "preview", payload: { name } };
    },
  },

  // ---- INVOICE FIND ----
  {
    match: (t) => /หา(ใบแจ้งหนี้|invoice|บิล).+/.test(t),
    extract: (t) => {
      const keyword = t.replace(/หา(ใบแจ้งหนี้|invoice|บิล)\s*/, "").trim();
      return { action: "invoice.find", mode: "preview", payload: { keyword } };
    },
  },

  // ---- PAY LIST (events) — ต้องอยู่ก่อน PAY เดี่ยว ----
  {
    match: (t) => /(อิเวนต์|event|รายการ).*(จ่าย|ชำระ|payment)/.test(t) || /หา.*(อิเวนต์|event).*(จ่าย|ชำระ)/.test(t),
    extract: (t) => {
      const hasToday = /วันนี้|today/.test(t);
      return { action: "pay.list", mode: "preview", payload: { date: hasToday ? TODAY() : undefined } };
    },
  },

  // ---- PAY ----
  {
    match: (t) => /จ่าย(บิล|หนี้|เงิน).+/.test(t),
    extract: (t) => {
      const idMatch = t.match(/(INV[- ]?\S+)/i);
      return { action: "pay.preview", mode: "preview", payload: { invoice_id: idMatch?.[1] ?? t.replace(/จ่าย(บิล|หนี้|เงิน)\s*/, "").trim() } };
    },
  },

  // ---- DEBT LIST / SUMMARY ----
  {
    match: (t) => /สรุป.*(ยอด|หนี้|ค้าง)/.test(t) || /(ยอด|หนี้).*(ค้าง|ทั้งหมด|สรุป)/.test(t),
    extract: () => ({ action: "debt.list", mode: "preview", payload: { status: "OPEN" } }),
  },
  {
    match: (t) => /ลูกหนี้|หนี้ค้าง|หนี้เปิด/.test(t),
    extract: () => ({ action: "debt.list", mode: "preview", payload: { status: "OPEN" } }),
  },
  {
    match: (t) => /หนี้ทั้งหมด/.test(t),
    extract: () => ({ action: "debt.list", mode: "preview", payload: {} }),
  },

  // ---- DRAFT ----
  {
    match: (t) => /อนุมัติ.*ร่าง|ร่าง.*อนุมัติ|draft/.test(t),
    extract: () => ({ action: "draft.list", mode: "preview", payload: {} }),
  },

  // ---- JOB ASSIGN ----
  {
    match: (t) => /สั่งงาน|มอบหมาย/.test(t),
    extract: (t) => {
      const jobMatch = t.match(/(?:job)[- ]?(\S+)/i);
      const driverMatch = t.match(/ให้\s*(\S+)/);
      return { action: "job.assign", mode: "preview", payload: { job_id: jobMatch?.[1] ?? "", driver: driverMatch?.[1] ?? "" } };
    },
  },

  // ---- JOB TRACK ----
  {
    match: (t) => /ติดตาม.*งาน|track.*job/i.test(t),
    extract: (t) => {
      const jobMatch = t.match(/(?:job|งาน)[- ]?(\S+)/i);
      return { action: "job.track", mode: "preview", payload: { job_id: jobMatch?.[1] ?? "" } };
    },
  },

  // ---- JOB LIST ----
  {
    match: (t) => /งานค้าง|งานกำลังส่ง/.test(t),
    extract: () => ({ action: "job.list", mode: "preview", payload: { status: "IN_PROGRESS" } }),
  },
  {
    match: (t) => /งานทั้งหมด|งาน/.test(t),
    extract: () => ({ action: "job.list", mode: "preview", payload: {} }),
  },

  // ---- DOCUMENT GET ----
  {
    match: (t) => /ดู(เอกสาร|บิล|ใบ).+/.test(t),
    extract: (t) => {
      const idMatch = t.match(/(INV|PO|DO|BQ|REC)[- ]?\S+/i);
      return { action: "doc.get", mode: "preview", payload: { id: idMatch?.[0] ?? t.replace(/ดู(เอกสาร|บิล|ใบ)\s*/, "").trim() } };
    },
  },

  // ---- DOCUMENT LIST ----
  {
    match: (t) => /ใบแจ้งหนี้/.test(t),
    extract: () => ({ action: "invoice.list", mode: "preview", payload: {} }),
  },
  {
    match: (t) => /ใบเสนอราคา|boq/i.test(t),
    extract: () => ({ action: "doc.list", mode: "preview", payload: { type: "boq" } }),
  },
  {
    match: (t) => /ใบสั่งซื้อ|po/i.test(t),
    extract: () => ({ action: "doc.list", mode: "preview", payload: { type: "purchase-order" } }),
  },
  {
    match: (t) => /ใบส่งของ|do/i.test(t),
    extract: () => ({ action: "doc.list", mode: "preview", payload: { type: "delivery-order" } }),
  },
  {
    match: (t) => /ใบเสร็จ|receipt/i.test(t),
    extract: () => ({ action: "doc.list", mode: "preview", payload: { type: "receipt" } }),
  },
  {
    match: (t) => /เอกสาร/.test(t),
    extract: () => ({ action: "doc.list", mode: "preview", payload: {} }),
  },

  // ---- PARTNER / MATERIAL ----
  {
    match: (t) => /คู่ค้า|partner/i.test(t),
    extract: () => ({ action: "partner.list", mode: "preview", payload: {} }),
  },
  {
    match: (t) => /วัสดุ|material/i.test(t),
    extract: () => ({ action: "material.list", mode: "preview", payload: {} }),
  },

  // ---- QUOTE ----
  {
    match: (t) => /คำนวณ.*ราคา|เสนอราคา|quote/i.test(t),
    extract: (t) => {
      const qtyMatch = t.match(/(\d+)\s*คิว/);
      const matMatch = t.match(/(ดินถม|ทราย\S*|ลูกรัง|หิน\S*)/);
      return {
        action: "quote.calc",
        mode: "preview",
        payload: {
          quantity: qtyMatch ? Number(qtyMatch[1]) : undefined,
          material: matMatch?.[1] ?? undefined,
        },
      };
    },
  },
];

export function translate(thai: string): BridgeResult {
  const t = thai.trim();
  if (!t) return { ok: false, raw: t, error: "ไม่มีข้อความ" };

  for (const p of patterns) {
    if (p.match(t)) {
      return { ok: true, raw: t, command: p.extract(t) };
    }
  }

  return { ok: false, raw: t, error: `ไม่เข้าใจคำสั่ง: "${t}"` };
}

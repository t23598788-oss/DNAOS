/**
 * The three command buckets the Conversational Command Surface is allowed
 * to know about. This file is the ONLY place that groups commands this way
 * — it is a UI-side classification, not a change to registry/command-registry.json.
 *
 * - EXECUTABLE_READ_COMMANDS: safe to call via /api/v1/query directly (or
 *   after entity resolution). Every key here must exist in /api/v1/spec's
 *   output (i.e. requires_confirmation:false, status != deprecated) — this
 *   is checked at runtime in intentRouter.ts, not assumed here.
 * - RECOGNITION_ONLY_WRITE_INTENTS: requires_confirmation:true commands.
 *   Used ONLY to recognize what the user meant and redirect them to the
 *   right /admin page. NEVER sent to /api/v1/query (which would reject
 *   them anyway — the dispatcher's own Rule 72 gate — but this surface
 *   doesn't even try).
 * - Everything else reachable via /api/v1/spec but not listed in
 *   EXECUTABLE_READ_COMMANDS is implicitly DEVELOPER_ONLY — computed at
 *   runtime as a set difference (see intentRouter.ts's developerOnlyCommands),
 *   not hand-maintained here, so it can't drift from the real spec.
 */

export type EntityType = "partner"

export interface ReadCommandEntry {
  /** First alias is the primary human label (used in previews/result headers). */
  aliases: string[]
  /** If set, this command needs an entity resolved first (see entityResolver.ts). */
  needsEntity?: { type: EntityType; argKey: string }
  /**
   * If set, this command's own required arg IS the free-text search term
   * (e.g. partner.find's "keyword") — not an entity to resolve to an ID, the
   * command itself returns the list. Ask for the term before calling.
   */
  needsKeyword?: { argKey: string; prompt: string }
}

export const EXECUTABLE_READ_COMMANDS: Record<string, ReadCommandEntry> = {
  "partner.list": { aliases: ["ดูลูกค้า", "ลูกค้าทั้งหมด", "รายชื่อลูกค้า", "ดูคู่ค้า"] },
  "partner.find": { aliases: ["ค้นหาลูกค้า", "หาลูกค้า"], needsKeyword: { argKey: "keyword", prompt: "ค้นหาลูกค้าชื่ออะไร? พิมพ์ชื่อหรือบางส่วนของชื่อ" } },
  "partner.profile": { aliases: ["ดูโปรไฟล์ลูกค้า", "ข้อมูลลูกค้า"], needsEntity: { type: "partner", argKey: "partner_id" } },

  "debt.list": { aliases: ["ดูหนี้ค้าง", "หนี้ค้างชำระ", "ลูกหนี้ค้าง"] },
  "debt.all": { aliases: ["ดูหนี้ทั้งหมด", "หนี้ทั้งหมดไม่กรอง"] },
  "debt.find": { aliases: ["ค้นหาหนี้", "หาหนี้"], needsKeyword: { argKey: "keyword", prompt: "ค้นหาหนี้ของใคร หรือคำว่าอะไร? พิมพ์คำค้น" } },
  "debt.trackings": { aliases: ["ประวัติติดตามหนี้", "ดูการติดตามหนี้"] },
  "debt.current": { aliases: ["หนี้ของลูกค้า", "ดูหนี้ลูกค้า"], needsEntity: { type: "partner", argKey: "partner_id" } },

  "invoice.list": { aliases: ["ดูใบแจ้งหนี้ทั้งหมด", "รายการใบแจ้งหนี้"] },
  "invoice.latest": { aliases: ["ใบแจ้งหนี้ล่าสุด"] },
  "invoice.find": { aliases: ["ค้นหาใบแจ้งหนี้"], needsKeyword: { argKey: "keyword", prompt: "ค้นหาใบแจ้งหนี้ด้วยคำว่าอะไร? พิมพ์คำค้น" } },

  "pay.list": { aliases: ["รายการรับชำระ", "ดูการชำระเงิน"] },
  "quote.calc": { aliases: ["คำนวณราคาวัสดุ", "ราคาวัสดุ"] },
  "material.list": { aliases: ["ดูรายการวัสดุ", "วัสดุทั้งหมด"] },
  "pit.find": { aliases: ["หาบ่อวัสดุ", "บ่อใกล้เคียง"], needsKeyword: { argKey: "keyword", prompt: "หาบ่อวัสดุด้วยคำว่าอะไร? พิมพ์คำค้น" } },

  "document.list": { aliases: ["ดูเอกสาร", "เอกสารทั้งหมด"] },
  "document.boq": { aliases: ["ดู boq", "รายการประมาณราคา"] },
  "document.do": { aliases: ["ดูใบส่งของ"] },
  "document.po": { aliases: ["ดูใบสั่งซื้อ"] },
  "document.receipt": { aliases: ["ดูใบเสร็จ"] },
  "draft.list": { aliases: ["ร่างเอกสารที่รอตรวจ", "ดูร่างเอกสาร"] },
  "doc.list": { aliases: ["เอกสารตามประเภท"] },
  "drive.open": { aliases: ["เปิดโฟลเดอร์เอกสาร"] },

  "job.list": { aliases: ["ดูงานทั้งหมด"] },
  "job.active": { aliases: ["ดูงานที่กำลังทำ", "งานที่กำลังดำเนินการ"] },

  "events.recent": { aliases: ["ดูเหตุการณ์ล่าสุด", "เหตุการณ์ล่าสุด"] },
  "computer.system.status": { aliases: ["ตรวจสถานะโปรแกรมบนเครื่อง", "สถานะโปรแกรม"] },
}

export interface WriteIntentEntry {
  aliases: string[]
  adminUrl: string
  adminLabel: string
}

// Best-guess admin page per write command, matched by folder name/purpose —
// not verified against each page's actual content beyond its route name.
// Flagged here rather than silently assumed correct.
export const RECOGNITION_ONLY_WRITE_INTENTS: Record<string, WriteIntentEntry> = {
  "debt.create": { aliases: ["สร้างหนี้ใหม่", "เพิ่มลูกหนี้", "บันทึกหนี้ใหม่"], adminUrl: "/admin/debt-tracking", adminLabel: "หน้าติดตามหนี้" },
  "invoice.create": { aliases: ["สร้างใบแจ้งหนี้", "ออกใบแจ้งหนี้"], adminUrl: "/admin/invoice", adminLabel: "หน้าใบแจ้งหนี้" },
  "document.create": { aliases: ["สร้างเอกสาร", "ออกเอกสารใหม่"], adminUrl: "/admin/create-document", adminLabel: "หน้าสร้างเอกสาร" },
  "job.assign": { aliases: ["มอบหมายงาน", "สั่งงานคนขับ"], adminUrl: "/admin/jobs", adminLabel: "หน้าจัดการงาน" },
  "payment": { aliases: ["บันทึกการชำระเงิน", "รับชำระหนี้", "จ่ายหนี้แล้ว"], adminUrl: "/admin/receipt", adminLabel: "หน้าใบเสร็จ" },
}

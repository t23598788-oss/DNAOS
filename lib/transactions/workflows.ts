/**
 * Transaction Workflow Registry
 *
 * แต่ละ tx_type มี workflow ของตัวเอง ประกอบด้วย steps ที่เรียงตามลำดับ
 * Component และ API อ่าน workflow จาก registry นี้ ไม่ hardcode ใน UI
 *
 * เพิ่ม workflow ใหม่ → เพิ่ม entry ใน WORKFLOWS เท่านั้น ไม่ต้องแก้ไฟล์อื่น
 */

// ---- Universal event names (ใช้ข้ามทุก workflow) ----

export type TxEvent =
  | "created"    // เปิดงาน
  | "confirmed"  // ยืนยันแล้ว
  | "started"    // เริ่มงาน/เริ่มบริการ
  | "delivered"  // ส่งของแล้ว
  | "completed"  // งานเสร็จ
  | "invoiced"   // ออกบิลแล้ว
  | "paid"       // รับเงินแล้ว
  | "closed";    // ปิดงาน

export type TxType =
  | "sale"       // งานขาย
  | "purchase"   // งานจัดซื้อ
  | "contract"   // งานรับจ้าง
  | "service"    // งานบริการ
  | "rental"     // งานเช่า
  | "transport"; // งานขนส่ง

// ---- Step = 1 ขั้นใน workflow ----

export interface WorkflowStep {
  event: TxEvent;        // state ที่ถึงเมื่อ action นี้สำเร็จ
  label: string;         // ชื่อแสดง state (e.g. "ส่งของแล้ว")
  action: string;        // action key ที่ส่งไปยัง /advance (e.g. "deliver")
  action_label: string;  // ข้อความปุ่ม (e.g. "ส่งของแล้ว")
  biz_event: string;     // business_events.event_type value
}

// ---- Expected document per workflow ----

export interface ExpectedDoc {
  doc_type: string;   // matches DocType in engine.ts
  label: string;      // short label เช่น "DO", "INV"
  required: boolean;  // ต้องมีก่อนปิดงาน
}

// ---- Workflow definition ----

export interface TxWorkflow {
  type: TxType;
  label: string;           // "งานขาย"
  label_en: string;        // "Sale"
  steps: WorkflowStep[];   // step[0] = created (initial), step[n-1] = closed
  expected_docs: ExpectedDoc[];
}

// ---- Registry ----

export const WORKFLOWS: Record<TxType, TxWorkflow> = {
  sale: {
    type: "sale",
    label: "งานขาย",
    label_en: "Sale",
    steps: [
      { event: "created",   label: "เปิดงาน",      action: "create",   action_label: "เปิดงาน",         biz_event: "quotation_sent" },
      { event: "confirmed", label: "ยืนยันแล้ว",   action: "confirm",  action_label: "ยืนยันคำสั่งซื้อ",  biz_event: "po_received" },
      { event: "delivered", label: "ส่งของแล้ว",   action: "deliver",  action_label: "ส่งของแล้ว",       biz_event: "delivery_made" },
      { event: "invoiced",  label: "ออกบิลแล้ว",   action: "invoice",  action_label: "ออกบิลแล้ว",       biz_event: "invoice_issued" },
      { event: "paid",      label: "รับเงินแล้ว",  action: "pay",      action_label: "รับเงินแล้ว",       biz_event: "payment_received" },
      { event: "closed",    label: "ปิดงาน",        action: "close",    action_label: "ปิดงาน",            biz_event: "closed" },
    ],
    expected_docs: [
      { doc_type: "quotation",      label: "QUO", required: false },
      { doc_type: "delivery_order", label: "DO",  required: true },
      { doc_type: "invoice",        label: "INV", required: true },
      { doc_type: "receipt",        label: "REC", required: true },
    ],
  },

  purchase: {
    type: "purchase",
    label: "งานจัดซื้อ",
    label_en: "Purchase",
    steps: [
      { event: "created",   label: "เปิด PO",      action: "create",   action_label: "เปิด PO",          biz_event: "quotation_sent" },
      { event: "confirmed", label: "อนุมัติแล้ว",  action: "confirm",  action_label: "อนุมัติ PO",        biz_event: "po_received" },
      { event: "delivered", label: "รับของแล้ว",   action: "deliver",  action_label: "รับของแล้ว",        biz_event: "delivery_made" },
      { event: "invoiced",  label: "ได้รับบิล",    action: "invoice",  action_label: "ได้รับใบแจ้งหนี้",   biz_event: "invoice_issued" },
      { event: "paid",      label: "จ่ายแล้ว",     action: "pay",      action_label: "จ่ายเงินแล้ว",       biz_event: "payment_received" },
      { event: "closed",    label: "ปิดงาน",        action: "close",    action_label: "ปิดงาน",            biz_event: "closed" },
    ],
    expected_docs: [
      { doc_type: "purchase_order",  label: "PO",  required: true },
      { doc_type: "delivery_order",  label: "GRN", required: true },
      { doc_type: "invoice",         label: "INV", required: true },
      { doc_type: "payment_voucher", label: "PV",  required: true },
    ],
  },

  contract: {
    type: "contract",
    label: "งานรับจ้าง",
    label_en: "Contract",
    steps: [
      { event: "created",   label: "เปิดงาน",      action: "create",   action_label: "เปิดงาน",       biz_event: "quotation_sent" },
      { event: "confirmed", label: "เซ็นสัญญา",   action: "confirm",  action_label: "เซ็นสัญญาแล้ว", biz_event: "po_received" },
      { event: "started",   label: "เริ่มงาน",     action: "start",    action_label: "เริ่มงานแล้ว",  biz_event: "work_started" },
      { event: "completed", label: "งานเสร็จ",     action: "complete", action_label: "งานเสร็จแล้ว",  biz_event: "work_completed" },
      { event: "invoiced",  label: "ออกบิลแล้ว",   action: "invoice",  action_label: "ออกบิลแล้ว",    biz_event: "invoice_issued" },
      { event: "paid",      label: "รับเงินแล้ว",  action: "pay",      action_label: "รับเงินแล้ว",    biz_event: "payment_received" },
      { event: "closed",    label: "ปิดงาน",        action: "close",    action_label: "ปิดงาน",         biz_event: "closed" },
    ],
    expected_docs: [
      { doc_type: "boq",     label: "BOQ", required: false },
      { doc_type: "invoice", label: "INV", required: true },
      { doc_type: "receipt", label: "REC", required: true },
    ],
  },

  service: {
    type: "service",
    label: "งานบริการ",
    label_en: "Service",
    steps: [
      { event: "created",   label: "เปิดงาน",      action: "create",   action_label: "เปิดงาน",      biz_event: "quotation_sent" },
      { event: "started",   label: "เริ่มบริการ",  action: "start",    action_label: "เริ่มบริการแล้ว", biz_event: "work_started" },
      { event: "completed", label: "บริการเสร็จ",  action: "complete", action_label: "บริการเสร็จแล้ว", biz_event: "work_completed" },
      { event: "invoiced",  label: "ออกบิลแล้ว",   action: "invoice",  action_label: "ออกบิลแล้ว",    biz_event: "invoice_issued" },
      { event: "paid",      label: "รับเงินแล้ว",  action: "pay",      action_label: "รับเงินแล้ว",    biz_event: "payment_received" },
      { event: "closed",    label: "ปิดงาน",        action: "close",    action_label: "ปิดงาน",         biz_event: "closed" },
    ],
    expected_docs: [
      { doc_type: "workorder", label: "WO",  required: false },
      { doc_type: "invoice",   label: "INV", required: true },
      { doc_type: "receipt",   label: "REC", required: true },
    ],
  },

  rental: {
    type: "rental",
    label: "งานเช่า",
    label_en: "Rental",
    steps: [
      { event: "created",   label: "เปิดสัญญา",   action: "create",   action_label: "เปิดสัญญาเช่า",  biz_event: "quotation_sent" },
      { event: "confirmed", label: "ยืนยันแล้ว",  action: "confirm",  action_label: "ยืนยันสัญญา",    biz_event: "po_received" },
      { event: "started",   label: "เริ่มเช่า",    action: "start",    action_label: "ส่งมอบแล้ว",     biz_event: "work_started" },
      { event: "completed", label: "คืนแล้ว",      action: "complete", action_label: "รับคืนแล้ว",     biz_event: "work_completed" },
      { event: "invoiced",  label: "ออกบิลแล้ว",  action: "invoice",  action_label: "ออกบิลแล้ว",     biz_event: "invoice_issued" },
      { event: "paid",      label: "รับเงินแล้ว",  action: "pay",      action_label: "รับเงินแล้ว",    biz_event: "payment_received" },
      { event: "closed",    label: "ปิดงาน",        action: "close",    action_label: "ปิดงาน",          biz_event: "closed" },
    ],
    expected_docs: [
      { doc_type: "invoice", label: "INV", required: true },
      { doc_type: "receipt", label: "REC", required: true },
    ],
  },

  transport: {
    type: "transport",
    label: "งานขนส่ง",
    label_en: "Transport",
    steps: [
      { event: "created",   label: "รับออเดอร์",   action: "create",   action_label: "รับออเดอร์",    biz_event: "quotation_sent" },
      { event: "confirmed", label: "ยืนยันแล้ว",   action: "confirm",  action_label: "ยืนยันงาน",      biz_event: "po_received" },
      { event: "started",   label: "กำลังขนส่ง",  action: "start",    action_label: "ออกรถแล้ว",      biz_event: "work_started" },
      { event: "delivered", label: "ส่งถึงแล้ว",   action: "deliver",  action_label: "ส่งถึงแล้ว",     biz_event: "delivery_made" },
      { event: "invoiced",  label: "ออกบิลแล้ว",  action: "invoice",  action_label: "ออกบิลแล้ว",     biz_event: "invoice_issued" },
      { event: "paid",      label: "รับเงินแล้ว",  action: "pay",      action_label: "รับเงินแล้ว",    biz_event: "payment_received" },
      { event: "closed",    label: "ปิดงาน",        action: "close",    action_label: "ปิดงาน",          biz_event: "closed" },
    ],
    expected_docs: [
      { doc_type: "delivery_order", label: "DO",  required: true },
      { doc_type: "invoice",        label: "INV", required: true },
      { doc_type: "receipt",        label: "REC", required: true },
    ],
  },
};

export const TX_TYPE_LABELS: Record<TxType, string> = Object.fromEntries(
  Object.entries(WORKFLOWS).map(([k, v]) => [k, v.label])
) as Record<TxType, string>;

export const TX_TYPE_ORDER: TxType[] = ["sale", "purchase", "contract", "service", "rental", "transport"];

// ---- Workflow query helpers ----

export function getWorkflow(txType: string): TxWorkflow {
  return WORKFLOWS[txType as TxType] ?? WORKFLOWS.sale;
}

export function getStepIndex(workflow: TxWorkflow, event: string): number {
  return workflow.steps.findIndex((s) => s.event === event);
}

/** step ถัดไปจาก current event — undefined ถ้าอยู่ขั้นสุดท้ายแล้ว */
export function getNextStep(workflow: TxWorkflow, currentEvent: string): WorkflowStep | undefined {
  const idx = getStepIndex(workflow, currentEvent);
  if (idx === -1 || idx >= workflow.steps.length - 1) return undefined;
  return workflow.steps[idx + 1];
}

export function isFinalEvent(workflow: TxWorkflow, event: string): boolean {
  return workflow.steps[workflow.steps.length - 1]?.event === event;
}

export function isPendingEvent(workflow: TxWorkflow, event: string): boolean {
  return !isFinalEvent(workflow, event);
}

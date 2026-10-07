/**
 * หน้าที่: schema กลางของค่าใช้จ่าย infrastructure — ใช้ได้กับทุก provider
 *
 * ตั้งใจไม่ผูกกับ Vercel: ทุก field เป็นคำกลาง (provider / service / resource /
 * usage) และตัวเลขเงินเก็บเป็น "หน่วยย่อยที่สุดของสกุลเงิน" (เซนต์) เป็น
 * จำนวนเต็มเสมอ เพราะการบวกลบเงินด้วย float คือการยอมให้ยอดเพี้ยนตั้งแต่ต้น
 *
 * รองรับ Railway / Supabase / Hostinger / DigitalOcean / GitHub / AI provider
 * ได้โดยไม่ต้องแก้ schema — connector เป็นคนแปลงเข้ามาที่รูปนี้
 *
 * Input: none (pure types).
 * Output: ทุก type ด้านล่าง
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่ม field ที่มีความหมายเฉพาะ provider เดียว และห้าม
 * เก็บเงินเป็น float — ทุกจำนวนเงินเป็น integer minor unit
 */

/** ผู้ให้บริการที่ระบบรู้จัก — เพิ่มได้ แต่ต้องมี connector รองรับ */
export type Provider =
  | "vercel" | "railway" | "supabase" | "hostinger"
  | "digitalocean" | "github" | "anthropic" | "openai" | "google"
  | "UNKNOWN";

/**
 * ค่าใช้จ่ายก้อนนี้คืออะไรกันแน่
 *   REQUIRED = จำเป็นต่อการทำงานของระบบ
 *   WASTED   = จ่ายอยู่แต่ไม่มีใครใช้ (ต้องมีหลักฐาน ไม่ใช่ความเห็น)
 *   ABNORMAL = โตผิดปกติเทียบกับ baseline
 *   UNKNOWN  = ยังแยกไม่ได้ว่าเป็นอะไร — ต้องมองเห็น ไม่ใช่ซุกไว้
 */
export type CostClassification = "REQUIRED" | "WASTED" | "ABNORMAL" | "UNKNOWN";

/** ที่มาของข้อมูล — บอกได้ว่าเชื่อถือได้แค่ไหนและตรวจซ้ำยังไง */
export type EvidenceChannel = "API" | "CLI" | "INVOICE" | "BILLING_EXPORT" | "EMAIL_RECEIPT" | "USAGE_ENDPOINT" | "DERIVED";

/**
 * หนึ่งบรรทัดของค่าใช้จ่าย
 *
 * `amount_minor` เป็นจำนวนเต็มของหน่วยย่อย (เซนต์) ติดลบได้เมื่อเป็นเครดิต
 * `derived` = true เมื่อยอดนี้ไม่ได้อ่านมาตรง ๆ แต่คำนวณจากส่วนต่าง — ต้อง
 * บอกเสมอ ไม่งั้นยอดที่เดาจะปนกับยอดที่พิสูจน์ได้
 */
export interface BillingRecord {
  readonly billing_record_id: string;
  readonly provider: Provider;
  readonly account_id: string;
  readonly project_id: string | null;
  readonly service: string;
  readonly resource: string | null;
  readonly usage_type: string;
  readonly usage_quantity: number | null;
  readonly usage_unit: string | null;
  /** ราคาต่อหน่วยเป็นหน่วยย่อย — null เมื่อเป็นค่าคงที่หรือไม่ทราบ */
  readonly unit_price_minor: number | null;
  readonly subtotal_minor: number;
  readonly discount_minor: number;
  readonly tax_minor: number;
  readonly amount_minor: number;
  readonly currency: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly observed_at: string;
  readonly invoice_id: string | null;
  readonly evidence_ref: string;
  readonly evidence_channel: EvidenceChannel;
  readonly classification: CostClassification;
  /** true = ยอดนี้ได้จากการคำนวณส่วนต่าง ไม่ใช่จากรายการที่อ่านได้ */
  readonly derived: boolean;
  readonly detail: string;
}

/** ผลรวมที่คำนวณแล้ว — ทุกตัวเป็น integer minor unit */
export interface CostSummary {
  readonly currency: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly current_period_minor: number;
  readonly today_minor: number;
  readonly daily_average_minor: number;
  readonly elapsed_days: number;
  readonly period_days: number;
  readonly estimated_end_of_period_minor: number;
  readonly by_provider: Readonly<Record<string, number>>;
  readonly by_project: Readonly<Record<string, number>>;
  readonly by_service: Readonly<Record<string, number>>;
  readonly by_resource: Readonly<Record<string, number>>;
  readonly by_classification: Readonly<Record<CostClassification, number>>;
  readonly record_count: number;
  readonly unresolved_count: number;
}

/** baseline จากรอบก่อน ๆ ที่จ่ายสำเร็จจริง */
export interface CostBaseline {
  readonly provider: Provider;
  readonly account_id: string;
  readonly currency: string;
  readonly samples: readonly { readonly period_start: string; readonly period_end: string; readonly total_minor: number; readonly evidence_ref: string }[];
  readonly normal_period_minor: number;
  readonly normal_daily_minor: number;
  readonly sample_count: number;
}

export interface AnomalyThresholds {
  /** เกินกี่เท่าของ baseline ต่อวันถึงถือว่าผิดปกติ */
  readonly daily_multiplier: number;
  /** เกินกี่เท่าของ baseline ต่อรอบถึงถือว่าผิดปกติ */
  readonly period_multiplier: number;
  /** ต้องมี baseline อย่างน้อยกี่รอบถึงจะตัดสิน */
  readonly min_samples: number;
}

export type BillingAnomalyType =
  | "BILLING_SPIKE" | "RESOURCE_COST_SPIKE" | "PAYMENT_FAILED"
  | "UNEXPECTED_PROJECT_USAGE" | "UPCOMING_PAYMENT" | "SUSPENSION_RISK";

export interface BillingAnomaly {
  readonly anomaly_id: string;
  readonly type: BillingAnomalyType;
  readonly provider: Provider;
  readonly account_id: string;
  readonly project_id: string | null;
  readonly resource: string | null;
  readonly observed_minor: number;
  readonly baseline_minor: number;
  readonly delta_minor: number;
  readonly delta_percent: number;
  readonly currency: string;
  readonly threshold_used: string;
  readonly first_seen_at: string;
  readonly evidence_refs: readonly string[];
  readonly owner_decision_required: boolean;
  readonly detail: string;
}

/** สายเลือดของต้นทุน — ย้อนกลับได้ทุกก้อน */
export interface CostLineage {
  readonly billing_record_id: string;
  readonly provider: Provider;
  readonly project_id: string | null;
  readonly service: string;
  readonly resource: string | null;
  readonly usage: string;
  readonly price: string;
  readonly cost: string;
  readonly invoice_id: string | null;
  /** ผูกกับ workload จริงได้หรือยัง — UNKNOWN เมื่อยังพิสูจน์ไม่ได้ */
  readonly work_id: string | null;
  readonly trace_id: string | null;
  readonly capability_id: string | null;
  readonly evidence_ref: string;
}

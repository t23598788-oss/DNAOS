/**
 * Data Gateway — ประตูเดียวสำหรับเขียน DB (Rule 71)
 *
 * ทุก write operation ต้องผ่านที่นี่เท่านั้น
 * Layer อื่น (V1-V5) ห้าม import @supabase/supabase-js โดยตรง
 *
 * Pattern: preview → token → execute
 * ไม่มี token = ไม่ execute (Rule 72: ต้อง confirmed จากมนุษย์)
 */

export {
  dispatchAction,
  previewPayment,
  executePayment,
  previewDocumentCreate,
  executeDocumentCreate,
  previewDebtCreate,
  executeDebtCreate,
  type ActionRequest,
  type ActionResponse,
} from "@/gateway/actions";

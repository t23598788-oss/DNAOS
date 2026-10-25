import { answerCompanyInfoQuestion } from "@/cognitive/pipeline"

/* eslint-disable @typescript-eslint/no-explicit-any */
const SK = "ctxfix-local-" + Date.now()
const t = async (label: string, msg: string) => {
  const r: any = await answerCompanyInfoQuestion(msg, { sessionKey: SK })
  console.log(label.padEnd(22), "→", r ? `pulse=${r.pulse_node.split(".").pop()} | ${r.text.slice(0, 60).replace(/\n/g, " ")}` : "null (ผ่านไป path อื่น)")
  return r
}
// A. full company search (regex path เดิม)
await t("A full-search", "เปิดข้อมูลบริษัท ช.ธวัชชัยการช่าง")
// B. bare name follow-up (exact match)
await t("B bare-name", "ช.ธวัชชัยการช่าง")
// C. spacing variants
await t("C1 space-dot", "ช. ธวัชชัยการช่าง")
await t("C2 space-middle", "ช.ธวัชชัย การช่าง")
// D. multiple matches (ไม่มี exact)
await t("D multi", "สถานีบริการน้ำมัน")
// E. unknown company
await t("E unknown", "วันสแตมป์คอนกรีต")
// F. ordinary non-company conversation
await t("F chat", "สวัสดีครับ เป็นอย่างไรบ้าง")
await t("F question", "วันนี้อากาศเป็นอย่างไร")
// (H) receipt commands ไม่ผ่าน answerCompanyInfoQuestion → null คงเดิม
await t("H receipt-cmd", "แสดงรายการรับเงินที่ยืนยันแล้ว")

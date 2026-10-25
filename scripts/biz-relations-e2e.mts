import { dispatch } from "@/engines/validation/dispatcher"
/* eslint-disable @typescript-eslint/no-explicit-any */
const rows: string[] = []
const t = async (id: string, q: string, cmd: string, payload: any, mustOk = true) => {
  const r: any = await dispatch(cmd, payload)
  const j = JSON.stringify(r.data ?? r.violations)
  rows.push(`${id}|${q}|${cmd}|${r.ok ? "OK" : "REJECT"}|${j.slice(0, 110)}`)
}
await t("A", "หาโรงงานคอนกรีตแถวขอนแก่น", "partner.find", { keyword: "คอนกรีต", in_address: "ขอนแก่น" })
await t("B", "ใครเคยซื้อทรายจากเรา", "purchase.history", { material: "ทราย" })
await t("C", "ใครขายหิน 3/4", "material.list", { name: "หิน3/4" })
await t("D", "วัสดุทั้งหมดในระบบ", "material.list", {})
await t("E", "หิน 3/8 แหล่งจำหน่าย", "material.list", { name: "3/8" })
await t("F", "ประวัติซื้อขายบริษัท", "purchase.history", { company: "ช.ธวัชชัย" })
await t("G", "เปิดใบแจ้งหนี้บริษัทนี้", "invoice.list", { company_name: "ช.ธวัชชัย" })
await t("H", "บริษัทไหนค้างเงิน", "debt.list", {})
await t("I", "ข้อมูล+สเปควัสดุ", "material.list", { name: "ทราย" })
await t("J", "แหล่งวัสดุตามพื้นที่", "material.sources", { lat: 16.8229, lng: 102.1807 })
console.log(rows.join("\n"))

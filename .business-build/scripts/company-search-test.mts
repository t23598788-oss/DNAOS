import { dispatch } from "@/engines/validation/dispatcher"

/* eslint-disable @typescript-eslint/no-explicit-any */
const find = async (kw: string) => {
  const r: any = await dispatch("partner.find", { keyword: kw })
  return { ok: r.ok, n: Array.isArray(r.data) ? r.data.length : "-", names: Array.isArray(r.data) ? r.data.slice(0, 2).map((x: any) => x.name) : r.violations }
}
console.log("exact        :", JSON.stringify(await find("ช.ธวัชชัยการช่าง")))
console.log("partial      :", JSON.stringify(await find("ธวัชชัย")))
console.log("space-dot    :", JSON.stringify(await find("ช. ธวัชชัยการช่าง")))
console.log("space-middle :", JSON.stringify(await find("ช.ธวัชชัย การช่าง")))
console.log("multi-space  :", JSON.stringify(await find("สถานีบริการน้ำมัน  บางจาก")))
console.log("none         :", JSON.stringify(await find("ไม่มีอยู่จริงxyz")))
const pf: any = await dispatch("partner.profile", { partner_id: "1191a3c2-e636-4916-8459-03fbe3cceab5" })
console.log("profile      :", pf.ok, pf.data?.name)
const tl: any = await dispatch("partner.timeline", { partner_id: "1191a3c2-e636-4916-8459-03fbe3cceab5" })
console.log("timeline     :", tl.ok, Array.isArray(tl.data?.timeline) ? tl.data.timeline.length + " events" : "-")

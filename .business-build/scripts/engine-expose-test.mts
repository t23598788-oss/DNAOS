import { dispatch } from "@/engines/validation/dispatcher"

/* eslint-disable @typescript-eslint/no-explicit-any */
const t = async (n: string, cmd: string, payload: any) => {
  const r: any = await dispatch(cmd, payload)
  const head = r.ok ? JSON.stringify(r.data).slice(0, 130) : "ERR: " + String(r.violations?.[0] ?? "").slice(0, 80)
  console.log(`${n} [${cmd}] →`, r.ok ? "OK" : "FAIL", "|", head)
}
await t("1 weather KK", "weather.forecast", { location: "ขอนแก่น", day_offset: 0 })
await t("2 weather ChiangMai+1", "weather.forecast", { location: "เชียงใหม่", day_offset: 1 })
await t("3 distance", "transport.estimate", { from_lat: 16.4322, from_lng: 102.8236, to_lat: 16.8229, to_lng: 102.1807 }) // ขอนแก่น→ชุมแพ
await t("4 time+fuel (same)", "transport.estimate", { from_lat: 16.4322, from_lng: 102.8236, to_lat: 16.8229, to_lng: 102.1807, trips: 2 })
await t("5 fuel.calc", "transport.estimate", { from_lat: 16.0, from_lng: 102.0, to_lat: 16.1, to_lng: 102.1 })
await t("6 bangchak prices", "fuel.prices", {})
await t("7 suppliers filter", "partner.find", { keyword: "สถานีบริการน้ำมัน", in_address: "ชุมแพ" })
await t("8 material sources", "material.sources", { lat: 16.8229, lng: 102.1807 })
await t("9 missing GPS", "material.sources", {})
await t("10 bad provider input", "weather.forecast", { location: "หมู่บ้านปลอมไม่มีจริงxyz123" })

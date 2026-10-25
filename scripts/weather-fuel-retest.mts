import { dispatch } from "@/engines/validation/dispatcher"

/* eslint-disable @typescript-eslint/no-explicit-any */
const t = async (n: string, cmd: string, payload: any) => {
  const r: any = await dispatch(cmd, payload)
  console.log(`${n} →`, r.ok ? "OK | " + JSON.stringify(r.data).slice(0, 90) : "ERR | " + String(r.violations?.[0] ?? "").slice(0, 70))
}
// STEP4: weather + fuel 6 กรณี
await t("W1 ขอนแก่น วันนี้", "weather.forecast", { location: "ขอนแก่น" })
await t("W2 เชียงใหม่ +1", "weather.forecast", { location: "เชียงใหม่", day_offset: 1 })
await t("W3 ชื่อปลอม", "weather.forecast", { location: "หมู่บ้านปลอมxyz" })
await t("W4 provider failure (coords มั่วสุดขั้ว)", "weather.forecast", { lat: 999, lng: 999 })
await t("F1 bangchak สด", "fuel.prices", {})
await t("F2 distance label", "transport.estimate", { from_lat: 16.43, from_lng: 102.82, to_lat: 16.82, to_lng: 102.18 })

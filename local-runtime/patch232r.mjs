// patch232r: registry + whitelist + worker projection — node (utf8 safe)
import { readFileSync, writeFileSync } from "node:fs"
const ROOT = "/Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck/"

// registry
const rp = ROOT + "registry/command-registry.json"
const r = JSON.parse(readFileSync(rp, "utf8"))
const cmds = r.commands || r
const add = (n, i, o, d) => { if (!cmds[n]) cmds[n] = { owner: "engines/validation/dispatcher.ts", layer: "engines", input: i, output: o, description: d + " — DNA-000232", requires_confirmation: false } }
add("weather.forecast", { location: "string?", lat: "number?", lng: "number?", day_offset: "number?" }, "{location,forecast}", "WeatherForecast — พยากรณ์อากาศ Open-Meteo (coords จาก geocoding provider เดิม)")
add("fuel.prices", {}, "{prices,effective_date}", "FuelPricesLive — ราคาเชื้อเพลิงสด Bangchak API")
add("transport.estimate", { from_lat: "number", from_lng: "number", to_lat: "number", to_lng: "number", trips: "number?" }, "{distance_km,duration,fuel}", "TransportEstimate — ระยะทาง/เวลา/น้ำมัน (read-only calc จาก engines เดิม)")
add("material.sources", { lat: "number", lng: "number", material_type_id: "string?" }, "{nearest}", "MaterialSources — แหล่งวัสดุใกล้พิกัด (findNearestPit + pit_profiles coords จริง)")
writeFileSync(rp, JSON.stringify(r, null, 2) + "\n")
console.log("registry ok:", "weather.forecast" in cmds)

// whitelist
const wp = ROOT + "app/api/v1/mcp/business/dispatch/route.ts"
let w = readFileSync(wp, "utf8")
if (!w.includes("weather.forecast")) {
  w = w.replace('"receipt.list", "receipt.latest", "receipt.get",', '"receipt.list", "receipt.latest", "receipt.get", "weather.forecast", "fuel.prices", "transport.estimate", "material.sources",')
  writeFileSync(wp, w)
}
console.log("whitelist ok:", readFileSync(wp, "utf8").includes("weather.forecast"))

// worker ALLOWED + PROJECTIONS
const wp2 = ROOT + "local-runtime/cline-worker/worker.mjs"
let w2 = readFileSync(wp2, "utf8")
if (!w2.includes("weather.forecast")) {
  w2 = w2.replace('"receipt.list", "receipt.latest", "receipt.get",', '"receipt.list", "receipt.latest", "receipt.get", "weather.forecast", "fuel.prices", "transport.estimate", "material.sources",')
  w2 = w2.replace("const KNOWN_GAPS =", `Object.assign(PROJECTIONS, {
  "weather.forecast": { desc: "พยากรณ์อากาศตามสถานที่/พิกัด (Open-Meteo)", in: ["location?", "lat?", "lng?", "day_offset?"], out: "forecast", filters: ["location|coords", "day_offset"], auth: "owner-session" },
  "fuel.prices": { desc: "ราคาเชื้อเพลิงสด (Bangchak)", in: [], out: "prices", filters: [], auth: "owner-session" },
  "transport.estimate": { desc: "ระยะทาง/เวลาเดินทาง/ค่าน้ำมันระหว่าง 2 พิกัด", in: ["from_lat", "from_lng", "to_lat", "to_lng", "trips?"], out: "estimate", filters: [], auth: "owner-session" },
  "material.sources": { desc: "แหล่งวัสดุใกล้พิกัดหน้างาน (ต้องมี lat/lng)", in: ["lat", "lng", "material_type_id?"], out: "nearest", filters: [], auth: "owner-session" },
});
const KNOWN_GAPS =`)
  w2 = w2.replace('const KNOWN_GAPS = ["สภาพอากาศนอกขอนแก่น", "พายุ/เส้นทาง", "ระยะทาง/เวลาเดินทาง (GPS route)", "ราคาตลาดน้ำมันวันนี้", "ตารางรถ/ความเป็นไปได้ในการส่งมอบ"];', 'const KNOWN_GAPS = ["พายุบนเส้นทางขนส่งแบบจับคู่เส้นทางจริง", "ตารางรถ/เวลาออก-ถึงจริงต่อคัน (SLA ส่งมอบ)", "ราคาตลาดน้ำมันที่ไม่ใช่แบรนด์ที่เชื่อมต่อ", "ค้นบริษัทหลายเงื่อนไขพร้อมกัน (type/พื้นที่) แบบ advanced"];')
  writeFileSync(wp2, w2)
}
console.log("worker ok:", readFileSync(wp2, "utf8").includes("PROJECTIONS_EXTRA") || readFileSync(wp2, "utf8").includes('"weather.forecast"'))

// Real Ground-Truth Layer, LINE side (owner, 2026-07-30): "รวบสมองเข้าด้วยกัน
// ไม่ต้องแยกสองสมอง...ให้เหตุการณ์มันเป็นเรื่องเดียวกัน" — a customer asking
// "ราคาน้ำมันวันนี้เท่าไหร่"/"อากาศเป็นไง"/"วันนี้วันที่เท่าไหร่" via LINE used
// to fall all the way to the local Ollama fallback (ai-task-watcher.mjs),
// which has no real data and would either refuse or guess — while the exact
// same question asked on the admin side (cognitive/pipeline.ts's
// answerExternalFact()) already gets a real, grounded answer.
//
// HARD CONSTRAINT (verified, not assumed): this Supabase Edge Function runs
// in Supabase's cloud; the admin app runs ONLY on the owner's own Mac
// (Tauri, localhost — no public URL exists, checked .env.local directly).
// The two sides genuinely cannot call each other over HTTP. The real fix
// achievable given that constraint: both sides independently call the SAME
// real external source of truth (Bangchak, Open-Meteo, the real system
// clock) — so the ANSWER is identical and grounded on both sides, even
// though the fetching code has to exist twice (same class of duplication
// this codebase already documents elsewhere — e.g. auto-build-event.ts's
// own header comment — for the same Deno-vs-Node runtime reason). Kept in
// sync by hand with engines/weather.ts, engines/fuel-live.ts,
// engines/bot-exchange-rate.ts (Next.js side) and cognitive/pipeline.ts's
// answerExternalFact() — same patterns, same real APIs, no cloud AI call.

const FUEL_PRICE_PATTERN = /(ราคา|ค่า|เท่าไหร่|เท่าไร|ดึง|ขอ|เอา).*(น้ำมัน|ดีเซล|เบนซิน|diesel)|(\bน้ำมัน|ดีเซล|เบนซิน\b).*(ราคา|ค่า|เท่าไหร่|เท่าไร)/i
const WEATHER_PATTERN = /สภาพอากาศ|อากาศ(วันนี้|เป็นไง|เป็นยังไง)|ฝน(ตก|ไหม|จะตก|หรือเปล่า)|จะมีฝน|พายุ|มีพายุ/
const TODAY_DATE_PATTERN = /วันนี้.*วันที่เท่าไหร่|วันที่เท่าไหร่.*วันนี้|^วันที่เท่าไหร่/i

const BANGCHAK_API = "https://oil-price.bangchak.co.th/ApiOilPrice2/en"
const KHON_KAEN = { latitude: 16.4322, longitude: 102.8236 }

const WEATHER_CODE_TH: Record<number, string> = {
  0: "ท้องฟ้าแจ่มใส", 1: "แจ่มใสเป็นส่วนใหญ่", 2: "มีเมฆบางส่วน", 3: "มีเมฆมาก",
  45: "หมอก", 48: "หมอกน้ำแข็ง",
  51: "ฝนละอองเบา", 53: "ฝนละอองปานกลาง", 55: "ฝนละอองหนัก",
  61: "ฝนตกเบา", 63: "ฝนตกปานกลาง", 65: "ฝนตกหนัก",
  80: "ฝนตกเป็นช่วงๆ เบา", 81: "ฝนตกเป็นช่วงๆ ปานกลาง", 82: "ฝนตกเป็นช่วงๆ หนัก",
  95: "พายุฝนฟ้าคะนอง", 96: "พายุฝนฟ้าคะนองมีลูกเห็บเบา", 99: "พายุฝนฟ้าคะนองมีลูกเห็บหนัก",
}

export function isExternalFactQuestion(text: string): boolean {
  return FUEL_PRICE_PATTERN.test(text) || WEATHER_PATTERN.test(text) || TODAY_DATE_PATTERN.test(text)
}

export async function answerExternalFact(text: string): Promise<string | null> {
  if (TODAY_DATE_PATTERN.test(text)) {
    const now = new Date()
    return `วันนี้วันที่ ${now.toLocaleDateString("th-TH", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} ครับ`
  }

  if (FUEL_PRICE_PATTERN.test(text)) {
    try {
      const res = await fetch(BANGCHAK_API)
      if (res.ok) {
        const payload = await res.json()
        const row = payload?.[0]
        const oilList: { OilName: string; PriceToday: number }[] = row?.OilList ? JSON.parse(row.OilList) : []
        const diesel = oilList.find((o) => o.OilName === "DIESEL B20")
        if (diesel) {
          return `ราคาน้ำมันดีเซล (B20) วันนี้อยู่ที่ ${Number(diesel.PriceToday).toLocaleString("th-TH")} บาท/ลิตรครับ (ข้อมูลจริง real-time จากบางจาก)`
        }
      }
    } catch {
      // honest failure — fall through to null, never fabricate a price
    }
    return null
  }

  if (WEATHER_PATTERN.test(text)) {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${KHON_KAEN.latitude}&longitude=${KHON_KAEN.longitude}` +
        `&current=temperature_2m,precipitation,weather_code&daily=precipitation_probability_max,precipitation_sum` +
        `&timezone=Asia%2FBangkok&forecast_days=1`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        const code = data?.current?.weather_code
        const temp = data?.current?.temperature_2m
        if (typeof code === "number" && typeof temp === "number") {
          const rainPct = data?.daily?.precipitation_probability_max?.[0]
          const rainLine = typeof rainPct === "number" ? ` โอกาสฝนตก ${rainPct}%` : ""
          return `สภาพอากาศ จ.ขอนแก่น ตอนนี้: ${WEATHER_CODE_TH[code] ?? "ไม่ทราบสภาพอากาศแน่ชัด"} อุณหภูมิ ${temp}°C${rainLine} ครับ (ข้อมูลจริงจาก Open-Meteo)`
        }
      }
    } catch {
      // honest failure — fall through to null, never fabricate a forecast
    }
    return null
  }

  return null
}

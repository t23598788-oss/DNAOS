// Real weather lookup (owner, 2026-07-30): "ทำให้ระบบมีความรู้เพิ่มขึ้น
// เชื่อมโยงสภาพแวดล้อมภายนอก ข่าวสารต่างๆ" — asked the secretary chat about
// rain in ขอนแก่น and got a flat "I can't check that in real time, try a
// weather website yourself" — same class of gap as the fuel-price question:
// a real, free, no-key data source exists (Open-Meteo,
// https://open-meteo.com — confirmed live via direct curl, 2026-07-30) but
// nothing in this codebase called it. Rain matters to this business
// specifically (ready-mix concrete delivery timing, aggregate site access),
// not just small talk — this is a real operational fact, not decoration.
//
// Scope: fixed to ขอนแก่น (the business's own location) since every other
// location-aware config in this codebase (fuel price, business hours) is
// already scoped to this one company, not multi-branch — no per-partner
// location lookup exists to key off instead.
//
// Real bug, owner-reported 2026-07-30: asked "พรุ่งนี้มีพายุไหม" (is there a
// storm TOMORROW) and got today's "ตอนนี้" (right now) conditions echoed
// back verbatim — the chat route matched the "พายุ" keyword but never
// looked at WHICH day the question was actually about, so a future-tense
// question always got answered with the present. Widened to accept a real
// day offset and read the matching entry in Open-Meteo's own `daily` array
// (which already covers up to several days ahead in one call) instead of
// only ever reading `current`.

const KHON_KAEN = { latitude: 16.4322, longitude: 102.8236 };

// WMO weather code -> Thai description (subset actually reachable in a
// Thai climate — no snow/ice codes, this business never sees them).
const WEATHER_CODE_TH: Record<number, string> = {
  0: "ท้องฟ้าแจ่มใส",
  1: "แจ่มใสเป็นส่วนใหญ่",
  2: "มีเมฆบางส่วน",
  3: "มีเมฆมาก",
  45: "หมอก",
  48: "หมอกน้ำแข็ง",
  51: "ฝนละอองเบา",
  53: "ฝนละอองปานกลาง",
  55: "ฝนละอองหนัก",
  61: "ฝนตกเบา",
  63: "ฝนตกปานกลาง",
  65: "ฝนตกหนัก",
  80: "ฝนตกเป็นช่วงๆ เบา",
  81: "ฝนตกเป็นช่วงๆ ปานกลาง",
  82: "ฝนตกเป็นช่วงๆ หนัก",
  95: "พายุฝนฟ้าคะนอง",
  96: "พายุฝนฟ้าคะนองมีลูกเห็บเบา",
  99: "พายุฝนฟ้าคะนองมีลูกเห็บหนัก",
};

export interface WeatherNow {
  temperatureC: number;
  conditionTh: string;
  rainNowMm: number;
  rainChanceTodayPct: number | null;
  rainTodayMm: number | null;
}

export interface WeatherDay {
  date: string;
  conditionTh: string;
  tempMaxC: number;
  tempMinC: number;
  rainChancePct: number | null;
  rainSumMm: number | null;
}

export async function getKhonKaenWeatherNow(): Promise<WeatherNow | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${KHON_KAEN.latitude}&longitude=${KHON_KAEN.longitude}` +
    `&current=temperature_2m,precipitation,weather_code&daily=precipitation_probability_max,precipitation_sum` +
    `&timezone=Asia%2FBangkok&forecast_days=1`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    const code = data?.current?.weather_code;
    if (typeof code !== "number" || typeof data?.current?.temperature_2m !== "number") return null;

    return {
      temperatureC: data.current.temperature_2m,
      conditionTh: WEATHER_CODE_TH[code] ?? "ไม่ทราบสภาพอากาศแน่ชัด",
      rainNowMm: Number(data.current.precipitation ?? 0),
      rainChanceTodayPct: typeof data?.daily?.precipitation_probability_max?.[0] === "number"
        ? data.daily.precipitation_probability_max[0]
        : null,
      rainTodayMm: typeof data?.daily?.precipitation_sum?.[0] === "number"
        ? data.daily.precipitation_sum[0]
        : null,
    };
  } catch {
    return null; // honest failure — never fabricate a weather reading
  }
}

// dayOffset: 0 = today, 1 = tomorrow, 2 = the day after — reads the matching
// index in Open-Meteo's own `daily` arrays (real forecast, not a guess
// derived from "now").
export async function getKhonKaenWeatherForDay(dayOffset: number): Promise<WeatherDay | null> {
  const days = Math.max(1, dayOffset + 1);
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${KHON_KAEN.latitude}&longitude=${KHON_KAEN.longitude}` +
    `&daily=weather_code,precipitation_probability_max,precipitation_sum,temperature_2m_max,temperature_2m_min` +
    `&timezone=Asia%2FBangkok&forecast_days=${days}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    const daily = data?.daily;
    const code = daily?.weather_code?.[dayOffset];
    const tempMax = daily?.temperature_2m_max?.[dayOffset];
    const tempMin = daily?.temperature_2m_min?.[dayOffset];
    if (typeof code !== "number" || typeof tempMax !== "number" || typeof tempMin !== "number") return null;

    return {
      date: daily.time?.[dayOffset] ?? "",
      conditionTh: WEATHER_CODE_TH[code] ?? "ไม่ทราบสภาพอากาศแน่ชัด",
      tempMaxC: tempMax,
      tempMinC: tempMin,
      rainChancePct: typeof daily?.precipitation_probability_max?.[dayOffset] === "number"
        ? daily.precipitation_probability_max[dayOffset]
        : null,
      rainSumMm: typeof daily?.precipitation_sum?.[dayOffset] === "number"
        ? daily.precipitation_sum[dayOffset]
        : null,
    };
  } catch {
    return null; // honest failure — never fabricate a forecast
  }
}

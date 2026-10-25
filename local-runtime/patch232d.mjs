// patch232d: dispatcher commands — node script (utf8 safe)
import { readFileSync, writeFileSync } from "node:fs"
const path = "/Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck/engines/validation/dispatcher.ts"
let s = readFileSync(path, "utf8")

// imports
if (!s.includes("geocodeOpenMeteo")) {
  s = s.replace(
    'import { supabaseAdmin } from "@/services/supabase/queries";',
    `import { supabaseAdmin } from "@/services/supabase/queries";
import { getWeatherForecast, geocodeOpenMeteo } from "@/engines/weather";
import { calcFuel } from "@/engines/fuel";
import { getAllBangchakFuelPrices } from "@/engines/fuel-live";
import { calcDistance } from "@/engines/distance";
import { calcTime } from "@/engines/time";`,
  )
}

if (!s.includes('"weather.forecast"')) {
  const anchor = '"bank.statement":   async () => {'
  const block = `// ── DNA-000232: expose engines ที่มีอยู่แล้วเป็นคำสั่งอ่าน (audit DNA-000231) ──
  "weather.forecast": async (p) => {
    // location name → coords ผ่าน Open-Meteo geocoding (provider เดิม) — ห้ามแต่ง coords
    let lat = Number(p.lat), lng = Number(p.lng), label = null;
    const place = String(p.location ?? "").trim();
    if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && place) {
      const g = await geocodeOpenMeteo(place);
      if (g) { lat = g.lat; lng = g.lng; label = g.label; }
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("ต้องระบุ location (ชื่อสถานที่) หรือ lat/lng ที่ถูกต้อง");
    const dayOffset = Number(p.day_offset ?? 0);
    const f = await getWeatherForecast(lat, lng, dayOffset);
    if (!f) throw new Error("DATA_QUERY_FAILED: ไม่สามารถดึงพยากรณ์อากาศจากผู้ให้บริการได้ (ตรวจสอบพื้นที่/เวลาอีกครั้ง)");
    return { location: label ?? \`\${lat},\${lng}\`, lat, lng, day_offset: dayOffset, forecast: f };
  },
  "fuel.prices":     async () => {
    const r = await getAllBangchakFuelPrices();
    if (!r) throw new Error("DATA_QUERY_FAILED: ไม่สามารถดึงราคาเชื้อเพลิงสดจากผู้ให้บริการได้");
    return { source: "bangchak-oil-price-api", effective_date: r.effectiveDate, prices: r.prices };
  },
  "transport.estimate": async (p) => {
    const fromLat = Number(p.from_lat), fromLng = Number(p.from_lng), toLat = Number(p.to_lat), toLng = Number(p.to_lng);
    if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite)) throw new Error("ต้องระบุ from_lat, from_lng, to_lat, to_lng");
    const dist = await calcDistance({ from_lat: fromLat, from_lng: fromLng, to_lat: toLat, to_lng: toLng });
    const trips = Math.max(1, Number(p.trips ?? 1));
    const time = await calcTime({ distance_km: dist.distance_km, trips });
    const fuel = await calcFuel({ distance_km: dist.distance_km, trips });
    return { distance_km: dist.distance_km, duration: time, fuel, trips, note: "ประมาณการจาก haversine + อัตราเร็ว/น้ำมันจาก config ระบบ" };
  },
  "material.sources": async (p) => {
    const lat = Number(p.lat), lng = Number(p.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("ต้องระบุ lat/lng ของหน้างาน");
    const nearest = await findNearestPit(lat, lng, p.material_type_id ? String(p.material_type_id) : undefined);
    if (!nearest) throw new Error("ไม่พบแหล่งวัสดุที่ระบุพิกัดได้");
    return nearest;
  },
  "bank.statement":   async () => {`
  if (!s.includes(anchor)) throw new Error("anchor missing")
  s = s.replace(anchor, block)
}

// partner.find filters (type/in_address) — canonical reader เดิม
const oldFind = `const keyword = String(p.keyword ?? "").trim().toLowerCase();
    if (!keyword) return [];
    // DNA-000228: normalize ช่องว่างตอนเทียบ (production bug พิสูจน์แล้ว:
    // "ช. ธวัชชัยการช่าง" คืน 0 รายทั้งที่ "ช.ธวัชชัยการช่าง" มีอยู่จริง) —
    // whitespace-insensitive matching ของ reader เดิม ไม่แตะ getPartners()
    const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/\\s+/g, "");
    const kw = norm(keyword);
    const partners = await getPartners();
    return partners.filter((x) => norm(x.name).includes(kw));`
const newFind = `const keyword = String(p.keyword ?? "").trim().toLowerCase();
    // DNA-000232: filters อ่านอย่างเดียวเพิ่มจาก reader เดิม (type, in_address) —
    // ไม่สร้าง reader ใหม่
    const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/\\s+/g, "");
    const kw = norm(keyword);
    const typeF = String(p.type ?? "").trim().toLowerCase();
    const addrF = norm(String(p.in_address ?? "").trim());
    if (!keyword && !typeF && !addrF) return [];
    const partners = await getPartners();
    return partners.filter((x) => {
      const nm = norm(x.name);
      const ad = norm((x as any).address);
      const okKw = keyword ? nm.includes(kw) : true;
      const okType = typeF ? norm((x as any).type).includes(typeF) : true;
      const okAddr = addrF ? ad.includes(addrF) : true;
      return okKw && okType && okAddr;
    });`
if (s.includes(oldFind)) {
  s = s.replace(oldFind, newFind)
  writeFileSync(path, s)
  console.log("dispatcher: 5 engine commands + partner.find filters added")
} else {
  writeFileSync(path, s)
  console.log("dispatcher: engine commands added (find-filter marker mismatch — ตรวจ manual)")
}

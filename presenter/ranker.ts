import type { EnrichedRecord } from "./enricher";

export type RankPolicy = "distance" | "price_asc" | "price_desc" | "name" | "material_match";

export interface RankContext {
  policy: RankPolicy;
  filter_material?: string;
  explain: string;
}

export function detectRankContext(question: string): RankContext {
  const q = question.toLowerCase();

  if (/ราคาถูก|ราคาต่ำ|ราคาน้อย|ถูกสุด|ถูกที่สุด/.test(q)) {
    return { policy: "price_asc", explain: "เรียงจากราคาถูกที่สุด" };
  }

  if (/ราคาสูง|ราคาแพง|แพงสุด/.test(q)) {
    return { policy: "price_desc", explain: "เรียงจากราคาสูงที่สุด" };
  }

  // กรองวัสดุเฉพาะ
  const matMatch = q.match(/(หิน\s*3\/4|หิน\s*3\/2|หินเกล็ด|หินคลุก|ดินถม|ทรายหยาบ|ทรายละเอียด|ลูกรัง)/);
  if (matMatch) {
    const mat = matMatch[1].replace(/\s+/g, "");
    return { policy: "material_match", filter_material: mat, explain: `กรองเฉพาะที่มี "${matMatch[1]}"` };
  }

  if (/เร็ว|ใกล้|ใกล้สุด|ใกล้ที่สุด|สะดวก/.test(q)) {
    return { policy: "distance", explain: "เรียงจากใกล้สุด" };
  }

  if (/ชื่อ|ก-ฮ|เรียงตามชื่อ/.test(q)) {
    return { policy: "name", explain: "เรียงตามชื่อ" };
  }

  // default = ระยะทาง
  return { policy: "distance", explain: "เรียงจากใกล้สุด (ค่าเริ่มต้น)" };
}

export function rankResults(records: EnrichedRecord[], ctx: RankContext): EnrichedRecord[] {
  let filtered = [...records];

  // กรองวัสดุ
  if (ctx.policy === "material_match" && ctx.filter_material) {
    const mat = ctx.filter_material;
    filtered = filtered.filter((r) =>
      r.materials?.some((m) => m.replace(/\s+/g, "").includes(mat)) ?? false
    );
  }

  // เรียงลำดับ
  switch (ctx.policy) {
    case "distance":
      filtered.sort((a, b) => (a.distance_km ?? 999) - (b.distance_km ?? 999));
      break;
    case "price_asc":
      filtered.sort((a, b) => {
        const aMin = Math.min(...Object.values(a.prices ?? { x: 999999 }));
        const bMin = Math.min(...Object.values(b.prices ?? { x: 999999 }));
        return aMin - bMin;
      });
      break;
    case "price_desc":
      filtered.sort((a, b) => {
        const aMax = Math.max(...Object.values(a.prices ?? { x: 0 }));
        const bMax = Math.max(...Object.values(b.prices ?? { x: 0 }));
        return bMax - aMax;
      });
      break;
    case "name":
      filtered.sort((a, b) => a.name.localeCompare(b.name, "th"));
      break;
    case "material_match":
      filtered.sort((a, b) => (a.distance_km ?? 999) - (b.distance_km ?? 999));
      break;
  }

  return filtered;
}

// Real engineering reference (owner, 2026-07-26, citing standard
// construction-industry density ranges — ASTM/highway-department style
// figures, not a guess): คิว (m³, volume) and ตัน (weight from a real
// scale) are only convertible through a material's own density —
// น้ำหนัก(ตัน) = ปริมาตร(คิว) × ความหนาแน่น(ตัน/คิว). Never hardcode a
// single conversion factor across all materials — always look up
// material_types.density_ton_per_cbm for the specific material involved.
//
// Reference table the owner supplied, for context on what a real value
// should look like (already populated into density_ton_per_cbm for the 11
// real materials in this system, migration 20260726000002):
//   เหล็ก (steel)              7.85 ton/m³ — dense metal, no voids
//   คอนกรีตสด (ready-mix)      2.40 ton/m³ — compacted, no air gaps
//   หินคลุก (crushed rock)     1.65–1.75 ton/m³ — graded fines fill voids
//   ทรายละเอียด (fine sand)    1.45–1.55 ton/m³
//   ทรายหยาบ (coarse sand)     1.40–1.50 ton/m³
//   หิน 3/4, 3/2 ฯลฯ (graded)  1.40–1.45 ton/m³ — uniform size, more air gaps
//   ดินถม/ลูกรัง (fill soil)   1.20–1.40 ton/m³ — depends on compaction
//   อิฐมอญแดง (brick, loose)   0.90–1.10 ton/m³ — porous + stacking gaps
//   อิฐมวลเบา (AAC block)      0.55–0.70 ton/m³ — internal air bubbles, floats

export function cbmToTon(cbm: number, densityTonPerCbm: number): number {
  return cbm * densityTonPerCbm
}

export function tonToCbm(ton: number, densityTonPerCbm: number): number {
  return ton / densityTonPerCbm
}

// Sanity check (owner instruction: "ถ้าผู้ใช้กรอก density ของทราย = 7.8
// หรือเหล็ก = 1.2 ระบบต้องร้องเตือนทันที") — water is 1.0 ton/m³; nothing
// sold as loose/granular construction fill is lighter than water (it would
// float), and nothing short of solid metal reaches steel's ~7.85. This is a
// physical plausibility check, not a business rule — real AAC blocks can
// be genuinely under 1.0, so this only catches values clearly out of any
// real material's range, not a strict business validation.
export function validateDensity(materialName: string, densityTonPerCbm: number): string | null {
  if (densityTonPerCbm <= 0) return `ความหนาแน่นของ "${materialName}" ต้องมากกว่า 0`
  if (densityTonPerCbm > 8) return `ความหนาแน่นของ "${materialName}" (${densityTonPerCbm} ตัน/คิว) สูงผิดปกติ — หนักกว่าเหล็กแท้ (~7.85 ตัน/คิว) ซึ่งเป็นไปไม่ได้จริง`
  if (densityTonPerCbm < 0.3) return `ความหนาแน่นของ "${materialName}" (${densityTonPerCbm} ตัน/คิว) ต่ำผิดปกติ — ไม่มีวัสดุก่อสร้างชนิดใดเบาขนาดนี้`
  return null
}

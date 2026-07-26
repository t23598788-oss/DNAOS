-- Real physics (owner, 2026-07-26): "คิวใช้กับความกว้างxยาวxสูง จะได้ปริมาตร
-- ตันคือขึ้นตาชั่งจริง" — คิว (volume, m³) and ตัน (weight, from a real
-- scale) are only convertible via each material's real density, which
-- differs per material (sand vs crushed rock vs laterite). Nullable on
-- purpose — never guess a density and silently get quotes wrong (same
-- lesson as the หินคลุก unit-mismatch incident, 2026-07-25/26). Filled in
-- by the owner per material as real figures become available.
alter table public.material_types
  add column if not exists density_ton_per_cbm numeric;

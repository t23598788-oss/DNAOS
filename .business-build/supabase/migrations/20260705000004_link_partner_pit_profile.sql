-- Link partners → pit_profiles: ตัวตนถาวรที่ไม่ขึ้นกับชื่อ LINE
--
-- ก่อนหน้านี้ partners (ใช้ออกเอกสาร/invoice) กับ pit_profiles (ใช้จับคู่ LINE bot)
-- เป็นคนละ record แยกกันโดยไม่มี link แม้จะเป็นบุคคลเดียวกัน — ถ้า LINE display name
-- เปลี่ยน ระบบจะหาไม่เจอว่า user คนนี้คือ partner คนไหนในระบบเอกสาร

-- Local-migration bootstrap fix (owner, 2026-07-30, KM-007 —
-- registry/existence.json known_mistakes): both public.partners
-- (20260709000003) and public.pit_profiles (20260710000008) are created
-- AFTER this file's July 5 timestamp — guarded so a fresh local bootstrap
-- doesn't fail here; reapplied in
-- 20260710000011_geom_columns_bootstrap_fix.sql once both exist. No-op in
-- production (both already exist there, this real row-level fix already
-- ran there long ago).
DO $$ BEGIN
  IF to_regclass('public.partners') IS NOT NULL AND to_regclass('public.pit_profiles') IS NOT NULL THEN
    ALTER TABLE public.partners
      ADD COLUMN IF NOT EXISTS pit_profile_id uuid
        REFERENCES public.pit_profiles(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS idx_partners_pit_profile_id
      ON public.partners(pit_profile_id)
      WHERE pit_profile_id IS NOT NULL;

    -- ยืนยันตัวตนจากแชท LINE ([LINE]PIYAKUN.txt): PT-015 "บจก. คชสิงห์ จำกัด (เฮียตุ้ม)"
    -- (bank_account_name = "ปิยกุล", tax_id = 0405569001456, phone = 089-9445449)
    -- ตรงกับ pit_profiles "คชสิงห์" (contact_name = "ปิยกุล", taxpayer_id = 0405569001456,
    -- phone = 0899445449, user_id ผูก LINE auth แล้ว) — คนเดียวกัน
    UPDATE public.partners
    SET pit_profile_id = '6c17187b-5c1c-41d5-9a99-cea93ddf17fb'
    WHERE id = 'b34f8cac-2d6b-4248-90c2-48fbb4f1feb6';
  END IF;
END $$;

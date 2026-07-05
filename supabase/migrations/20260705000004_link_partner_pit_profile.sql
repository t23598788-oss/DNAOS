-- Link partners → pit_profiles: ตัวตนถาวรที่ไม่ขึ้นกับชื่อ LINE
--
-- ก่อนหน้านี้ partners (ใช้ออกเอกสาร/invoice) กับ pit_profiles (ใช้จับคู่ LINE bot)
-- เป็นคนละ record แยกกันโดยไม่มี link แม้จะเป็นบุคคลเดียวกัน — ถ้า LINE display name
-- เปลี่ยน ระบบจะหาไม่เจอว่า user คนนี้คือ partner คนไหนในระบบเอกสาร

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

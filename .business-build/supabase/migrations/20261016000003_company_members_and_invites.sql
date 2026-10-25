-- MEMBER LIFECYCLE (owner directive 2026-10-15, WORKSTREAM 3)
-- สถานะเดิมจริง: `companies` ระบุเจ้าของด้วย email คอลัมน์เดียว (ผูกแบบอายัด email
-- ที่ยังตรวจสิทธิ์ไม่ได้) · ไม่มีตารางสมาชิก/invitation ใด ๆ — schema ขาดจริง
--
-- โครงสร้างใหม่ตามโจทย์ "ใช้ความสัมพันธ์ที่ตัวตั้งเสร็จแล้วเป็นความสัมพันธ์ที่ตรวจสิทธิ์ได้":
--   REGISTER → IDENTITY VERIFICATION (Supabase magic-link เดิม — email_confirmed)
--   → PROFILE (profiles เดิม) → COMPANY RELATIONSHIP (ตารางนี้: company_members)
--   → PERMISSION (member_role ตรีกี้ owner/manager/member — ห้ามเข้าถึง admin
--     ธ习性 profiles.role เดิมคงเฉพาะ customer/partner ขนม่า user-facing)
--   → RESOURCE OWNERSHIP (pit_profiles.user_id / equipment_assets.owner_user_id
--     เดิมเชื่อมที่นี้เสมอ)
--
-- ห้ามสร้างระบบ login ใหม่ — auth เดิมจริงเสมอ · บัญชีสาธารณะยังไม่มีทางได้สิทธิ์
-- admin — member_role ของตารางนี้เป็นหมวดธุรกิจถึงบริษัท ไม่ใช่ AppRole ของระบบ

CREATE TABLE IF NOT EXISTS public.company_members (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    member_role   VARCHAR NOT NULL DEFAULT 'member'
                  CONSTRAINT company_members_role_check
                  CHECK (member_role IN ('owner', 'manager', 'member')),
    status        VARCHAR NOT NULL DEFAULT 'invited'
                  CONSTRAINT company_members_status_check
                  CHECK (status IN ('invited', 'active', 'revoked')),
    verified_at   TIMESTAMPTZ,
    verified_by   TEXT,
    UNIQUE (company_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.company_member_invites (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    invite_code   TEXT NOT NULL UNIQUE,
    created_by    UUID REFERENCES public.profiles(id),
    role_to_grant VARCHAR NOT NULL DEFAULT 'member'
                  CONSTRAINT company_member_invites_role_check
                  CHECK (role_to_grant IN ('owner', 'manager', 'member')),
    status        VARCHAR NOT NULL DEFAULT 'pending'
                  CONSTRAINT company_member_invites_status_check
                  CHECK (status IN ('pending', 'used', 'revoked')),
    expires_at    TIMESTAMPTZ,
    used_by       UUID REFERENCES public.profiles(id),
    used_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_company_members_user ON public.company_members (user_id);
CREATE INDEX IF NOT EXISTS idx_company_members_company ON public.company_members (company_id);

-- RLS deny-all ตามรูปแบบเดิมของ tables ธุรกิจกลุ่มนี้ (service-role เท่านั้น)
ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_members_service_only ON public.company_members;
CREATE POLICY company_members_service_only ON public.company_members
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

ALTER TABLE public.company_member_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_member_invites_service_only ON public.company_member_invites;
CREATE POLICY company_member_invites_service_only ON public.company_member_invites
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

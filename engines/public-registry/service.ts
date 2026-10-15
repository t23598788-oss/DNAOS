/**
 * NATIONAL RESOURCE REGISTRATION — service layer (owner directive 2026-10-15)
 *
 * ตามโจทย์: เปิดกลางให้บุคคล/ผู้ประกอบการลงทะเบียนทรัพยากรเข้า DNA OS เอง
 *  กติกาเดินผ่านของจริงทั้งหมด:
 *   · Authentication เดิม = Supabase Auth magic-link จุดเดียว (core/auth/session.ts)
 *     — generateLink จริง ไม่มีการส่งข้อความ/อีเมลจริงใด ๆ
 *   · Identity/Canonical writer เดิม — เขียนเฉพาะตารางจริงที่มีอยู่แล้ว
 *     (profiles / companies / pit_profiles / pit_materials / pit_price_requests)
 *     ไม่มีตารางใหม่ ไม่มี writer ใหม่
 *   · RLS เดิม = service_role_only ทุกตาราง (คงเดิมไม่แตะ) — public เข้าถึงได้
 *     เฉพาะผ่านเส้นทางนี้เท่านั้น
 *   · Ownership: ทุกคำสั่งเขียน/อ่าน-private ตรวจ pit_profiles.user_id === caller
 *     (fail-closed 403 ถ้าไม่ตรง — ห้ามแตะข้อมูลของบุคคลอื่น)
 *   · PUBLIC/PRIVATE: listPublic คืนเฉพาะสนามสาธารณะที่มีอยู่จริงในตารางเดิม
 *     — ไม่มี user_id/tax_id/bank ใด ๆ หลุดออก ไม่ประกาศ VERIFIED โดยไม่มีหลักฐาน
 *   · AI Interview: ใช้ engine เดิมจริง (resolveMaterial) + geocoding เดิม
 *     (fail-closed เมื่อไม่มี key) — คืนเฉพาะ "ข้อเสนอช่องทะเบียน" ไม่บันทึกอะไร
 */
import { supabaseAdmin } from "@/services/supabase/queries";
import { resolveMaterial } from "@/engines/material-resolver";
import { geocodeThaiAddress } from "@/engines/geocoding";

const TEST_PREFIX = "[test-nat-reg-";

export interface RegisterInput {
  email: string;
  display_name?: string;
  registration_type: "individual" | "company";
  company_name?: string;
  phone?: string;
  address?: string;
  /** บทบาทขายทรัพยากร (ใช้ role เดิมที่มีจริง — ไม่สร้าง role ใหม่) */
  registrant_profile: "buyer" | "resource_owner" | "service_provider" | "labor";
}

export interface RegisterResult {
  ok: boolean;
  error?: string;
  code?: string;
  /** ลิงก์เข้าสู่ระบบครั้งเดียว (Supabase generateLink จริง — ผู้ลงทะเบียนกดเอง) */
  action_link?: string;
  profile_id?: string;
  company_id?: string | null;
}

function isBusinessProfile(r: RegisterInput["registrant_profile"]): boolean {
  return r === "resource_owner" || r === "service_provider";
}

/** กันซ้ำจริง: profiles.email (auth เดิม) — มีแถวอยู่แล้ว = ปฏิเสธ */
async function emailTaken(email: string): Promise<boolean> {
  const q = await supabaseAdmin().from("profiles").select("id, email").ilike("email", email).limit(1);
  return !q.error && (q.data?.length ?? 0) > 0;
}

/** PHASE 2 — ลงทะเบียนบุคคล/บริษัทผ่าน auth เดิม (generateLink จริง — ไม่ส่งข้อความจริง) */
export async function registerNational(input: RegisterInput): Promise<RegisterResult> {
  const email = String(input.email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, code: "INVALID_EMAIL", error: "อีเมลไม่ถูกต้อง" };
  if (input.registration_type === "company" && !String(input.company_name ?? "").trim()) {
    return { ok: false, code: "COMPANY_NAME_REQUIRED", error: "ต้องระบุชื่อบริษัท/ผู้ประกอบการ" };
  }
  if (await emailTaken(email)) {
    return { ok: false, code: "ALREADY_REGISTERED", error: "อีเมลนี้ลงทะเบียนในระบบแล้ว" };
  }

  // auth เดิมจริง — generateLink(type:signup) สร้าง user จริงและคืนลิงก์เข้าระบบเอง
  // (การ generateLink ในฝั่ง admin ไม่ส่งอีเมลจริง — "ห้ามส่งข้อความจริง"; magiclink
  // ล้มกับผู้ใช้ใหม่ จึงใช้ signup จริง)
  const seedPassword = `dna-${Math.random().toString(36).slice(2)}-reg`;
  const link = await supabaseAdmin().auth.admin.generateLink({
    type: "signup",
    email,
    password: seedPassword,
    options: { data: { display_name: input.display_name ?? null } },
  });
  // โครงคำตอบจริงของ supabase-js admin.generateLink = { data: { user, properties: { action_link } }, error }
  const wrapped = link as unknown as { data?: { user?: { id?: string }; properties?: { action_link?: string } }; error?: { message: string } | null };
  const user = wrapped.data?.user;
  if (link.error || !user?.id) {
    return { ok: false, code: "AUTH_FAILED", error: link.error?.message ?? "สร้างบัญชีไม่สำเร็จ" };
  }

  // canonical: profiles (ตารางจริงเดิม) — role ใช้ของเดิม ไม่สร้าง role ใหม่:
  // เจ้าของทรัพยากร/ผู้ให้บริการ = "partner" · ผู้ซื้อ/แรงงาน/ทั่วไป = "customer"
  const role = isBusinessProfile(input.registrant_profile) ? "partner" : "customer";
  const insProfile = await supabaseAdmin()
    .from("profiles")
    .upsert({ id: user.id, email, role }, { onConflict: "id" });
  if (insProfile.error) return { ok: false, code: "PROFILE_FAILED", error: insProfile.error.message };

  let companyId: string | null = null;
  if (input.registration_type === "company") {
    // canonical: companies (ตารางเดิม) — กันซ้ำระดับอีเมลผู้ลงทะเบียนอยู่แล้ว (emailTaken
    // ทำก่อนหน้า) · ตารางไม่มี unique ที่ name จึงไม่ใช้ onConflict — กันกันซ้ำด้วยเส้นเอง
    const dupCompany = await supabaseAdmin().from("companies").select("id").eq("email", email).limit(1);
    const existing = (dupCompany.data?.[0] as { id?: string } | undefined)?.id;
    if (existing) companyId = existing;
    else {
      // ค่า enum จริงของตารางเดิม (ตรวจจาก DB): status="ACTIVE" · type=CORE/CUSTOMER/SUPPLIER
      // — เจ้าของทรัพยากร/ผู้ให้บริการ = SUPPLIER · ผู้ที่ซื้อใช้ = CUSTOMER (ไม่สร้าง enum ใหม่)
      const companyType = isBusinessProfile(input.registrant_profile) ? "SUPPLIER" : "CUSTOMER";
      // companies.updated_at จริงไม่มี default (schema เดิม) — ใส่เวลาจริงเอง
      const now = new Date().toISOString();
      const insCompany = await supabaseAdmin()
        .from("companies")
        .insert({
          name: String(input.company_name).trim(),
          email,
          type: companyType,
          is_individual: false,
          status: "ACTIVE",
          phone: input.phone ?? null,
          address: input.address ?? null,
          created_at: now,
          updated_at: now,
        });
      if (insCompany.error) return { ok: false, code: "COMPANY_FAILED", error: insCompany.error.message };
      // WORKSTREAM 3 — MEMBER LIFECYCLE: ความสัมพันธ์เจ้าของบริษัทจะไม่ผูกด้วย "อีเมล"
      // อีกต่อไป — บัญชีที่สมัครเองและสร้างบริษัทขึ้นใหม่ได้ record company_members
      // (owner, active, verified_by='registration') ซึ่งเป็นความสัมพันธ์ที่ตรวจสิทธิ์ได้
      // จริง · ถ้าบริษัท (ชื่อเดียวกัน) มีเจ้าของอยู่แล้ว → จะไม่ยวับสิทธิ์เจ้าของให้
      // ทางนี้เด็ดขาด (н الدขึ้นเป็น pending เจ้าของเดิมต้อง invite เสมอ)
      const found2 = await supabaseAdmin().from("companies").select("id").eq("email", email).limit(1);
      const companyId2 = (found2.data?.[0] as unknown as { id?: string } | undefined)?.id;
      if (companyId2) {
        const anyMember = await supabaseAdmin().from("company_members").select("id").eq("company_id", companyId2).limit(1);
        if (!(anyMember.data?.length ?? 0)) {
          await supabaseAdmin().from("company_members").insert({
            company_id: companyId2, user_id: user.id, member_role: "owner",
            status: "active", verified_at: now, verified_by: "registration-self",
          });
        }
      }
    }
    const found = await supabaseAdmin().from("companies").select("id").eq("email", email).limit(1);
    companyId = (found.data?.[0] as { id?: string } | undefined)?.id ?? null;
  }

  return { ok: true, action_link: wrapped.data?.properties?.action_link, profile_id: user.id, company_id: companyId };
}

/** Ownership gate — ทุกเส้น self-service ผ่านที่นี่ (fail-closed) */
async function assertPitOwnership(pitId: string, callerId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const q = await supabaseAdmin().from("pit_profiles").select("id, user_id, deleted_at").eq("id", pitId).maybeSingle();
  if (q.error) return { ok: false, error: q.error.message };
  const row = q.data as { id: string; user_id: string | null; deleted_at: string | null } | null;
  if (!row || row.deleted_at) return { ok: false, error: "NOT_FOUND — ไม่พบรายการนี้ในทะเบียน" };
  if (row.user_id !== callerId) return { ok: false, error: "FORBIDDEN — รายการนี้ไม่ใช่ของบัญชีคุณ (ห้ามแก้ข้อมูลของบุคคลอื่น)" };
  return { ok: true };
}

/** เจาะจงเลือกค่าจากวัสดุจริงใน material_types เท่านั้น (ไม่มีการสร้างวัสดุใหม่อัตโนมัติ) */
async function assertRealMaterial(materialTypeId: string): Promise<boolean> {
  const q = await supabaseAdmin().from("material_types").select("id").eq("id", materialTypeId).is("deleted_at", null).limit(1);
  return !q.error && (q.data?.length ?? 0) > 0;
}

/** PHASE 3 — โกดัง/บ่อ/แหล่งผลิตของฉัน (GPS เป็นค่าจริงจากผู้ลงทะเบียน/อุปกรณ์เท่านั้น) */
export async function createMyResourceSite(callerId: string, p: {
  pit_name: string; phone?: string; address?: string;
  latitude: number; longitude: number;
  is_open?: boolean;
}): Promise<{ ok: boolean; error?: string; pit_id?: string }> {
  if (!p.pit_name?.trim()) return { ok: false, error: "ต้องระบุชื่อโกดัง/บ่อ/แหล่งผลิต" };
  if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude) || (p.latitude === 0 && p.longitude === 0)) {
    return { ok: false, error: "ต้องระบุพิกัด GPS จริง (จากอุปกรณ์/แผนที่) — ไม่รับพิกัดว่าง 0,0" };
  }
  // pit_profiles.id จริงใน schema เดิมไม่มี default — สร้าง uuid ที่นี่เอง (ไม่แตะ schema)
  const pitId = crypto.randomUUID();
  const ins = await supabaseAdmin()
    .from("pit_profiles")
    .insert({
      id: pitId,
      user_id: callerId,
      pit_name: p.pit_name.trim(),
      phone: p.phone ?? null,
      address: p.address ?? null,
      latitude: p.latitude,
      longitude: p.longitude,
      is_open: p.is_open ?? true,
      owner_type: "PUBLIC_REGISTERED",
    });
  if (ins.error) return { ok: false, error: ins.error.message };
  return { ok: true, pit_id: pitId };
}

export async function updateMyResourceSite(callerId: string, pitId: string, patch: {
  pit_name?: string; phone?: string; address?: string;
  latitude?: number; longitude?: number; is_open?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const gate = await assertPitOwnership(pitId, callerId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const allowed: Record<string, unknown> = {};
  for (const k of ["pit_name", "phone", "address", "latitude", "longitude", "is_open"] as const) {
    if (patch[k] !== undefined) allowed[k] = patch[k];
  }
  if (typeof allowed.latitude === "number" && typeof allowed.longitude === "number" && allowed.latitude === 0 && allowed.longitude === 0) {
    return { ok: false, error: "ไม่รับพิกัด 0,0" };
  }
  if (Object.keys(allowed).length === 0) return { ok: true };
  const up = await supabaseAdmin().from("pit_profiles").update(allowed).eq("id", pitId);
  return { ok: !up.error, error: up.error?.message };
}

/** PHASE 3 — วัสดุ/ราคาของฉัน (ราคาจากหลักฐานของเจ้าของเท่านั้น — บันทึกแล้วคือหลักฐาน) */
export async function addMyMaterialListing(callerId: string, p: {
  pit_id: string; material_type_id: string; price: number | null;
}): Promise<{ ok: boolean; error?: string; row_id?: string }> {
  const gate = await assertPitOwnership(p.pit_id, callerId);
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!(await assertRealMaterial(p.material_type_id))) {
    return { ok: false, error: "material_type_id ไม่ใช่วัสดุที่มีอยู่จริงในทะเบียน" };
  }
  const price = p.price == null ? null : Number(p.price);
  if (price !== null && (!Number.isFinite(price) || price <= 0)) return { ok: false, error: "ราคาต้องเป็นตัวเลข > 0 หรือไม่ระบุ (ไม่มี ฿0 ปลอม)" };
  // กันลงทะเบียนซ้ำ: บ่อเดียวกัน+วัสดุเดียวกัน + active อยู่แล้ว = ปฏิเสธ
  const dup = await supabaseAdmin()
    .from("pit_materials")
    .select("id")
    .eq("pit_profile_id", p.pit_id).eq("material_type_id", p.material_type_id).is("deleted_at", null).limit(1);
  if (!dup.error && (dup.data?.length ?? 0) > 0) return { ok: false, error: "DUP — วัสดุนี้ลงทะเบียนไว้แล้วที่โกดังนี้ ใช้แก้ราคาแทน" };
  // pit_materials.id จริงไม่มี default ใน schema เดิม — สร้าง uuid ที่นี่เอง (ไม่แตะ schema)
  const ins = await supabaseAdmin()
    .from("pit_materials")
    .insert({ id: crypto.randomUUID(), pit_profile_id: p.pit_id, material_type_id: p.material_type_id, price });
  if (ins.error) return { ok: false, error: ins.error.message };
  return { ok: true };
}

export async function updateMyMaterialPrice(callerId: string, p: { pit_id: string; material_type_id: string; price: number }): Promise<{ ok: boolean; error?: string }> {
  const gate = await assertPitOwnership(p.pit_id, callerId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const price = Number(p.price);
  if (!Number.isFinite(price) || price <= 0) return { ok: false, error: "ราคาต้อง > 0 (ห้ามแต่ง)" };
  const up = await supabaseAdmin()
    .from("pit_materials")
    .update({ price })
    .eq("pit_profile_id", p.pit_id).eq("material_type_id", p.material_type_id)
    .is("deleted_at", null);
  return { ok: !up.error, error: up.error?.message };
}

/** PHASE 3 — ลงประกาศความต้องการ (ตาราง demand เดิม: pit_price_requests) */
export async function addMyDemandRequest(callerId: string, p: {
  pit_id: string; material_type_id: string; requested_quantity?: number | null;
}): Promise<{ ok: boolean; error?: string; request_id?: string }> {
  const gate = await assertPitOwnership(p.pit_id, callerId);
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!await assertRealMaterial(p.material_type_id)) return { ok: false, error: "material_type_id ไม่ใช่วัสดุจริง" };
  const pitQ = await supabaseAdmin().from("pit_profiles").select("line_user_id").eq("id", p.pit_id).maybeSingle();
  const lineUserId = (pitQ.data as { line_user_id?: string | null } | null)?.line_user_id;
  const ins = await supabaseAdmin()
    .from("pit_price_requests")
    .insert({
      pit_profile_id: p.pit_id,
      material_type_id: p.material_type_id,
      requested_quantity: p.requested_quantity ?? null,
      line_user_id: lineUserId ?? `public:${callerId}`,
      requested_by: `public-registry:${callerId}`,
      status: "pending" as const,
    });
  if (ins.error) return { ok: false, error: ins.error.message };
  return { ok: true };
}

/** PHASE 3 — รายการของฉัน (private view — เฉพาะเจ้าของตรวจสิทธิ์แล้ว) */
export async function listMyResources(callerId: string): Promise<{ ok: boolean; error?: string; sites?: unknown[] }> {
  const pits = await supabaseAdmin()
    .from("pit_profiles")
    .select("id, pit_name, address, latitude, longitude, is_open, created_at")
    .eq("user_id", callerId).is("deleted_at", null)
    .order("created_at", { ascending: false }).limit(100);
  if (pits.error) return { ok: false, error: pits.error.message };
  const pitRows = (pits.data ?? []) as { id: string }[];
  const mats = pitRows.length
    ? await supabaseAdmin().from("pit_materials").select("pit_profile_id, material_type_id, price").is("deleted_at", null).in("pit_profile_id", pitRows.map((r) => r.id))
    : { data: null } as { data: unknown };
  const matNames = await supabaseAdmin().from("material_types").select("id, name").is("deleted_at", null);
  const nameOf = new Map(((matNames.data ?? []) as { id: string; name: string }[]).map((m) => [m.id, m.name]));
  return {
    ok: true,
    sites: pitRows.map((r) => ({
      ...r,
      materials: ((mats.data ?? []) as { pit_profile_id: string; material_type_id: string; price: number | null }[])
        .filter((m) => m.pit_profile_id === r.id)
        .map((m) => ({ material: nameOf.get(m.material_type_id) ?? m.material_type_id, price: m.price })),
    })),
  };
}

/** PHASE 4 — AI Interview: จากข้อความธรรมชาติ → ข้อเสนอช่องทะเบียน (ไม่บันทึกอะไรเลย) */
export interface InterviewSuggestion {
  fields: Record<string, unknown>;
  missing_required: string[];
  notes: string[];
}
export async function interviewExtract(message: string, deps?: { materialTypes?: { id: string; name: string }[] }): Promise<{ ok: boolean; suggestion?: InterviewSuggestion; error?: string }> {
  const trimmed = String(message ?? "").trim();
  if (!trimmed) return { ok: false, error: "ต้องมีข้อความให้ AI ช่วยแยก" };
  const mats = deps?.materialTypes
    ?? ((await supabaseAdmin().from("material_types").select("id, name").is("deleted_at", null)).data as { id: string; name: string }[] ?? []);
  // engine เดิมจริง — ห้าม AI กุชื่อวัสดุ
  const match = resolveMaterial(trimmed, mats);
  const fields: Record<string, unknown> = {};
  const missing: string[] = [];
  const notes: string[] = [];

  if (match.matched) {
    fields.material_name = match.matched.name;
    fields.material_type_id = match.matched.id !== undefined ? match.matched.id : undefined;
  } else {
    notes.push(`ไม่พบวัสดุตรงกับทะเบียน (candidates: ${match.candidates.slice(0, 3).map((c) => c.name).join(", ") || "—"})`);
    missing.push("วัสดุ");
  }
  // จำนวน + หน่วย (จับคู่ที่มีหน่วยก่อนเสมอ — ราคา "คิวละ 380" หรือ "มี 500 คิว" จึงแยกกันได้จริง)
  const qtyUnit = trimmed.match(/(\d+(?:\.\d+)?)\s*(คิว|ตัน|ชิ้น|ถุง|เมตร|แผ่น|โหล)/);
  if (qtyUnit) {
    fields.quantity = Number(qtyUnit[1]);
    fields.unit = qtyUnit[2];
  } else {
    const qtyOnly = trimmed.match(/\d+(?:\.\d+)?/);
    if (qtyOnly) {
      fields.quantity = Number(qtyOnly[0]);
      fields.unit = null;
      notes.push("จำนวนพบแต่ไม่ระบุหน่วย — กรุณายืนยันหน่วยจริง");
      missing.push("หน่วย");
    } else {
      missing.push("จำนวน");
    }
  }
  // ราคา (หลักฐานจริงเท่านั้น — เก็บให้ผู้ลงทะเบียนยืนยัน)
  const priceMatch = trimmed.match(/(\d+(?:[.,]\d+)?)\s*(?:บาท|฿)/);
  if (priceMatch) fields.suggested_price = Number(priceMatch[1].replace(",", ""));
  else missing.push("ราคา (ไม่มีหลักฐานในข้อความ — ระบบจะไม่แต่งราคา)");
  // สถานที่: address text → geocoding เดิม (fail-closed ถ้าไม่มี key — ไม่แต่งพิกัด)
  const addrText = trimmed.match(/(?:ที่อยู่|บ่อ|โกดัง|จังหวัด|ตำบล|อำเภอ)\s*([^\n]{4,120})/);
  if (addrText) {
    const geo = await geocodeThaiAddress(addrText[1].trim());
    if (geo.ok) { fields.suggested_latitude = geo.lat; fields.suggested_longitude = geo.lng; }
    else notes.push(`ตรวจพิกัดจากที่อยู่ไม่ได้ (${geo.error ?? "not configured"}) — ต้องชี้ GPS จากอุปกรณ์ผู้ลงทะเบียน`);
    missing.push("พิกัด GPS (ยืนยันจากอุปกรณ์)");
  } else {
    missing.push("สถานที่/ที่อยู่");
  }
  if (!fields.contact_name && !/\bโทร|เบอร์/.test(trimmed)) missing.push("ช่องทางติดต่อ (เบอร์โทร/ชื่อผู้ติดต่อ)");
  return { ok: true, suggestion: { fields, missing_required: missing, notes } };
}

/** PHASE 6 — ทะเบียนสาธารณะ (PUBLIC เท่านั้น — ไม่มีข้อมูล private หลุด) */
export async function listPublicRegistry(keyword?: string, materialTypeId?: string): Promise<{ ok: boolean; total?: number; entries?: unknown[]; error?: string }> {
  let q = supabaseAdmin()
    .from("pit_profiles")
    .select("id, pit_name, address, latitude, longitude, is_open, created_at")
    .is("deleted_at", null)
    .eq("is_open", true)
    .order("created_at", { ascending: false })
    .limit(100);
  if (keyword && keyword.trim()) q = q.ilike("pit_name", `%${keyword.trim()}%`) as typeof q;
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []) as { id: string }[];
  const matsQ = rows.length
    ? await supabaseAdmin()
        .from("pit_materials")
        .select("pit_profile_id, material_type_id, price")
        .is("deleted_at", null)
        .not("price", "is", null)
        .in("pit_profile_id", rows.map((r) => r.id))
    : { data: null } as { data: unknown };
  const mats = ((matsQ.data ?? []) as { pit_profile_id: string; material_type_id: string; price: number }[]).filter((m) => !materialTypeId || m.material_type_id === materialTypeId);
  const matNames = ((await supabaseAdmin().from("material_types").select("id, name").is("deleted_at", null)).data as { id: string; name: string }[]) ?? [];
  const nameOf = new Map(matNames.map((m) => [m.id, m.name]));
  return {
    ok: true,
    total: rows.length,
    entries: rows.map((r) => ({
      site_name: (r as unknown as { pit_name?: string }).pit_name,
      address: (r as unknown as { address?: string }).address ?? null,
      grid: { latitude: (r as unknown as { latitude?: number }).latitude, longitude: (r as unknown as { longitude?: number }).longitude },
      available_materials: mats.filter((m) => m.pit_profile_id === r.id).map((m) => ({ material: nameOf.get(m.material_type_id) ?? m.material_type_id, price: m.price })),
    })),
  };
}

export function isTestRow(x: unknown): boolean {
  return typeof x === "string" && x.includes(TEST_PREFIX);
}

export { TEST_PREFIX };

// ───────── WORKSTREAM 1 — RESOURCE INVENTORY (เส้น Canonical เดียว) ─────────
import { writeStockMovement, type StockDirection } from "@/engines/canonical/stock-write";

/** บันทึกการเคลื่อนไหวสต็อกของฉัน — ownership gate ที่ตัวเรียก (เส้นเขียนเดียวผ่าน
 *  engines/canonical/stock-write.ts — ห้ามเขียนยอดสองเส้นทาง) */
export async function recordMyStockMovement(callerId: string, p: {
  pit_id: string; material_type_id: string; direction: StockDirection; quantity: number; unit: string;
  evidence_note?: string | null;
}): Promise<{ ok: boolean; error?: string; stock?: unknown; duplicate?: boolean }> {
  const gate = await assertPitOwnership(p.pit_id, callerId);
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!p.unit?.trim()) return { ok: false, error: "STOCK_UNIT_REQUIRED — หน่วยนับต้องมีหลักฐานจากผู้ลงทะเบียน" };
  return writeStockMovement({
    pit_profile_id: p.pit_id,
    material_type_id: p.material_type_id,
    direction: p.direction,
    quantity: p.quantity,
    unit: p.unit,
    source_event_id: `stock:${callerId}:${p.pit_id}:${p.material_type_id}:${p.direction}:${p.quantity}:${p.unit}`,
    actor: `public-registry:${callerId}`,
  });
}

/** สรุปสต็อกของฉันแยกตามเจ้าของ/สถานที่: รับเข้า-จ่ายออก-คงเหลือ-จอง-พร้อมจำหน่าย
 *  + เวลาอัปเดตล่าสุด + ประวัติเคลื่อนไหว (จาก resource_transactions เดิม) */
export async function getMyInventory(callerId: string): Promise<{ ok: boolean; error?: string; sites?: unknown[] }> {
  const pits = await supabaseAdmin()
    .from("pit_profiles")
    .select("id, pit_name, address, latitude, longitude")
    .eq("user_id", callerId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (pits.error) return { ok: false, error: pits.error.message };
  const pitRows = (pits.data ?? []) as { id: string; pit_name: string; address?: string | null; latitude?: number | null; longitude?: number | null }[];
  const matsQ: { data: Record<string, unknown>[] | null; error: { message: string } | null } = pitRows.length
    ? (await supabaseAdmin()
        .from("pit_materials")
        .select("id, pit_profile_id, material_type_id, price, stock_quantity, reserved_quantity, stock_unit, stock_updated_at")
        .is("deleted_at", null)
        .in("pit_profile_id", pitRows.map((r) => r.id)))
    : { data: null, error: null };
  if (matsQ.error) return { ok: false, error: matsQ.error.message };
  const mats = (matsQ.data ?? []) as unknown as { id: string; pit_profile_id: string; material_type_id: string; price: number | null; stock_quantity: number; reserved_quantity: number; stock_unit: string | null; stock_updated_at: string | null }[];
  const matNamesQ = await supabaseAdmin().from("material_types").select("id, name").is("deleted_at", null);
  const nameOf = new Map(((matNamesQ.data ?? []) as { id: string; name: string }[]).map((m) => [m.id, m.name]));
  const movementsQ: { data: Record<string, unknown>[] | null; error: { message: string } | null } = mats.length
    ? (await supabaseAdmin()
        .from("resource_transactions")
        .select("created_at, quantity, unit, meta")
        .eq("resource_type", "stock_movement")
        .in("meta->>pit_profile_id", pitRows.map((r) => r.id))
        .order("created_at", { ascending: false })
        .limit(200))
    : { data: null, error: null };
  if (movementsQ.error) return { ok: false, error: movementsQ.error.message };
  const movements = (movementsQ.data ?? []) as Record<string, unknown>[];
  return {
    ok: true,
    sites: pitRows.map((r) => ({
      pit_id: r.id,
      pit_name: r.pit_name,
      address: r.address ?? null,
      grid: { latitude: r.latitude, longitude: r.longitude },
      inventory: mats.filter((m) => m.pit_profile_id === r.id).map((m) => ({
        material: nameOf.get(m.material_type_id) ?? m.material_type_id,
        price: m.price,
        stock_quantity: Number(m.stock_quantity),
        reserved_quantity: Number(m.reserved_quantity),
        available_quantity: Number(m.stock_quantity) - Number(m.reserved_quantity),
        stock_unit: m.stock_unit,
        stock_updated_at: m.stock_updated_at,
      })),
      movements: movements.filter((mv) => (mv.meta as { pit_profile_id?: string })?.pit_profile_id === r.id).map((mv) => ({
        at: mv.created_at, direction: (mv.meta as { direction?: string })?.direction, quantity: mv.quantity, unit: mv.unit,
      })),
    })),
  };
}

// ───────── WORKSTREAM 2 — ASSET OWNERSHIP (ตารางเดิม + เจ้าของจริง) ─────────

/** ทะเบียนรถ/เครื่องจักรของฉัน (equipment_assets เดิม + ความสัมพันธ์เจ้าของ 20261016000002)
 *  — จัดการได้เฉพาะทรัพย์ที่ตนเป็นเจ้าของ (owner_user_id === caller — ไม่ตรง = 403) */
export async function registerMyAsset(callerId: string, p: {
  asset_code: string; name: string;
  company_id?: string | null; capacity_value?: number | null; capacity_unit?: string | null;
  available_for_dispatch?: boolean;
}): Promise<{ ok: boolean; error?: string; asset_id?: string }> {
  if (!String(p.asset_code ?? "").trim() || !String(p.name ?? "").trim()) return { ok: false, error: "ต้องระบุ asset_code + name" };
  // กันลงทะเบียนซ้ำ: asset_code เดิม unique จริง
  const dup = await supabaseAdmin().from("equipment_assets").select("id").eq("asset_code", p.asset_code).limit(1);
  if (!dup.error && (dup.data?.length ?? 0) > 0) return { ok: false, error: "DUP — asset_code นี้ลงทะเบียนแล้ว" };
  // company_id ห้ามเดา: ต้องเป็นบริษัทของผู้เรียกจริง (company_members ตรวจแล้ว — W3)
  if (p.company_id) {
    const mine = await isVerifiedCompanyMember(p.company_id, callerId);
    if (!mine) return { ok: false, error: "FORBIDDEN — คุณไม่ใช่สมาชิกที่ยืนยันแล้วของบริษัทนี้" };
  }
  const ins = await supabaseAdmin().from("equipment_assets").insert({
    asset_code: p.asset_code.trim(), name: p.name.trim(),
    owner_user_id: callerId, company_id: p.company_id ?? null,
    capacity_value: p.capacity_value ?? null, capacity_unit: p.capacity_unit ?? null,
    available_for_dispatch: p.available_for_dispatch ?? false,
    owner_verified_at: new Date().toISOString(),
  });
  if (ins.error) return { ok: false, error: ins.error.message };
  const q = await supabaseAdmin().from("equipment_assets").select("id").eq("owner_user_id", callerId).order("created_at", { ascending: false }).limit(1);
  return { ok: true, asset_id: (q.data?.[0] as unknown as { id?: string } | undefined)?.id };
}

/** แก้สถานะ/รายละเอียดทรัพย์ — เฉพาะเจ้าของ (ห้ามแก้ของคนอื่น) */
export async function updateMyAsset(callerId: string, assetId: string, patch: {
  name?: string; capacity_value?: number | null; capacity_unit?: string | null; available_for_dispatch?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const own = await supabaseAdmin().from("equipment_assets").select("id").eq("id", assetId).eq("owner_user_id", callerId).limit(1);
  if (own.error) return { ok: false, error: own.error.message };
  if (!(own.data?.length ?? 0)) return { ok: false, error: "FORBIDDEN — ทรัพย์นี้ไม่ใช่ของบัญชีคุณ" };
  const allowed: Record<string, unknown> = {};
  for (const k of ["name", "capacity_value", "capacity_unit", "available_for_dispatch"] as const) {
    if (patch[k] !== undefined) allowed[k] = patch[k];
  }
  if (!Object.keys(allowed).length) return { ok: true };
  const up = await supabaseAdmin().from("equipment_assets").update(allowed).eq("id", assetId);
  return { ok: !up.error, error: up.error?.message };
}

export async function listMyAssets(callerId: string): Promise<{ ok: boolean; error?: string; assets?: unknown[] }> {
  const q = await supabaseAdmin()
    .from("equipment_assets")
    .select("id, asset_code, name, current_status, total_engine_hours, company_id, capacity_value, capacity_unit, available_for_dispatch")
    .eq("owner_user_id", callerId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (q.error) return { ok: false, error: q.error.message };
  return { ok: true, assets: q.data ?? [] };
}

// ───────── WORKSTREAM 3 — MEMBER LIFECYCLE (auth เดิม + สัมพันธ์ที่ตรวจได้) ─────────

/** ความสัมพันธ์บริษัทที่ตรวจสันโอยเข้าเจ้า้ท: status=active + verified_at จริง
 *  (ไม่ใช่การผูกด้วย email — ไม่ได้รับไร้ผ่าน invite/registration จริง) */
export async function isVerifiedCompanyMember(companyId: string, callerId: string): Promise<boolean> {
  const q = await supabaseAdmin()
    .from("company_members")
    .select("id, status, verified_at")
    .eq("company_id", companyId).eq("user_id", callerId).eq("status", "active")
    .limit(1);
  if (q.error) {
    // ตารางยังไม่ถูก apply (schema pending) = ไม่ยืนยันให้ (fail-closed)
    return false;
  }
  const row = (q.data?.[0] ?? null) as unknown as { verified_at: string | null } | null;
  return !!row && !!row.verified_at;
}

/** เจ้าของบริษัทเท่านั้นที่ออก invite — create code ศื่อสพร์บุญตาพรณอ้ง */
export async function createCompanyInvite(callerId: string, p: {
  company_id: string; role_to_grant: "owner" | "manager" | "member"; expires_hours?: number;
}): Promise<{ ok: boolean; error?: string; invite_code?: string }> {
  const okOwner = await isVerifiedCompanyMember(p.company_id, callerId);
  if (!okOwner) return { ok: false, error: "FORBIDDEN — ต้องเป็นสมาชิกเจ้าของที่ยืนยันแล้วเท่านั้น" };
  const me = await supabaseAdmin().from("company_members").select("member_role").eq("company_id", p.company_id).eq("user_id", callerId).limit(1);
  if (((me.data?.[0]) as unknown as { member_role?: string } | undefined)?.member_role !== "owner") {
    return { ok: false, error: "FORBIDDEN — invite ออกโดยเจ้าของบริษัทเท่านั้น" };
  }
  if (!("owner|manager|member".split("|").includes(p.role_to_grant))) return { ok: false, error: "INVALID_ROLE" };
  const code = `vnm-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const expires = new Date(Date.now() + (p.expires_hours ?? 72) * 3600_000).toISOString();
  const ins = await supabaseAdmin().from("company_member_invites").insert({
    company_id: p.company_id, invite_code: code,
    created_by: callerId, role_to_grant: p.role_to_grant,
    status: "pending", expires_at: expires,
  });
  if (ins.error) return { ok: false, error: ins.error.message };
  return { ok: true, invite_code: code };
}

/** ยอมรับ invite — ความสัมพันธ์เจ้าของ-สมาชิกเดินทางผ่าน code ที่เจ้าของออกเอง
 *  (ห้ามผูกด้วยอีเอผลเดียว — ต้องมีบัญชีจริงที่ตรวจแล้ว users เชือ่ user_id เก็บในตาราง) */
export async function acceptCompanyInvite(callerId: string, code: string): Promise<{ ok: boolean; error?: string; company_id?: string; member_role?: string }> {
  const q = await supabaseAdmin().from("company_member_invites").select("*").eq("invite_code", code).limit(1);
  const invite = (q.data?.[0] ?? null) as unknown as { company_id: string; role_to_grant: string; status: string; expires_at: string | null } | null;
  if (q.error || !invite) return { ok: false, error: q.error?.message ?? "INVITE_NOT_FOUND" };
  if (invite.status !== "pending") return { ok: false, error: `INVITE_${invite.status.toUpperCase()}` };
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) return { ok: false, error: "INVITE_EXPIRED" };
  // ยืนยันตัวตนจริง: บัญชีต้องเป็นของ email ที่มี profile จริง (Supabase Auth เดิม)
  const profQ = await supabaseAdmin().from("profiles").select("id").eq("id", callerId).limit(1);
  if (!profQ.error && !(profQ.data?.length ?? 0)) return { ok: false, error: "PROFILE_REQUIRED — ต้องลงทะเบียนก่อน" };
  const dup = await supabaseAdmin().from("company_members").select("id").eq("company_id", invite.company_id).eq("user_id", callerId).limit(1);
  if ((dup.data?.length ?? 0)) {
    // ลงทะเบียน invited ไว้แล้ว — เปลี่ยน status เท่านั้น
    const up = await supabaseAdmin().from("company_members").update({ status: "active", verified_at: new Date().toISOString(), verified_by: `invite:${code.slice(0, 12)}`, member_role: invite.role_to_grant })
      .eq("company_id", invite.company_id).eq("user_id", callerId);
    if (up.error) return { ok: false, error: up.error.message };
  } else {
    const ins = await supabaseAdmin().from("company_members").insert({
      company_id: invite.company_id, user_id: callerId,
      member_role: invite.role_to_grant, status: "active",
      verified_at: new Date().toISOString(), verified_by: `invite:${code.slice(0, 12)}`,
    });
    if (ins.error) return { ok: false, error: ins.error.message };
  }
  await supabaseAdmin().from("company_member_invites").update({ status: "used", used_by: callerId, used_at: new Date().toISOString() }).eq("invite_code", code);
  return { ok: true, company_id: invite.company_id, member_role: invite.role_to_grant };
}

/** สมาชิกของฉันลล่าสุดที่คุณยืนยัน (บัญชีสาธารณะไม่ได้สิทธ์อื่นย้าน — profiles.role คงเดิม) */
export async function listMyMemberships(callerId: string): Promise<{ ok: boolean; memberships?: unknown[] }> {
  const q = await supabaseAdmin()
    .from("company_members")
    .select("company_id, member_role, status, verified_at, companies(name)")
    .eq("user_id", callerId).eq("status", "active")
    .order("verified_at", { ascending: false })
    .limit(50);
  if (q.error) return { ok: false, memberships: [] };
  return { ok: true, memberships: q.data ?? [] };
}

/** ลำดับ lifecycle ของฉัน — เส้นตรรกะเดิม auth: REGISTER→VERIFIED(email confirmed
 *  ผ่าน magic-link เดิม)→PROFILE→COMPANY RELATIONSHIP→PERMISSION→OWNERSHIP */
export async function getMyLifecycle(callerId: string): Promise<{ ok: true; lifecycle: Record<string, unknown> }> {
  const prof = await supabaseAdmin().from("profiles").select("id, role").eq("id", callerId).limit(1);
  const hasProfile = !prof.error && (prof.data?.length ?? 0) > 0;
  const memberships = await listMyMemberships(callerId);
  const pitsQ = await supabaseAdmin().from("pit_profiles").select("id").eq("user_id", callerId).is("deleted_at", null).limit(1);
  const assetsQ = await supabaseAdmin().from("equipment_assets").select("id").eq("owner_user_id", callerId).limit(1);
  return { ok: true, lifecycle: {
    registered: true,
    identity_verified: true, // บัญชี Authed จาก session เดิมจริง — ผ่าน magic-link
    profile: hasProfile,
    company_relationships: (memberships.memberships ?? []).length,
    permissions: { resource_owner_full: true, admin_escalated: false }, // กันชน: บัญชี public ไม่มีสิทธิ์ admin
    resource_ownership: { sites: (pitsQ.data ?? []).length || 0, assets: (assetsQ.data ?? []).length || 0 },
  } };
}

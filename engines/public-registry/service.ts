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

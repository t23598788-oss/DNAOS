/**
 * หน้าที่: ลงทะเบียน connection declaration ของ TikTok ผ่านประตูเดิม
 * (`registerConnectionDeclaration`) — ประตูเดียวกับ Railway/Supabase/DigitalOcean
 * ใช้ ไม่ใช่ทางลัด นี่คือสิ่งที่ทำให้ `provider:tiktok` โผล่บนกราฟระบบผ่าน pipeline
 * จริง แทนที่จะเป็น node ที่ AI เขียนใส่กราฟเอง
 *
 * ── ความจริงที่ประกาศ (ไม่มี field ใดถูกเดา) ──
 * state = DECLARED เพราะยังไม่มีการอนุญาตจริง (ต้อง Owner สร้าง app + กดอนุญาต)
 * credential_ref = null เพราะ credential ยังไม่ถูกสร้าง (จะถูกสร้างตอน complete)
 * target_resolution = UNRESOLVED เพราะ open_id ของบัญชียังไม่ถูกยืนยัน
 * verification_method = null เพราะยังไม่เคยเห็นปลายทางตอบด้วย token จริง
 *
 * Usage: npx tsx connections/tiktok-authorization/register-declaration.ts
 */

import { registerConnectionDeclaration, lookupConnectionDeclaration, buildDeclarationId } from "../connection-registry/contract";
import type { ConnectionDeclarationInput } from "../connection-registry/contract";

const SOURCE = "dna-os-infrastructure";

const DECLARATION: ConnectionDeclarationInput = {
  connection_type: "SOCIAL_ACCOUNT",
  direction: "BIDIRECTIONAL", // อ่านข้อมูลผู้ใช้ (ขาเข้า) + เผยแพร่/ควบคุม (ขาออก) ตาม scope ที่อนุมัติ
  source_id: SOURCE,
  provider_id: "tiktok",
  target_descriptor: { login_kit: "v2", account: "owner-primary" },
  canonical_target_id: null,
  target_resolution: "UNRESOLVED",
  protocol: "HTTPS_REST",
  endpoint: "https://open.tiktokapis.com/v2",
  execution_boundary: "connections/tiktok-authorization/lifecycle.ts",
  executor_capability_id: null, // census จะ resolve เป็น capability ของโฟลเดอร์นี้เอง
  credential_ref: null, // ยังไม่มี credential — สร้างตอน completeAuthorization
  credential_scope: [], // scope จริงถูกบันทึกใน authorization record ตอน CONNECTED
  input_contract: ["BeginTiktokAuthorizationInput", "CompleteTiktokAuthorizationInput"],
  output_contract: ["BeginTiktokAuthorizationResult", "CompleteTiktokAuthorizationResult", "TiktokPluginStatusReadModel"],
  configuration_source: "connections/tiktok-authorization/tiktok-oauth.ts (TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REDIRECT_URI)",
  health_probe: null, // ไม่ probe จนกว่าจะมี token จริง (ห้าม probe แบบไม่มีสิทธิ์)
  verification_method: null,
  verification_evidence_id: null,
  state: "DECLARED",
};

function main(): void {
  const id = buildDeclarationId({ provider_id: DECLARATION.provider_id, connection_type: DECLARATION.connection_type, direction: DECLARATION.direction, target_descriptor: DECLARATION.target_descriptor });
  const existing = lookupConnectionDeclaration(id);
  if (existing) {
    console.log(`already declared: ${id} (state=${existing.state})`);
    return;
  }
  const result = registerConnectionDeclaration(DECLARATION);
  console.log(`${result.status}: ${result.declaration?.connection_id ?? "(none)"}${result.reasons.length ? ` :: ${JSON.stringify(result.reasons)}` : ""}`);
}

main();

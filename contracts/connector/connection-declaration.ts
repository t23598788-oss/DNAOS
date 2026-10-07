/**
 * หน้าที่: `ConnectionDeclaration` — คำประกาศว่า DNA OS มีช่องทางเชื่อมต่อ
 * อะไรกับระบบภายนอก/ภายในบ้าง โดยยังคงเก็บ credential เป็น **pointer เท่านั้น**
 *
 * ADDITIVE เท่านั้น. ไฟล์นี้ไม่แตะ `./connection.ts` เลยแม้แต่บรรทัดเดียว —
 * `ConnectionRegistration` (GitHub SOURCE_AUTHORITY) ยังอ่าน/เขียนได้เหมือนเดิม
 * และ row เดิมสองแถวไม่ต้อง migrate นี่คือ **ชนิดใหม่ที่อยู่ข้าง ๆ ไม่ใช่ตัวแทน**
 *
 * WHY THIS EXISTS. `ConnectionRegistration` มี `ConnectionType` เดียวคือ
 * SOURCE_AUTHORITY และ `target` เป็น `GithubRepositoryTarget` เท่านั้น
 * connection ที่มีหลักฐานจริงอย่าง Railway / Supabase / n8n / DigitalOcean / MCP
 * จึงลงทะเบียนไม่ได้เชิงโครงสร้าง — เป็น CONTRACT MODEL GAP ไม่ใช่เหตุผลให้
 * สร้าง integration ใหม่ (ดู governance/architecture-rules/CONNECTION_CONTRACT_PHASE_A.md)
 *
 * Connection != Capability : capability บอกว่าระบบทำอะไรได้
 *                            connection บอกว่ามันเชื่อมไปที่ไหนอย่างไร
 * Connection != Flow       : connection บอกว่า "มีช่องทางอะไร"
 *                            FLOW_SENDS_TO บอกว่า "อะไรไหลผ่านช่องทางนั้น"
 *                            ห้ามรวมสองเรื่องนี้เป็น record เดียว
 *
 * Input: none (type definitions ล้วน).
 * Dependency ที่อนุญาต: ./connection.ts (type `CredentialReference` เท่านั้น).
 * สิ่งที่ห้ามแตะ: `credential_ref` เป็น reference เสมอ ห้ามขยายให้เก็บค่า secret
 * ไม่ว่าในไฟล์นี้หรือใน consumer ใด และห้ามเพิ่ม ConnectionType ที่ตั้งชื่อตาม
 * provider (RAILWAY / SUPABASE / N8N) — type ต้องอธิบาย "หน้าที่ของ connection"
 */

import type { ConnectionRegistration } from "./connection";

/** pointer เท่านั้น — ใช้ชนิดเดียวกับ ConnectionRegistration ไม่สร้างช่องทาง credential ใหม่ */
export type CredentialReference = ConnectionRegistration["credential_ref"];

/**
 * หน้าที่ของ connection — ห้ามตั้งตามชื่อ provider
 * ทุกค่า derive จาก semantics ของ connection ที่พบจริงในรีโปนี้
 */
export type DeclaredConnectionType =
  /** มีสิทธิ์เหนือ source ของซอฟต์แวร์ (เช่น เขียน commit) — ของเดิมของ GitHub */
  | "SOURCE_AUTHORITY"
  /** แพลตฟอร์มที่รัน deployment — ตั้งชื่อว่า PLATFORM ไม่ใช่ CONTROL เพราะสิทธิ์ที่ลงทะเบียนจริงคืออ่านสถานะ */
  | "DEPLOYMENT_PLATFORM"
  /** ติดตั้ง/ตรวจ secret บนบริการภายนอก — ไม่ใช่ DATABASE_ACCESS เพราะไม่เคย query ตาราง */
  | "SECRET_PROVISIONING"
  /** สร้าง/อ่าน/แก้ workflow บนเครื่องมือ orchestration */
  | "WORKFLOW_CONTROL"
  /** อ่านคลังทรัพยากรของผู้ให้บริการโครงสร้างพื้นฐาน */
  | "INFRASTRUCTURE_PROVIDER"
  /** DNA OS เปิดช่องให้ผู้อื่นเรียกเข้ามาใช้ tool ของตัวเอง (ขาเข้า) */
  | "TOOL_INGRESS"
  /**
   * ควบคุมบัญชี social ที่ Owner เป็นเจ้าของผ่าน OAuth (เช่น TikTok Login Kit) —
   * ตั้งชื่อว่า SOCIAL_ACCOUNT ไม่ใช่ SOURCE_AUTHORITY เพราะสิทธิ์ที่ลงทะเบียนจริง
   * คือ scope ของ user access token ไม่ใช่การเขียน source ของซอฟต์แวร์
   */
  | "SOCIAL_ACCOUNT";

/** ทิศทางจริงของช่องทาง — ต้อง derive จากหลักฐาน ไม่ใช่สมมติว่าทุกอย่างเป็นขาออก */
export type ConnectionDirection = "OUTBOUND" | "INBOUND" | "BIDIRECTIONAL" | "LOCAL";

export type ConnectionProtocol =
  | "HTTPS_REST" | "HTTPS_GRAPHQL" | "HTTPS_WEBHOOK"
  | "HTTP_JSONRPC" | "LOCAL_CLI" | "STDIO";

/**
 * DECLARED  เอกสาร/คอนฟิกบอกว่ามี
 * OBSERVED  runtime เคยเห็นปลายทางตอบจริง
 * PROVEN    ผ่าน deterministic verification พร้อม evidence
 * CONFIGURATION_DRIFT  สิ่งที่ประกาศไว้กับสิ่งที่สังเกตเห็นไม่ตรงกัน และยังตัดสินไม่ได้
 */
export type DeclaredConnectionState = "DECLARED" | "OBSERVED" | "PROVEN" | "CONFIGURATION_DRIFT";

/** RESOLVED ได้เฉพาะเมื่อ canonical_target_id ชี้ไป entity ที่มีอยู่จริง */
export type TargetResolution = "RESOLVED" | "UNRESOLVED";

export interface ConnectionDeclaration {
  readonly connection_id: string;
  readonly connection_type: DeclaredConnectionType;
  readonly direction: ConnectionDirection;

  /** ฝั่งที่เป็นเจ้าของช่องทางนี้ (software_id ของ DNA OS เอง) */
  readonly source_id: string;
  readonly provider_id: string;

  /**
   * ปลายทางตามที่โค้ดใช้จริง เช่น { owner, repository, branch } หรือ { project_ref }
   * — เป็นค่าที่อ่านได้จาก source ไม่ใช่ display name ที่ตั้งขึ้น
   */
  readonly target_descriptor: Readonly<Record<string, string>>;
  /** null เมื่อยังไม่มี canonical entity ให้ชี้ — ห้ามสร้าง id ปลอมมาใส่ */
  readonly canonical_target_id: string | null;
  readonly target_resolution: TargetResolution;

  readonly protocol: ConnectionProtocol;
  readonly endpoint: string;

  /** ไฟล์/โมดูลที่เป็นขอบเขตการเรียกจริง */
  readonly execution_boundary: string;
  readonly executor_capability_id: string | null;

  /** pointer เท่านั้น — null เมื่อช่องทางนั้นไม่ต้องใช้ credential (เช่น local) */
  readonly credential_ref: CredentialReference | null;
  readonly credential_scope: readonly string[];

  readonly input_contract: readonly string[];
  readonly output_contract: readonly string[];

  /** ที่มาของค่าที่ต้องตั้ง เช่นชื่อไฟล์ที่ประกาศ constant ไว้ */
  readonly configuration_source: string;

  readonly health_probe: string | null;
  readonly verification_method: string | null;
  readonly verification_evidence_id: string | null;

  readonly state: DeclaredConnectionState;
  readonly declared_at: string;

  /**
   * ADDITIVE (2026-09-01) — อ้างถึง `ConnectionRegistration` ที่เป็นเจ้าของ
   * วงจรอนุมัติสิทธิ์ของช่องทางนี้
   *
   *   null / undefined = ช่องทางนี้ไม่ต้องมีการอนุมัติ (เช่น MCP ที่เป็น INBOUND
   *                      local) **หรือ** ยังไม่มี registration ที่พิสูจน์ได้
   *   non-null         = connection_id ของ ConnectionRegistration ที่มีอยู่จริง
   *
   * เก็บได้เฉพาะ **การอ้างอิง** — ห้ามคัดลอกสถานะวงจรอนุมัติ
   * (connecting/connected/error) เข้ามาไว้ที่นี่ เพราะ registration เป็น record
   * ที่แก้ไขได้ ส่วน declaration เป็น append-only สำเนาจะค้างเป็นค่าเก่าทันที
   * ที่ registration เปลี่ยน
   *
   * optional เพื่อให้ 6 declaration ที่ลงทะเบียนไปแล้วก่อนหน้านี้ยังใช้ได้
   * โดยไม่ต้องเขียนทับ
   */
  readonly authorized_by_connection_id?: string | null;
}

export type ConnectionDeclarationInput = Omit<ConnectionDeclaration, "connection_id" | "declared_at">;

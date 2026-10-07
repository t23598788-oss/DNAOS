/**
 * หน้าที่: write/read path จริงของ `ConnectionDeclaration` — ADDITIVE ข้าง ๆ
 * `./registry.ts` ไม่ใช่ตัวแทนของมัน
 *
 * `./registry.ts` (ConnectionRegistration, GitHub SOURCE_AUTHORITY) ยังทำงาน
 * เหมือนเดิมทุกประการ ไฟล์นี้ไม่ import และไม่แก้ไฟล์นั้นเลย ใช้ไฟล์ข้อมูล
 * คนละไฟล์ (`data/connection-declarations.jsonl`) จึงไม่มีทางทำให้ row เดิมเสีย
 *
 * ยืมกติกาเดิมทุกข้อ ไม่ประดิษฐ์ใหม่:
 *   - identity เป็น deterministic string ที่อ่านได้ ไม่ hash
 *   - append-only JSONL, "latest record per connection_id wins"
 *   - ลงทะเบียนซ้ำด้วย identity เดิม = idempotent ไม่เกิดแถวซ้ำ
 *
 * Input: `ConnectionDeclarationInput`.
 * Output: `registerConnectionDeclaration`, `lookupConnectionDeclaration`,
 * `listConnectionDeclarations`, `buildDeclarationId`, `validateConnectionDeclaration`.
 * Dependency ที่อนุญาต: ../../contracts/connector/connection-declaration.ts (types), node:fs, node:path.
 * สิ่งที่ห้ามแตะ: ห้ามให้ค่า secret ผ่าน validation เข้ามาได้ และห้ามให้
 * target_resolution = RESOLVED เมื่อ canonical_target_id เป็น null
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lookupConnection } from "./registry";
import type {
  ConnectionDeclaration, ConnectionDeclarationInput,
  DeclaredConnectionType, ConnectionDirection, ConnectionProtocol, DeclaredConnectionState,
} from "../../contracts/connector/connection-declaration";

const DATA_DIR = join(__dirname, "data");
const DATA_FILE = join(DATA_DIR, "connection-declarations.jsonl");

const CONNECTION_TYPES: readonly DeclaredConnectionType[] = [
  "SOURCE_AUTHORITY", "DEPLOYMENT_PLATFORM", "SECRET_PROVISIONING",
  "WORKFLOW_CONTROL", "INFRASTRUCTURE_PROVIDER", "TOOL_INGRESS",
  // Owner-approved 2026-09-01: บัญชี social ที่ควบคุมผ่าน OAuth (TikTok Login Kit)
  "SOCIAL_ACCOUNT",
];
const DIRECTIONS: readonly ConnectionDirection[] = ["OUTBOUND", "INBOUND", "BIDIRECTIONAL", "LOCAL"];
const PROTOCOLS: readonly ConnectionProtocol[] = [
  "HTTPS_REST", "HTTPS_GRAPHQL", "HTTPS_WEBHOOK", "HTTP_JSONRPC", "LOCAL_CLI", "STDIO",
];
const STATES: readonly DeclaredConnectionState[] = ["DECLARED", "OBSERVED", "PROVEN", "CONFIGURATION_DRIFT"];

/** ค่าที่ดูเหมือน secret จริง — กันไว้ที่ประตู ไม่ใช่หวังว่าผู้เรียกจะไม่ส่งมา */
const SECRET_SHAPE = /^(gh[pousr]_|sk-|xox[baprs]-|eyJ[A-Za-z0-9_-]{10,}|[A-Za-z0-9_-]{40,})$/;

export type DeclarationRejectReason =
  | "UNKNOWN_CONNECTION_TYPE" | "UNKNOWN_DIRECTION" | "UNKNOWN_PROTOCOL" | "UNKNOWN_STATE"
  | "EMPTY_ENDPOINT" | "EMPTY_PROVIDER_ID" | "EMPTY_SOURCE_ID" | "EMPTY_EXECUTION_BOUNDARY"
  | "EMPTY_TARGET_DESCRIPTOR" | "TARGET_RESOLUTION_MISMATCH"
  | "CREDENTIAL_NOT_A_POINTER" | "SECRET_VALUE_PRESENT"
  | "PROVEN_WITHOUT_EVIDENCE" | "AUTHORIZATION_REFERENCE_NOT_FOUND";

export interface DeclarationValidation {
  readonly ok: boolean;
  readonly reasons: readonly DeclarationRejectReason[];
}

/**
 * ตรวจแบบ deterministic ล้วน — กฎเดียวกันให้ผลเดียวกันเสมอ ไม่มี heuristic
 * ไม่มีโมเดล ไม่มีการเดา
 */
export function validateConnectionDeclaration(input: ConnectionDeclarationInput): DeclarationValidation {
  const reasons: DeclarationRejectReason[] = [];

  if (!CONNECTION_TYPES.includes(input.connection_type)) reasons.push("UNKNOWN_CONNECTION_TYPE");
  if (!DIRECTIONS.includes(input.direction)) reasons.push("UNKNOWN_DIRECTION");
  if (!PROTOCOLS.includes(input.protocol)) reasons.push("UNKNOWN_PROTOCOL");
  if (!STATES.includes(input.state)) reasons.push("UNKNOWN_STATE");

  if (!input.endpoint?.trim()) reasons.push("EMPTY_ENDPOINT");
  if (!input.provider_id?.trim()) reasons.push("EMPTY_PROVIDER_ID");
  if (!input.source_id?.trim()) reasons.push("EMPTY_SOURCE_ID");
  if (!input.execution_boundary?.trim()) reasons.push("EMPTY_EXECUTION_BOUNDARY");

  // target_descriptor เป็น REQUIRED (OPTION_A) — ช่องทางที่ไม่รู้ปลายทางไม่ใช่ช่องทาง
  const descriptorKeys = Object.keys(input.target_descriptor ?? {});
  if (descriptorKeys.length === 0) reasons.push("EMPTY_TARGET_DESCRIPTOR");

  // ★ invariant หลักของ OPTION_A: RESOLVED ได้ก็ต่อเมื่อมี canonical id จริง
  const hasCanonical = typeof input.canonical_target_id === "string" && input.canonical_target_id.length > 0;
  if (hasCanonical !== (input.target_resolution === "RESOLVED")) reasons.push("TARGET_RESOLUTION_MISMATCH");

  if (input.credential_ref !== null) {
    const kind = (input.credential_ref as { kind?: string }).kind;
    if (kind !== "env_var" && kind !== "keychain_ref" && kind !== "not_yet_built") reasons.push("CREDENTIAL_NOT_A_POINTER");
  }

  // ไม่มีค่าใดในทั้ง record ที่มีรูปร่างเป็น secret
  const scan = [
    input.endpoint, input.provider_id, input.source_id, input.configuration_source,
    ...Object.values(input.target_descriptor ?? {}),
    ...(input.credential_scope ?? []),
  ];
  if (scan.some((v) => typeof v === "string" && SECRET_SHAPE.test(v.trim()))) reasons.push("SECRET_VALUE_PRESENT");

  // PROVEN ต้องมีหลักฐาน ไม่ใช่คำประกาศ
  if (input.state === "PROVEN" && !input.verification_evidence_id?.trim()) reasons.push("PROVEN_WITHOUT_EVIDENCE");

  // authorized_by_connection_id ถ้าใส่มา ต้องชี้ไป ConnectionRegistration ที่มีอยู่จริง
  // ตรวจแบบ deterministic: หาเจอหรือไม่เจอ ไม่มีการเดา
  const authRef = input.authorized_by_connection_id ?? null;
  if (authRef && !lookupConnection({ connection_id: authRef })) reasons.push("AUTHORIZATION_REFERENCE_NOT_FOUND");

  return { ok: reasons.length === 0, reasons };
}

/** identity ที่อ่านได้และคำนวณซ้ำได้ — ไม่ hash เหมือน buildConnectionId() เดิม */
export function buildDeclarationId(input: {
  provider_id: string; connection_type: string; direction: string;
  target_descriptor: Readonly<Record<string, string>>;
}): string {
  const target = Object.keys(input.target_descriptor).sort()
    .map((k) => `${k}=${input.target_descriptor[k]}`).join(",");
  return `connection-declaration://${input.provider_id}/${input.connection_type}/${input.direction}/${target}`;
}

function readAll(): ConnectionDeclaration[] {
  if (!existsSync(DATA_FILE)) return [];
  const byId = new Map<string, ConnectionDeclaration>();
  for (const line of readFileSync(DATA_FILE, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as ConnectionDeclaration;
      byId.set(row.connection_id, row); // latest wins — กติกาเดียวกับ registry เดิม
    } catch { /* บรรทัดเสียหนึ่งบรรทัดต้องไม่ทำให้ทั้งไฟล์อ่านไม่ได้ */ }
  }
  return [...byId.values()];
}

export interface RegisterDeclarationResult {
  readonly status: "REGISTERED" | "DUPLICATE" | "REJECTED";
  readonly declaration: ConnectionDeclaration | null;
  readonly reasons: readonly DeclarationRejectReason[];
}

export function registerConnectionDeclaration(
  input: ConnectionDeclarationInput,
  now: () => string = () => new Date().toISOString(),
): RegisterDeclarationResult {
  const validation = validateConnectionDeclaration(input);
  if (!validation.ok) return { status: "REJECTED", declaration: null, reasons: validation.reasons };

  const connection_id = buildDeclarationId(input);
  const existing = readAll().find((d) => d.connection_id === connection_id);
  if (existing) return { status: "DUPLICATE", declaration: existing, reasons: [] };

  const declaration: ConnectionDeclaration = { ...input, connection_id, declared_at: now() };
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  appendFileSync(DATA_FILE, `${JSON.stringify(declaration)}\n`, { encoding: "utf8", mode: 0o600 });
  return { status: "REGISTERED", declaration, reasons: [] };
}

export function lookupConnectionDeclaration(connection_id: string): ConnectionDeclaration | null {
  return readAll().find((d) => d.connection_id === connection_id) ?? null;
}

export function listConnectionDeclarations(): readonly ConnectionDeclaration[] {
  return readAll();
}

/**
 * หน้าที่: write/read path เดียวของ Provider Project **identity**
 *
 * ยืมกติกาที่ทะเบียนอื่นในรีโปนี้ใช้อยู่แล้วทุกข้อ ไม่ประดิษฐ์ใหม่:
 *   - identity เป็นสตริงที่คำนวณซ้ำได้และอ่านออก ไม่ hash
 *     (แบบเดียวกับ buildRepositoryId / buildConnectionId / buildDeclarationId)
 *   - append-only JSONL, latest-per-id wins
 *   - ลงทะเบียนซ้ำด้วย identity เดิม = REUSED ไม่เกิดแถวซ้ำ
 *
 * การเทียบตัวตนเป็น **string comparison ของ natural key ล้วน**
 * ไม่มี fuzzy ไม่มี similarity ไม่มีโมเดล — AI ไม่มีสิทธิ์ตัดสินว่าสองตัวตนเท่ากัน
 *
 * Dependency ที่อนุญาต: ./types.ts, node:fs, node:path.
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่ม field ที่เก็บ secret หรือสถานะที่เปลี่ยนได้
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ProviderProjectRegistration, RegisterProviderProjectInput,
  RegisterProviderProjectResult, ProviderIdentifiers,
} from "./types";

const DATA_DIR = join(__dirname, "data");
const DATA_FILE = join(DATA_DIR, "provider-projects.jsonl");

/** ค่าที่ดูเหมือน secret — กันไว้ที่ประตู ทะเบียนนี้ไม่รับ credential ทุกรูปแบบ */
const SECRET_SHAPE = /^(gh[pousr]_|sk-|xox[baprs]-|eyJ[A-Za-z0-9_-]{10,}|[A-Za-z0-9_-]{40,})$/;

/**
 * natural key = provider + identifiers ที่เรียงคีย์แล้ว
 * เรียงเพื่อให้ลำดับที่ผู้เรียกส่งมาไม่มีผลต่อตัวตน
 */
export function buildProviderProjectId(provider_id: string, identifiers: ProviderIdentifiers): string {
  const key = Object.keys(identifiers).sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(identifiers[k])}`)
    .join(",");
  return `provider-project://${encodeURIComponent(provider_id)}/${key}`;
}

function readAll(): ProviderProjectRegistration[] {
  if (!existsSync(DATA_FILE)) return [];
  const byId = new Map<string, ProviderProjectRegistration>();
  for (const line of readFileSync(DATA_FILE, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as ProviderProjectRegistration;
      byId.set(row.provider_project_id, row);
    } catch { /* บรรทัดเสียหนึ่งบรรทัดต้องไม่ทำให้ทั้งไฟล์อ่านไม่ได้ */ }
  }
  return [...byId.values()];
}

const sameIdentifiers = (a: ProviderIdentifiers, b: ProviderIdentifiers): boolean => {
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
};

export function registerProviderProject(
  input: RegisterProviderProjectInput,
  now: () => string = () => new Date().toISOString(),
): RegisterProviderProjectResult {
  if (!input.provider_id?.trim()) {
    return { status: "UNRESOLVED", registration: null, reason: "provider_id ว่าง" };
  }
  const keys = Object.keys(input.identifiers ?? {});
  if (keys.length === 0) {
    // DigitalOcean ตกที่นี่ — ไม่มีตัวระบุที่ผู้ให้บริการออกให้ในหลักฐานที่มี
    return { status: "UNRESOLVED", registration: null, reason: "ไม่มี identifier ที่ผู้ให้บริการออกให้ ประกอบ natural key ไม่ได้" };
  }
  if (keys.some((k) => !String(input.identifiers[k] ?? "").trim())) {
    return { status: "UNRESOLVED", registration: null, reason: "มี identifier ที่ค่าว่าง" };
  }
  if (Object.values(input.identifiers).some((v) => SECRET_SHAPE.test(v.trim()))) {
    return { status: "UNRESOLVED", registration: null, reason: "ค่ามีรูปร่างเป็น secret — ทะเบียนนี้เก็บเฉพาะตัวตน" };
  }
  if (!input.verified_by?.length) {
    return { status: "UNRESOLVED", registration: null, reason: "ไม่มี verified_by — ตัวตนต้องมาจากหลักฐานที่อ้างอิงได้" };
  }

  const provider_project_id = buildProviderProjectId(input.provider_id, input.identifiers);
  const existing = readAll().find((r) => r.provider_project_id === provider_project_id);
  if (existing) {
    if (sameIdentifiers(existing.identifiers, input.identifiers)) {
      return { status: "REUSED", registration: existing, reason: null };
    }
    // natural key ชนกันแต่เนื้อในต่าง — ห้ามเดาว่าอันไหนถูก
    return { status: "CONFLICT", registration: existing, reason: "natural key เดียวกันแต่ identifiers ต่างกัน" };
  }

  const registration: ProviderProjectRegistration = {
    provider_project_id, provider_id: input.provider_id,
    identifiers: { ...input.identifiers }, verified_by: [...input.verified_by],
    registered_at: now(),
  };
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  appendFileSync(DATA_FILE, `${JSON.stringify(registration)}\n`, { encoding: "utf8", mode: 0o600 });
  return { status: "REGISTERED", registration, reason: null };
}

export function getProviderProject(provider_project_id: string): ProviderProjectRegistration | null {
  return readAll().find((r) => r.provider_project_id === provider_project_id) ?? null;
}

export function listProviderProjects(): readonly ProviderProjectRegistration[] {
  return readAll();
}

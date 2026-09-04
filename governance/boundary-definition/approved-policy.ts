/**
 * R2 · นโยบายที่ Owner อนุมัติแล้ว — เป็นหลักฐาน ไม่ใช่การเดา
 *
 * อนุมัติ 2026-09-04 ทั้งชุด:
 *   กฎเหล็กห้าม Agent เขียนเข้าแกนหลัก · สิทธิ์จำกัดตามระดับความเสี่ยง
 *   external_commit_authority = false ทุกตัวไม่มีข้อยกเว้น
 *   cost_policy = ZERO_SPEND ทุกตัว
 *   UNVERIFIABLE = BLOCKED ห้ามรันหรือโหลดเข้าหน่วยความจำ
 *
 * ระดับความเสี่ยงมาจากพฤติกรรมจริงในซอร์ส (risk-classification.jsonl)
 * ไม่ได้มาจากชื่อโมดูล
 */
import { existsSync, readFileSync } from "node:fs";
import type { Cited } from "./source-evidence";
import { cite } from "./source-evidence";

const POLICY = "governance/boundary-definition/data/APPROVED-default-policy.json";
const RISK = "governance/boundary-definition/data/risk-classification.jsonl";
const CITE = `${POLICY} — อนุมัติโดย Owner 2026-09-04`;

export type Tier = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNVERIFIABLE";

let tiers: Map<string, Tier> | null = null;
function loadTiers(): Map<string, Tier> {
  if (tiers !== null) return tiers;
  const m = new Map<string, Tier>();
  if (existsSync(RISK)) {
    for (const line of readFileSync(RISK, "utf8").split("\n")) {
      const s = line.trim();
      if (!s) continue;
      try {
        const r = JSON.parse(s) as { canonical_id: string; tier: Tier };
        m.set(r.canonical_id, r.tier);
      } catch { /* บรรทัดเสียหนึ่งบรรทัดไม่ล้มทั้งไฟล์ */ }
    }
  }
  tiers = m;
  return m;
}

export function tierOf(capabilityId: string): Tier | null {
  return loadTiers().get(capabilityId) ?? null;
}

function policyApproved(): boolean {
  if (!existsSync(POLICY)) return false;
  try {
    const d = JSON.parse(readFileSync(POLICY, "utf8")) as { status?: string };
    return d.status === "APPROVED_BY_OWNER";
  } catch { return false; }
}

/** ทั้งเก้าฟิลด์นโยบาย — ค่าตามระดับความเสี่ยง ทุกค่าอ้างการอนุมัติเดียวกัน */
export interface PolicyFields {
  may_request: Cited<string[]>;
  approval_requirement: Cited<string>;
  external_commit_authority: Cited<string>;
  cost_policy: Cited<string>;
  concurrency_policy: Cited<string>;
  availability_requirement: Cited<string>;
  service_requirement: Cited<string[]>;
  validation_requirements: Cited<string[]>;
  persistence: Cited<string[]>;
}

export function policyFor(capabilityId: string): PolicyFields | null {
  if (!policyApproved()) return null;
  const t = tierOf(capabilityId);
  if (t === null) return null;
  const why = `${CITE} · tier=${t} (วัดจากพฤติกรรมในซอร์ส)`;

  const may_request =
    t === "UNVERIFIABLE" ? [] :
    t === "CRITICAL" ? ["owner-only"] : ["dna-os-control-plane"];

  const approval =
    t === "UNVERIFIABLE" ? "BLOCKED_UNTIL_SOURCE_RESOLVABLE" :
    t === "CRITICAL" ? "REQUIRED_OWNER_APPROVAL_PER_INVOCATION" :
    t === "HIGH" ? "REQUIRED_OWNER_APPROVAL" :
    t === "MEDIUM" ? "REQUIRED_OWNER_APPROVAL_FOR_EXTERNAL_EFFECT" :
    "NOT_REQUIRED_FOR_READ_ONLY";

  const concurrency = t === "CRITICAL" ? "SINGLE_FLIGHT_GLOBAL_LOCK" : "SINGLE_FLIGHT";
  const persistence =
    t === "CRITICAL" ? "APPEND_ONLY_EVIDENCE_ONLY" : "NO_PERSISTENCE_BEYOND_OWN_CAPABILITY_FOLDER";

  return {
    may_request: cite(may_request, why),
    approval_requirement: cite(approval, why),
    // ปิดตายทุกตัวตามที่อนุมัติ — ไม่มีเงื่อนไขใดเปิดได้ในโค้ดนี้
    external_commit_authority: cite("false", `${CITE} — ปิด 100% ทุกตัวโดยไม่มีข้อยกเว้น`),
    cost_policy: cite("ZERO_SPEND", `${CITE} — งบศูนย์ ห้ามยิง API ภายนอกโดยไม่ผ่านการอนุญาต`),
    concurrency_policy: cite(concurrency, why),
    availability_requirement: cite("BEST_EFFORT", why),
    service_requirement: cite([], `${CITE} — ไม่มีสิทธิ์เรียกบริการใดจนกว่าจะระบุเพิ่ม`),
    validation_requirements: cite(
      ["FAIL_CLOSED_ON_UNKNOWN_FIELD", "REJECT_ABSOLUTE_PATH", "REJECT_PATH_TRAVERSAL", "REJECT_NUL_IN_STRING"],
      why,
    ),
    persistence: cite([persistence], why),
  };
}

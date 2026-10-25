/**
 * Threat Pattern Registry (owner, 2026-08-08, Software Factory Step
 * 13.25, Section 8). Declares real pattern CLASS names the system may
 * observe/learn from real, already-collected Monitoring/Incident data —
 * never real signatures, never real detection logic, never an Execute
 * path. Every entry is honestly NOT_IMPLEMENTED (no real correlation
 * engine exists for these specific classes yet) — this is a taxonomy
 * for future, human-approved detection work, not a working detector.
 */
export type ThreatPatternId =
  | "ATTACK_PATTERN" | "EXPLOIT_PATTERN" | "API_ABUSE" | "CREDENTIAL_ABUSE" | "REPLAY_PATTERN"
  | "SCANNING_PATTERN" | "MALWARE_PATTERN" | "LATERAL_MOVEMENT" | "PERSISTENCE" | "PRIVILEGE_ESCALATION";

export interface ThreatPatternDefinition {
  id: ThreatPatternId;
  name: string;
  name_th: string;
  description: string;
  status: "NOT_IMPLEMENTED";
}

export const THREAT_PATTERN_REGISTRY: Record<ThreatPatternId, ThreatPatternDefinition> = {
  ATTACK_PATTERN: { id: "ATTACK_PATTERN", name: "Attack Pattern", name_th: "รูปแบบการโจมตี", description: "General attack pattern class taxonomy — no real correlation engine implemented.", status: "NOT_IMPLEMENTED" },
  EXPLOIT_PATTERN: { id: "EXPLOIT_PATTERN", name: "Exploit Pattern", name_th: "รูปแบบการเจาะระบบ", description: "Exploit pattern class taxonomy — no real correlation engine implemented.", status: "NOT_IMPLEMENTED" },
  API_ABUSE: { id: "API_ABUSE", name: "API Abuse", name_th: "การใช้ API ในทางที่ผิด", description: "API abuse pattern class taxonomy — could reuse real executionRegistry.ts rate/deny data in a future Step.", status: "NOT_IMPLEMENTED" },
  CREDENTIAL_ABUSE: { id: "CREDENTIAL_ABUSE", name: "Credential Abuse", name_th: "การใช้ข้อมูลรับรองในทางที่ผิด", description: "Credential abuse pattern class taxonomy — no real correlation engine implemented.", status: "NOT_IMPLEMENTED" },
  REPLAY_PATTERN: { id: "REPLAY_PATTERN", name: "Replay Pattern", name_th: "รูปแบบการเล่นซ้ำ", description: "Replay pattern class taxonomy — no real correlation engine implemented.", status: "NOT_IMPLEMENTED" },
  SCANNING_PATTERN: { id: "SCANNING_PATTERN", name: "Scanning Pattern", name_th: "รูปแบบการสแกน", description: "Scanning pattern class taxonomy — no real correlation engine implemented.", status: "NOT_IMPLEMENTED" },
  MALWARE_PATTERN: { id: "MALWARE_PATTERN", name: "Malware Pattern", name_th: "รูปแบบมัลแวร์", description: "Malware behavior pattern class taxonomy — no real signatures stored, no real correlation engine implemented.", status: "NOT_IMPLEMENTED" },
  LATERAL_MOVEMENT: { id: "LATERAL_MOVEMENT", name: "Lateral Movement", name_th: "การเคลื่อนที่ในแนวข้าง", description: "Lateral movement pattern class taxonomy — no real correlation engine implemented.", status: "NOT_IMPLEMENTED" },
  PERSISTENCE: { id: "PERSISTENCE", name: "Persistence", name_th: "การฝังตัวคงอยู่", description: "Persistence pattern class taxonomy — no real correlation engine implemented.", status: "NOT_IMPLEMENTED" },
  PRIVILEGE_ESCALATION: { id: "PRIVILEGE_ESCALATION", name: "Privilege Escalation", name_th: "การยกระดับสิทธิ์", description: "Privilege escalation pattern class taxonomy — could reuse real registry/permissions.json role model in a future Step.", status: "NOT_IMPLEMENTED" },
};

export function listThreatPatterns(): ThreatPatternDefinition[] {
  return Object.values(THREAT_PATTERN_REGISTRY);
}

/**
 * Security Knowledge Registry (owner, 2026-08-08, Software Factory Step
 * 13.25, Section 1). Declares real Knowledge Category TAXONOMY only —
 * never exploit code, never attack payloads, never operational
 * step-by-step technique detail. Every category is READ_ONLY by
 * construction: this file exports no mutation function, and no other
 * file in this Runtime ever executes anything from these categories —
 * securityKnowledgeRuntime.ts only ever reads this array.
 */
export type KnowledgeCategoryId =
  | "RECON" | "ENUMERATION" | "NETWORK" | "API" | "AUTHENTICATION" | "SESSION"
  | "FIRMWARE" | "HARDWARE" | "EMBEDDED_SYSTEMS" | "PLC" | "IOT" | "CLOUD"
  | "INFRASTRUCTURE" | "CONTAINER" | "DATABASE" | "IDENTITY" | "MALWARE_PATTERN"
  | "THREAT_INTELLIGENCE" | "DIGITAL_FORENSICS" | "INCIDENT_RESPONSE"
  | "RECOVERY_STRATEGY" | "DETECTION_STRATEGY" | "MITIGATION_STRATEGY" | "EVIDENCE_STRATEGY";

export interface KnowledgeCategoryDefinition {
  id: KnowledgeCategoryId;
  name: string;
  name_th: string;
  description: string;
  readOnly: true;
  relatedRealFiles: string[];
  status: "DECLARED" | "PARTIAL" | "NOT_IMPLEMENTED";
}

export const SECURITY_KNOWLEDGE_REGISTRY: Record<KnowledgeCategoryId, KnowledgeCategoryDefinition> = {
  RECON: { id: "RECON", name: "Reconnaissance Knowledge", name_th: "องค์ความรู้การสำรวจเป้าหมาย", description: "Taxonomy of real recon concepts (passive/active, OSINT categories) — knowledge only, never a scanning engine.", readOnly: true, relatedRealFiles: [], status: "DECLARED" },
  ENUMERATION: { id: "ENUMERATION", name: "Enumeration Knowledge", name_th: "องค์ความรู้การแจกแจงเป้าหมาย", description: "Taxonomy of enumeration concepts (service/user/asset enumeration classes) — knowledge only.", readOnly: true, relatedRealFiles: [], status: "DECLARED" },
  NETWORK: { id: "NETWORK", name: "Network Knowledge", name_th: "องค์ความรู้เครือข่าย", description: "Taxonomy of network protocol/topology concepts — knowledge only, no packet capture/injection capability.", readOnly: true, relatedRealFiles: [], status: "DECLARED" },
  API: { id: "API", name: "API Knowledge", name_th: "องค์ความรู้ API", description: "Taxonomy of real API security concepts (auth flow, rate limiting, contract validation) — reuses this repo's own real API surface as reference.", readOnly: true, relatedRealFiles: ["engines/shared/ide-lib/executionRegistry.ts", "core/auth/requireAuth.ts"], status: "DECLARED" },
  AUTHENTICATION: { id: "AUTHENTICATION", name: "Authentication Knowledge", name_th: "องค์ความรู้การยืนยันตัวตน", description: "Taxonomy of real authentication concepts (session, token, MFA classes) — reuses this repo's own real auth model as reference.", readOnly: true, relatedRealFiles: ["core/auth/session.ts", "core/auth/requireAuth.ts"], status: "DECLARED" },
  SESSION: { id: "SESSION", name: "Session Knowledge", name_th: "องค์ความรู้เซสชัน", description: "Taxonomy of session lifecycle/fixation/hijack concept classes — knowledge only.", readOnly: true, relatedRealFiles: [], status: "DECLARED" },
  FIRMWARE: { id: "FIRMWARE", name: "Firmware Knowledge", name_th: "องค์ความรู้เฟิร์มแวร์", description: "Taxonomy of firmware structure/update/verification concept classes — knowledge only, no extraction/flashing capability.", readOnly: true, relatedRealFiles: [], status: "DECLARED" },
  HARDWARE: { id: "HARDWARE", name: "Hardware Knowledge", name_th: "องค์ความรู้ฮาร์ดแวร์", description: "Taxonomy of hardware interface/debug concept classes — knowledge only.", readOnly: true, relatedRealFiles: [], status: "DECLARED" },
  EMBEDDED_SYSTEMS: { id: "EMBEDDED_SYSTEMS", name: "Embedded Systems Knowledge", name_th: "องค์ความรู้ระบบฝังตัว", description: "Taxonomy of embedded runtime/RTOS concept classes — knowledge only.", readOnly: true, relatedRealFiles: [], status: "DECLARED" },
  PLC: { id: "PLC", name: "PLC Knowledge", name_th: "องค์ความรู้ PLC", description: "Taxonomy of industrial PLC/ladder-logic concept classes — knowledge only, no control-write capability.", readOnly: true, relatedRealFiles: [], status: "DECLARED" },
  IOT: { id: "IOT", name: "IoT Knowledge", name_th: "องค์ความรู้ IoT", description: "Taxonomy of IoT device/protocol concept classes — knowledge only.", readOnly: true, relatedRealFiles: [], status: "DECLARED" },
  CLOUD: { id: "CLOUD", name: "Cloud Knowledge", name_th: "องค์ความรู้คลาวด์", description: "Taxonomy of real cloud service/IAM concept classes — reuses this repo's own real Infrastructure Observer as reference.", readOnly: true, relatedRealFiles: ["registry/infrastructure.json"], status: "DECLARED" },
  INFRASTRUCTURE: { id: "INFRASTRUCTURE", name: "Infrastructure Knowledge", name_th: "องค์ความรู้โครงสร้างพื้นฐาน", description: "Taxonomy of real infrastructure dependency concept classes — reuses the real Global Factory Runtime Dependency Graph.", readOnly: true, relatedRealFiles: ["engines/shared/ide-lib/globalFactoryRuntime.ts"], status: "DECLARED" },
  CONTAINER: { id: "CONTAINER", name: "Container Knowledge", name_th: "องค์ความรู้คอนเทนเนอร์", description: "Taxonomy of container isolation/escape concept classes — knowledge only.", readOnly: true, relatedRealFiles: [], status: "DECLARED" },
  DATABASE: { id: "DATABASE", name: "Database Knowledge", name_th: "องค์ความรู้ฐานข้อมูล", description: "Taxonomy of database injection/access-control concept classes — knowledge only.", readOnly: true, relatedRealFiles: [], status: "DECLARED" },
  IDENTITY: { id: "IDENTITY", name: "Identity Knowledge", name_th: "องค์ความรู้อัตลักษณ์", description: "Taxonomy of identity/credential concept classes — reuses this repo's own real role/tier model.", readOnly: true, relatedRealFiles: ["registry/permissions.json"], status: "DECLARED" },
  MALWARE_PATTERN: { id: "MALWARE_PATTERN", name: "Malware Pattern Knowledge", name_th: "องค์ความรู้รูปแบบมัลแวร์", description: "Taxonomy of malware behavior CLASS names only (never real signatures/samples/code) — knowledge only.", readOnly: true, relatedRealFiles: [], status: "DECLARED" },
  THREAT_INTELLIGENCE: { id: "THREAT_INTELLIGENCE", name: "Threat Intelligence Knowledge", name_th: "องค์ความรู้ข่าวกรองภัยคุกคาม", description: "Taxonomy of threat-intel concept classes (IOC, TTP framework references) — knowledge only.", readOnly: true, relatedRealFiles: [], status: "DECLARED" },
  DIGITAL_FORENSICS: { id: "DIGITAL_FORENSICS", name: "Digital Forensics Knowledge", name_th: "องค์ความรู้นิติวิทยาศาสตร์ดิจิทัล", description: "Taxonomy of forensic chain-of-custody concept classes — reuses this repo's own real Artifact lineage.", readOnly: true, relatedRealFiles: ["engines/shared/ide-lib/artifactRuntime.ts"], status: "PARTIAL" },
  INCIDENT_RESPONSE: { id: "INCIDENT_RESPONSE", name: "Incident Response Knowledge", name_th: "องค์ความรู้การตอบสนองเหตุการณ์", description: "Taxonomy of IR concept classes — reuses this repo's own real Incident Runtime (Step 12).", readOnly: true, relatedRealFiles: ["engines/shared/ide-lib/incidentRuntime.ts"], status: "PARTIAL" },
  RECOVERY_STRATEGY: { id: "RECOVERY_STRATEGY", name: "Recovery Strategy Knowledge", name_th: "องค์ความรู้กลยุทธ์การกู้คืน", description: "Taxonomy of recovery concept classes — reuses this repo's own real Recovery Runtime (Step 12).", readOnly: true, relatedRealFiles: ["engines/shared/ide-lib/recoveryRuntime.ts"], status: "PARTIAL" },
  DETECTION_STRATEGY: { id: "DETECTION_STRATEGY", name: "Detection Strategy Knowledge", name_th: "องค์ความรู้กลยุทธ์การตรวจจับ", description: "Taxonomy of detection concept classes — reuses this repo's own real Monitoring Runtime (Step 12).", readOnly: true, relatedRealFiles: ["engines/shared/ide-lib/monitoringRuntime.ts"], status: "PARTIAL" },
  MITIGATION_STRATEGY: { id: "MITIGATION_STRATEGY", name: "Mitigation Strategy Knowledge", name_th: "องค์ความรู้กลยุทธ์การบรรเทา", description: "Taxonomy of mitigation concept classes — knowledge only, no auto-mitigation capability.", readOnly: true, relatedRealFiles: [], status: "DECLARED" },
  EVIDENCE_STRATEGY: { id: "EVIDENCE_STRATEGY", name: "Evidence Strategy Knowledge", name_th: "องค์ความรู้กลยุทธ์หลักฐาน", description: "Taxonomy of evidence-handling concept classes — reuses this repo's own real Artifact/Evidence Runtime.", readOnly: true, relatedRealFiles: ["engines/shared/ide-lib/artifactRuntime.ts"], status: "PARTIAL" },
};

export function listKnowledgeCategories(): KnowledgeCategoryDefinition[] {
  return Object.values(SECURITY_KNOWLEDGE_REGISTRY);
}
export function getKnowledgeCategory(id: string): KnowledgeCategoryDefinition | undefined {
  return SECURITY_KNOWLEDGE_REGISTRY[id as KnowledgeCategoryId];
}

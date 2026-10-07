/**
 * หน้าที่: ให้ DNA OS "ระบบบัญชี" มีตัวตนระดับ SYSTEM ในทะเบียน canonical เป็น
 * knowledge/relationship node ที่ชี้ไป 23 module capabilities ที่ register แล้ว
 * (Owner, 2026-09-03 — BUILD_ACCOUNTING_SYSTEM_KNOWLEDGE_AND_USAGE_MAP).
 *
 * ไม่ใช่ module ที่ 24 และไม่ใช่ truth ชุดใหม่. registry ไม่มี resource_type
 * SYSTEM/KNOWLEDGE และไม่มี relationship kind CONTAINS/DEPENDS_ON/RECEIVES_FROM
 * (closed vocab) — ความสัมพันธ์เหล่านั้นจึงถูกพกเป็น DATA ใน knowledge_record
 * (governance/system-knowledge/accounting-system.knowledge.json) ไม่ invent routing.
 *
 * candidate 1 = accounting-system (kind capability, node แบบเดียวกับ system-graph-projection)
 * candidate 2 = accounting-system-knowledge (kind resource, SOURCE_REFERENCE ชี้ไฟล์ knowledge)
 *
 * Output: ACCOUNTING_SYSTEM_CANDIDATES. ห้ามใส่ credential, ห้ามเปลี่ยน verdict เป็น LIVE.
 */
import type { RegistrationCandidate } from "../../../control/event-pipeline/registration-contract";

export const ACCOUNTING_SYSTEM_CANDIDATES: readonly RegistrationCandidate[] = [
  {
    candidate_id: "candidate-accounting-system-v1",
    name: "accounting-system",
    kind: "capability" as const,
    version: "1.0.0",
    domain: "SOFTWARE_CONTROL_PLANE" as const,
    resource_type: "CAPABILITY" as const,
    data_classification: "INTERNAL",
    source_system: "dna-os-infrastructure",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/accounting-system-knowledge.ts",
    source_location: "governance/system-knowledge/accounting-system.knowledge.json (+ tests/__sandbox__/accounting-kernel/)",
    input: [
      "debt_events (FEEDER)",
      "invoices",
      "standalone_documents",
      "company_expenses",
      "partner_payable_requests",
      "bank_statement_transactions (FINANCIAL_SOURCE+EVIDENCE)",
      "receipt_documents (EVIDENCE)",
      "bank_notifications (EVIDENCE)"
    ],
    output: [
      "journal_entries",
      "journal_lines",
      "general_ledger",
      "AR subledger (per-document)",
      "AP subledger (per-document)",
      "vat_report (PP30-shaped)",
      "wht_report (PND-shaped)",
      "trial_balance",
      "pnl",
      "balance_sheet",
      "tax_submission_packages (BUILT from ledger; external submission NOT_PROVEN)"
    ],
    side_effects: [
      "knowledge/relationship node only; owns no truth; writes nothing to LIVE"
    ],
    dependencies: [
      "member:capability-6aa8d952-f90b-4f75-aba5-d4d803bddf7a",
      "member:capability-d6f946dd-6182-4af4-8416-d5b26f1d97e0",
      "member:capability-324b770d-edfb-4273-85c9-bae3166455e2",
      "member:capability-fb9ffbc6-0985-40aa-9927-d030a070c52f",
      "member:capability-cd679a7a-5ff4-4fec-ae44-c98774e61086",
      "member:capability-89eb7066-ac4d-4f0f-8d2d-a93a7ceb89ff",
      "member:capability-677ecdff-0c82-4b9a-84d6-05e88c360078",
      "member:capability-478f4c31-2ade-4406-b21a-998e1f78227b",
      "member:capability-cd4712dd-3705-4177-9a87-cb27652d7ee5",
      "member:capability-f364f062-188c-4546-a182-a89ac16e2b40",
      "member:capability-84b25435-f4f5-47cd-a5e9-c142d2f21e24",
      "member:capability-8ee2d28b-7595-40f7-a197-f9d899ad7209",
      "member:capability-4cb78bc1-93ac-4b8f-a2f9-294da1f3b132",
      "member:capability-c7443c29-7e43-4f8d-a786-49a550b3bdd6",
      "member:capability-ea1f5a5a-aec5-43ba-88b1-4c2c7fe6f88b",
      "member:capability-37f8d478-787f-42ee-89c2-7cc5e61b4110",
      "member:capability-5a642b4c-7003-4bec-91d8-21d6e34c0341",
      "member:capability-7e77cc8d-55a9-4f37-a840-35f71eb4a29a",
      "member:capability-151c2560-f982-4e3d-8aa6-b32d273b0a0e",
      "member:capability-d39a2c3f-404b-4f36-bef6-2d7100deb7b2",
      "member:capability-e8f026a9-4cb1-483d-8eb4-38935973245d",
      "member:capability-36a0cf57-e5ef-45df-b295-5e9078fd36f4",
      "member:capability-0394181e-eb59-43a8-88cb-852561a49199",
      "DEPENDS_ON: BUSINESS_DATA_READ_CAPABILITY (read-only access to deadboard business DB xeytcavxejhyzxwevgto) — MISSING/BLOCKED",
      "DEPENDS_ON: ACCOUNTING_API (single boundary) — NOT_BUILT"
    ],
    behavior:
      "DNA OS Accounting System — system-level KNOWLEDGE/RELATIONSHIP node (NOT a truth store, NOT a 24th module). PURPOSE: event-sourced double-entry accounting the DNA OS owns; derives accounting effect from Financial Events + evidence, never trusts a legacy status word. CANONICAL_TRUTH: GL + AR/AP subledger. CONTAINS the 23 registered accounting-* capabilities (listed in dependencies as member:<capability_id>). RECEIVES_FROM legacy financial sources, USES evidence sources, PRODUCES journal/GL/AR/AP, DERIVES VAT/WHT/reports/tax packages — full map in the registered knowledge_record. STATUS: VERIFIED_ISOLATED (23/23) and REGISTERED; PRODUCTION_STATUS: NOT_LIVE / BLOCKED_PRELIVE. Containment/flow/legacy-role/readiness relationships are carried as DATA in the knowledge_record because the registry's closed relationship vocabulary has no CONTAINS/DEPENDS_ON/RECEIVES_FROM kind — no routing/execution path is invented. BLOCKED_BY: missing read-only business-DB capability + Accounting API not built. NEXT: Owner grants read-only business-DB access -> LIVE census/replay/backfill -> build Accounting API -> Owner-approved LIVE promotion.",
    evidence_refs: [
      "knowledge_record: governance/system-knowledge/accounting-system.knowledge.json (sha256:6f90b9e6b574dd02f494c8bd2b83ce06e6707eb8d47844a9291e48afcfab2e8d, machine-readable)",
      "canonical_truth: governance/architecture-rules/ACCOUNTING_CANONICAL_TRUTH.md = resource-e82af838-bfc8-4801-94d8-926f5ece1d19",
      "isolated proof 23/23: tests/__sandbox__/accounting-kernel/EVIDENCE-acceptance-reverify.txt#sha256:372912703192b15b",
      "lifecycle_verdict:VERIFIED_ISOLATED",
      "production_status:NOT_LIVE / BLOCKED_PRELIVE",
      "contains_23_module_capabilities (see dependencies + knowledge_record.SYSTEM.relationships.CONTAINS)",
      "member_capability:capability-6aa8d952-f90b-4f75-aba5-d4d803bddf7a",
      "member_capability:capability-d6f946dd-6182-4af4-8416-d5b26f1d97e0",
      "member_capability:capability-324b770d-edfb-4273-85c9-bae3166455e2",
      "member_capability:capability-fb9ffbc6-0985-40aa-9927-d030a070c52f",
      "member_capability:capability-cd679a7a-5ff4-4fec-ae44-c98774e61086",
      "member_capability:capability-89eb7066-ac4d-4f0f-8d2d-a93a7ceb89ff",
      "member_capability:capability-677ecdff-0c82-4b9a-84d6-05e88c360078",
      "member_capability:capability-478f4c31-2ade-4406-b21a-998e1f78227b",
      "member_capability:capability-cd4712dd-3705-4177-9a87-cb27652d7ee5",
      "member_capability:capability-f364f062-188c-4546-a182-a89ac16e2b40",
      "member_capability:capability-84b25435-f4f5-47cd-a5e9-c142d2f21e24",
      "member_capability:capability-8ee2d28b-7595-40f7-a197-f9d899ad7209",
      "member_capability:capability-4cb78bc1-93ac-4b8f-a2f9-294da1f3b132",
      "member_capability:capability-c7443c29-7e43-4f8d-a786-49a550b3bdd6",
      "member_capability:capability-ea1f5a5a-aec5-43ba-88b1-4c2c7fe6f88b",
      "member_capability:capability-37f8d478-787f-42ee-89c2-7cc5e61b4110",
      "member_capability:capability-5a642b4c-7003-4bec-91d8-21d6e34c0341",
      "member_capability:capability-7e77cc8d-55a9-4f37-a840-35f71eb4a29a",
      "member_capability:capability-151c2560-f982-4e3d-8aa6-b32d273b0a0e",
      "member_capability:capability-d39a2c3f-404b-4f36-bef6-2d7100deb7b2",
      "member_capability:capability-e8f026a9-4cb1-483d-8eb4-38935973245d",
      "member_capability:capability-36a0cf57-e5ef-45df-b295-5e9078fd36f4",
      "member_capability:capability-0394181e-eb59-43a8-88cb-852561a49199"
    ],
    origin: {
      origin_kind: "ACCOUNTING_SYSTEM_KNOWLEDGE",
      origin_reference: "TASK:BUILD_ACCOUNTING_SYSTEM_KNOWLEDGE_AND_USAGE_MAP",
      introduced_by: "software/capability-registrar/register-accounting-system-knowledge.ts",
    },
    relationships: [
      { to_type: "DEPENDENCY", to_id: "BUSINESS_DATA_READ_CAPABILITY:read-only-business-db(xeytcavxejhyzxwevgto)", relationship_kind: "CAPABILITY_TO_DEPENDENCY" },
      { to_type: "DEPENDENCY", to_id: "ACCOUNTING_API:single-boundary(NOT_BUILT)", relationship_kind: "CAPABILITY_TO_DEPENDENCY" },
      { to_type: "OWNER", to_id: "governance/architecture-rules/ACCOUNTING_CANONICAL_TRUTH.md#resource-e82af838-bfc8-4801-94d8-926f5ece1d19", relationship_kind: "CAPABILITY_TO_OWNER" },
    ],
    scope: "accounting/system",
  },
  {
    candidate_id: "candidate-accounting-system-knowledge-v1",
    name: "accounting-system-knowledge-record",
    kind: "resource" as const,
    version: "1.0.0",
    domain: "SOFTWARE_CONTROL_PLANE" as const,
    resource_type: "SOURCE_REFERENCE" as const,
    data_classification: "INTERNAL",
    source_system: "dna-os-infrastructure",
    owner: "governance/system-knowledge",
    source_location: "governance/system-knowledge/accounting-system.knowledge.json",
    input: [],
    output: [],
    side_effects: [],
    dependencies: [],
    behavior:
      "MACHINE-READABLE knowledge projection of the DNA OS Accounting System: SYSTEM record, 23 MODULE knowledge-contracts (inputs/entrypoint/outputs/deps/verification/status), 20 OPERATION usage-contracts (invocation/availability/blocked_by), 12-step canonical FLOW, 9 LEGACY_ROLES, READINESS chain, and a READBACK_INDEX answering the Owner readback questions. Points to registered capability_ids; re-implements nothing; owns no truth.",
    evidence_refs: [
      "governance/system-knowledge/accounting-system.knowledge.json",
      "sha256:6f90b9e6b574dd02f494c8bd2b83ce06e6707eb8d47844a9291e48afcfab2e8d",
      "bytes:62166",
      "projects: 23 modules + 20 operations + 12 flow steps + 9 legacy roles + readiness",
    ],
    scope: "accounting/system-knowledge",
  }
];

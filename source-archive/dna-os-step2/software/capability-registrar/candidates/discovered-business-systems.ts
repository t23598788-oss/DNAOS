/**
 * หน้าที่: ให้ระบบธุรกิจที่ "มีอยู่จริงและทำงานอยู่แล้ว" มีตัวตนในทะเบียน
 * canonical เป็นครั้งแรก (Owner, 2026-09-02 — EXISTING SYSTEM DISCOVERY).
 *
 * ทุกตัวในไฟล์นี้ถูกค้นพบ ไม่ได้ถูกสร้าง. ก่อนหน้านี้ DNA OS ตอบว่า "ไม่มีระบบ
 * เอกสาร" และ "ไม่มีการติดตามการชำระเงิน" ทั้งที่ทั้งสองอย่างมีอยู่และมีโค้ดจริง
 * หลายร้อยบรรทัดใน dna-os-deadboard + Supabase — คำตอบนั้นผิดเพราะค้นจากทะเบียน
 * อย่างเดียวแล้วสรุปว่าไม่มี ทั้งที่ทะเบียนเป็นสิ่งที่ยังไม่รู้จักมันต่างหาก
 *
 * ไม่มีการเขียนระบบใหม่ทดแทน. ไม่มี adapter ใหม่ ไม่มี document engine ใหม่
 * ไม่มี payment system ใหม่ ทุก source_location ชี้ไปที่โค้ดที่มีอยู่แล้วและ
 * ไม่ถูกแตะ การลงทะเบียนเพิ่ม "ตัวตน" ไม่ได้เพิ่ม "พฤติกรรม"
 *
 * repository แยกกันโดยตั้งใจ. deadboard เป็นคนละ repo และต้องอยู่คนละที่ต่อไป
 * ตามคำสั่ง — capability ชี้ข้าม repo ได้ผ่าน source_location และนั่นคือเหตุผล
 * ที่ชั้น capability-route มีอยู่
 *
 * Input: none (ค่าคงที่)
 * Output: DISCOVERED_BUSINESS_CANDIDATES
 * สิ่งที่ห้ามแตะ: ห้ามอ้าง evidence ที่ยังไม่ได้วัด, ห้ามใส่ค่า credential.
 */

import type { RegistrationCandidate } from "../../../control/event-pipeline/registration-contract";

const COMMON = {
  kind: "capability" as const,
  version: "1.0.0",
  domain: "SOFTWARE_CONTROL_PLANE" as const,
  resource_type: "CAPABILITY" as const,
  data_classification: "INTERNAL",
  source_system: "dna-os-deadboard",
  origin: {
    origin_kind: "DISCOVERED_EXISTING_SYSTEM",
    origin_reference: "TASK:EXISTING_SYSTEM_DISCOVERY_AND_CANONICALIZATION",
    introduced_by: "software/capability-registrar/register-discovered-business-systems.ts",
  },
};

export const DISCOVERED_BUSINESS_CANDIDATES: readonly RegistrationCandidate[] = [
  {
    ...COMMON,
    candidate_id: "candidate-line-messaging-production-v1",
    name: "line-messaging-production",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/discovered-business-systems.ts",
    source_location: "~/Desktop/dna-os-deadboard/supabase/functions/ (line-webhook-v2, line-profile-reconcile, line-profile-refresh-worker) + app/api/internal/line/ + app/api/admin/line-customers/",
    input: [
      "LINE webhook deliveries received by the Supabase Edge Function line-webhook-v2",
      "admin actions from the deadboard UI for a given lineUserId (send-document, send-debt)",
    ],
    output: [
      "rows in line_events, line_profiles, line_profile_events, line_profile_history, line_conversation_controls, line_customer_memory, line_outbound_drafts",
      "outbound LINE messages carrying a document or a debt notice to a specific customer",
    ],
    side_effects: [
      "writes to the live Supabase project (REST endpoint answers HTTP 401 without a key, i.e. the project is up)",
      "outbound calls to the LINE Messaging API",
    ],
    dependencies: [
      "Supabase project xeytcavxejhyzxwevgto (database + Edge Functions runtime)",
      "LINE Messaging API channel credentials held by that project, not by this repository",
      "company_line_links / entity_registry for mapping a LINE user to a business entity",
    ],
    behavior:
      "receive_line_events_in_supabase_and_drive_customer_conversation_from_stored_state: the production LINE path does not run on this Mac at all — it runs as Supabase Edge Functions against 10 line_* tables, so conversation state, customer memory, profile history and outbound drafts survive independently of any local process. Admin endpoints under app/api/admin/line-customers/[lineUserId]/ send a document or a debt notice back to one identified customer, which is the return leg of the Owner's LINE workflow. This is a separate and far more complete implementation than the local engine-prototypeไลน์/ adapter, which is a prototype and is not the live path.",
    evidence_refs: [
      "measured 2026-09-02: supabase/functions/line-* = 6,173 lines across 3 functions",
      "measured 2026-09-02: app/api/admin/line-customers = 565 lines across 7 files (send-document, send-debt)",
      "measured 2026-09-02: app/api/internal/line = 97 lines across 3 files (document-artifact)",
      "migrations declare line_channels, line_events, line_conversation_controls, line_customer_memory, line_outbound_drafts, line_profile_events, line_profile_history, line_profile_refresh_queue, line_profiles, company_line_links",
      "supabase/migrations/20260626000001_line_events_receiver_columns.sql, 20260706000001_line_events_new_project.sql",
      `measured 2026-09-02: https://xeytcavxejhyzxwevgto${".supabase.co"}/rest/v1/ -> HTTP 401 (project reachable, key required)`,
    ],
    scope: "business/line-messaging-production",
  },
  {
    ...COMMON,
    candidate_id: "candidate-business-document-issuance-v1",
    name: "business-document-issuance",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/discovered-business-systems.ts",
    source_location: "~/Desktop/dna-os-deadboard/app/api/admin/documents/ + app/api/document/ + app/api/admin/invoices/ + app/api/admin/receipt-documents/ + app/api/admin/quotation-queue/ + app/admin/{create-document,delivery-order,purchase-order}/ + 08-document-registry.json",
    input: [
      "an admin request to create or confirm a business document",
      "the document type vocabulary declared in 08-document-registry.json",
    ],
    output: [
      "quotation (QT), invoice (IV), receipt (RE), delivery_order (DO) records",
      "rows in invoice_items, receipt_documents, standalone_document_items",
      "a document artifact retrievable for delivery to a LINE customer",
    ],
    side_effects: ["writes business documents to the live Supabase project"],
    dependencies: [
      "Supabase project xeytcavxejhyzxwevgto",
      "entity_registry / pit_profiles for the party a document is issued to",
    ],
    behavior:
      "issue_and_confirm_the_four_declared_business_document_types_against_stored_business_entities: the document type vocabulary is declared in one place (08-document-registry.json: QT/IV/RE/DO) and the API surface implements creation, listing, confirmation and rejection over it. Receipt documents carry an explicit confirm/reject boundary rather than being created as final, and a separate route exposes a document artifact for delivery to a LINE customer. This capability was reported as MISSING on 2026-09-02 before the source pointers were followed; it is not missing.",
    evidence_refs: [
      "measured 2026-09-02: app/api/admin/documents + app/api/document = 522 lines across 5 files",
      "measured 2026-09-02: app/api/admin/receipt-documents = 299 lines across 3 files (incl. [id]/confirm, [id]/reject)",
      "measured 2026-09-02: app/api/admin/quotation-queue = 86 lines",
      "08-document-registry.json declares quotation/QT, invoice/IV, receipt/RE, delivery_order/DO",
      "routes present: app/admin/create-document, app/admin/delivery-order, app/admin/purchase-order",
      "supabase/migrations/20260622000006_documents_sync_and_webhook_trigger.sql",
      "tables: invoice_items, receipt_documents, standalone_document_items",
    ],
    scope: "business/document-issuance",
  },
  {
    ...COMMON,
    candidate_id: "candidate-debt-and-payment-tracking-v1",
    name: "debt-and-payment-tracking",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/discovered-business-systems.ts",
    source_location: "~/Desktop/dna-os-deadboard/app/api/admin/debt-trackings/ + app/api/admin/debt-events/ + app/admin/{debt-tracking,debt-notice,payment-voucher}/ + supabase/functions/{debt-reminder-cron,bank-email-sync,bank-statement-reconcile,receipt-reconcile-sweep}/",
    input: [
      "a debt event raised against a business party",
      "bank notification emails and bank statement rows ingested by the sync functions",
    ],
    output: [
      "debt tracking records and their state transitions",
      "an issued receipt when a debt event is settled",
      "rows in partner_payable_requests, bank_notifications, bank_statement_transactions, transactions",
    ],
    side_effects: [
      "writes payment and debt state to the live Supabase project",
      "sends debt reminders on a schedule (debt-reminder-cron)",
    ],
    dependencies: [
      "Supabase project xeytcavxejhyzxwevgto",
      "business-document-issuance — a settled debt issues a receipt",
      "line-messaging-production — a debt notice is delivered to the customer over LINE",
    ],
    behavior:
      "track_what_is_owed_and_reconcile_it_against_real_bank_evidence: debt events are recorded per party and carry their own lifecycle, with a dedicated route that issues a receipt when one is settled. Reconciliation is evidence-driven rather than declared: bank notification emails and bank statement transactions are ingested by their own Edge Functions and swept against receipts, so a payment is matched to real bank data instead of being marked paid by hand. A scheduled reminder function chases what remains outstanding. This capability was reported as MISSING on 2026-09-02 before the source pointers were followed; it is not missing.",
    evidence_refs: [
      "measured 2026-09-02: app/api/admin/debt-trackings = 211 lines across 5 files",
      "routes present: app/api/admin/debt-events/[id]/issue-receipt, app/api/admin/line-customers/[lineUserId]/send-debt",
      "edge functions present: debt-reminder-cron, bank-email-sync, bank-statement-reconcile, receipt-reconcile-sweep",
      "tables: partner_payable_requests, bank_notifications, bank_statement_transactions, transactions, company_expenses",
      "supabase/migrations/20260705000002_transaction_state_machine.sql, 20260705000005_link_debt_tracking_partner.sql",
    ],
    scope: "business/debt-and-payment-tracking",
  },
  {
    ...COMMON,
    candidate_id: "candidate-business-entity-registry-v1",
    name: "business-entity-registry",
    source_system: "dna-os-deadboard",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/discovered-business-systems.ts",
    source_location: "~/Desktop/dna-os-deadboard/supabase/migrations/ (entity_registry, pit_profiles, profiles, company_line_links, conversation_states) + core/identity/",
    input: ["a business party observed through a conversation or a transaction"],
    output: ["entity_registry rows and their links to LINE identities and business documents"],
    side_effects: ["writes entity and conversation state to the live Supabase project"],
    dependencies: ["Supabase project xeytcavxejhyzxwevgto"],
    behavior:
      "hold_the_identity_of_the_business_parties_the_other_capabilities_refer_to: company/person identity is stored once in entity_registry and linked outward — company_line_links binds a LINE identity to a business entity, pit_profiles carries the counterparty profile, and conversation_states keeps where a given conversation has reached. Every other business capability refers to a party through this registry rather than keeping its own copy, which is what makes a LINE message, a document and a debt refer to the same customer.",
    evidence_refs: [
      "tables: entity_registry, pit_profiles, profiles, company_line_links, conversation_states, business_events",
      "supabase/migrations/20260622000003_conversation_state_and_entity_registry.sql",
      "supabase/migrations/20260705000004_link_partner_pit_profile.sql",
      "supabase/migrations/20260705000001_business_events_partner_timeline.sql",
      "deadboard core/identity/ present on disk",
    ],
    scope: "business/entity-registry",
  },
  {
    ...COMMON,
    candidate_id: "candidate-expense-ingestion-v1",
    name: "expense-ingestion",
    source_system: "dna-os-infrastructure",
    owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/discovered-business-systems.ts",
    source_location: "connections/expense-ingestion/ (extractor.ts, store.ts, types.ts, run-ingestion.mts)",
    input: ["one billing email as connections/email-alert-source returns it"],
    output: ["a NormalizedExpense row appended to connections/expense-ingestion/data/expenses.jsonl"],
    side_effects: ["appends to an append-only JSONL store inside this repository"],
    dependencies: ["connections/email-alert-source"],
    behavior:
      "normalize_one_billing_email_into_one_expense_without_guessing_what_it_does_not_say: the vendor is derived from the real sender domain, so there is no vendor allow-list to maintain and an unseen provider still normalizes. Anything the email does not state — amount, currency — becomes UNKNOWN with a reason recorded in extraction_reasons rather than an inferred number. Deduplication is by source_message_id, so one Gmail message can only ever become one expense.",
    evidence_refs: [
      "measured 2026-09-02: connections/expense-ingestion = 247 lines across 4 files",
      "measured 2026-09-02: connections/expense-ingestion/data/expenses.jsonl = 67 rows",
      "extractor.ts header states the no-guessing rule and the UNKNOWN requirement",
      "store.ts states deduplication by source_message_id",
    ],
    scope: "business/expense-ingestion",
  },
];

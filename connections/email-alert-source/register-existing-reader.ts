/**
 * หน้าที่: PHASE 1 — register the EXISTING Gmail reader into the DNA OS
 * Registry. It has run in production for weeks and was never registered,
 * so DNA OS's own census cannot see it.
 *
 * This file MINTS NOTHING. It builds a `RegistrationCandidate` and hands
 * it to the existing `runRegistrationPipeline`, which performs
 * VALIDATION -> CLASSIFICATION -> DUPLICATE GATE -> REGISTRY WRITER. No
 * registry row is written here, and running this twice must produce
 * EXISTING rather than a second row — that is the Duplicate Gate's job,
 * not this file's.
 *
 * What is being registered is a capability that lives in ANOTHER
 * repository and ANOTHER runtime. That is the point: the registry should
 * record what DNA OS depends on, not only what it hosts.
 *
 * How to run: npx tsx connections/email-alert-source/register-existing-reader.ts
 *
 * Input: none (constant candidate built from verified facts).
 * Output: pipeline result printed as JSON.
 * Dependency ที่อนุญาต: ../../control/registration-pipeline/contract.ts,
 * ../../software/registry-database/adapters/persistent-file-store.ts.
 * สิ่งที่ห้ามแตะ: never call the Registry Writer directly from here, and
 * never hand-edit `software/registry-database/data/` — the pipeline is
 * the only sanctioned write path.
 */

import { randomUUID } from "node:crypto";
import { runRegistrationPipeline } from "../../control/registration-pipeline/contract";
import { createPersistentFileStore } from "../../software/registry-database/adapters/persistent-file-store";
import type { RegistrationCandidate } from "../../control/event-pipeline/contract";

const DEADBOARD = "~/Desktop/dna-os-deadboard";
const READER_PATH = `${DEADBOARD}/supabase/functions/_shared/gmail-client.ts`;

/**
 * Every field below is a VERIFIED fact, read from the real files on
 * 2026-08-26 — not a description of intent:
 *  - 99 lines, exports getGmailAccessToken / searchGmailMessageIds /
 *    fetchGmailMessage / extractBodyText / getSubjectHeader
 *  - gmail.readonly scope, stated in its own header comment
 *  - four real consumers, found by grep for "gmail-client"
 *  - credentials read via Deno.env, never from DNA OS
 */
const GMAIL_READER_CAPABILITY: RegistrationCandidate = {
  candidate_id: `candidate-${randomUUID()}`,
  name: "gmail-readonly-reader",
  kind: "capability",
  source_location: READER_PATH,
  owner: "dna-os-deadboard",
  input: ["gmail search query (deterministic from:/subject:/newer_than: fragments)", "gmail message id"],
  output: ["gmail message payload", "plaintext body", "subject header", "oauth access token (in-process only)"],
  side_effects: [
    "outbound HTTPS to oauth2.googleapis.com (token refresh)",
    "outbound HTTPS to gmail.googleapis.com (readonly message search/fetch)",
  ],
  dependencies: ["Deno runtime", "Supabase Edge Functions", "GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN (Supabase env)"],
  behavior:
    "Shared read-only Gmail connector. Scope gmail.readonly — never send, modify or delete. " +
    "Runtime owner: Supabase Edge Functions (Deno), project vibrant-hawking. " +
    "Credential boundary: Supabase Edge Function environment ONLY; no Google credential exists in DNA-OS-INFRASTRUCTURE. " +
    "Existing consumers: bank-email-sync (pg_cron every 5 minutes, production), subscription-email-sync, supabase-billing-sync, system-health-check. " +
    "Consumed by DNA OS through connections/email-alert-source/ over HTTP — never imported, because Deno modules are not importable from this Node repo.",
  version: "1",
  evidence_refs: [
    READER_PATH,
    `${DEADBOARD}/supabase/functions/bank-email-sync/index.ts`,
    `${DEADBOARD}/supabase/functions/subscription-email-sync/index.ts`,
    `${DEADBOARD}/supabase/functions/supabase-billing-sync/index.ts`,
    `${DEADBOARD}/supabase/functions/system-health-check/index.ts`,
    // deadboard's own independent statement of the same runtime boundary:
    `${DEADBOARD}/app/api/admin/ide/_lib/alertRegistry.ts#EMAIL`,
    "connections/email-alert-source/README.md",
  ],
  domain: "INFRASTRUCTURE_CONTROL",
  resource_type: "CONNECTOR",
  data_classification: "restricted",
  source_system: "dna-os-deadboard",
  scope: "external-runtime-dependency",
};

async function main(): Promise<void> {
  const store = createPersistentFileStore();
  const result = runRegistrationPipeline(
    GMAIL_READER_CAPABILITY,
    store,
    `gmail-reader-registration-${GMAIL_READER_CAPABILITY.name}`,
  );
  console.log(JSON.stringify({ candidate: GMAIL_READER_CAPABILITY.name, result }, null, 2));
}

void main();

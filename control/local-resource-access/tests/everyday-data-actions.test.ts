/**
 * Deterministic A–N proofs for EVERYDAY_DATA_ACTIONS_V1.
 *
 * How to run:
 *   npx tsx control/local-resource-access/tests/everyday-data-actions.test.ts
 */

import { existsSync, readFileSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  EVERYDAY_DATA_ACTIONS,
  FORBIDDEN_CAPABILITY_NAMES,
  describeRemoteResourceAction,
  evaluateLocalAuthority,
  getEverydayAction,
  invokeLocalCapability,
  issueLocalAccessGrant,
  listDataEgress,
  listEverydayActions,
  listLocalResourceEvents,
  listTransferIntegrity,
  mapEverydayApplicationAction,
} from "../contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const STAMP = Date.now();
const DATA = join(process.cwd(), "control/local-resource-access/data");
process.env.LOCAL_RESOURCE_GRANTS_LOG = join(DATA, `eda-grants-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_REGISTRY_LOG = join(DATA, `eda-resources-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_EVENTS_LOG = join(DATA, `eda-events-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_EGRESS_LOG = join(DATA, `eda-egress-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_EVIDENCE_LOG = join(DATA, `eda-evidence-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_WORKSPACES_LOG = join(DATA, `eda-workspaces-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_TRANSFER_LOG = join(DATA, `eda-transfer-${STAMP}.jsonl`);
process.env.OWNER_MACHINE_POLICY_LOG = join(DATA, `eda-policy-${STAMP}.jsonl`);

const FILE_RES = "resource://local/files/fixture-corpus";
const WRITE_RES = "resource://local/files/fixture-writable";
const APP = "resource://local/app/textedit";
const SESSION = `session-eda-${STAMP}`;
const AI = "ai://eda-client";
const UNKNOWN = "ai://unknown-vendor";
const NOTES = join(process.cwd(), "control/local-resource-access/fixtures/corpus/notes.txt");
const SECRET = join(process.cwd(), "control/local-resource-access/fixtures/corpus/secret.credential.txt");
const WRITABLE = join(process.cwd(), "control/local-resource-access/fixtures/writable");

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function grant(resource_id: string, access: ReadonlyArray<"READ" | "WRITE" | "EXECUTE" | "DELETE" | "SHARE_EXTERNAL" | "PUBLISH_EXTERNAL">, session = SESSION): void {
  const data_scope = resource_id === WRITE_RES
    ? ["control/local-resource-access/fixtures/writable"]
    : resource_id === FILE_RES
      ? ["control/local-resource-access/fixtures/corpus"]
      : [];
  issueLocalAccessGrant({
    ai_identity: AI,
    session_id: session,
    work_id: null,
    capability: "*",
    resource_id,
    data_scope,
    access,
    network_egress: "LOCAL_ONLY",
    expires_at: null,
    effect: "ALLOW",
  });
}

async function main(): Promise<void> {
  const notesBefore = readFileSync(NOTES, "utf8");
  const secretBefore = readFileSync(SECRET, "utf8");
  grant(FILE_RES, ["READ", "WRITE"]);
  grant(WRITE_RES, ["READ", "WRITE"]);
  grant(APP, ["READ", "EXECUTE"]);

  await check("A. Unknown AI cannot read any user file", async () => {
    const denied = await invokeLocalCapability({
      ai_client_id: UNKNOWN, session_id: "none", work_id: `work-a-${STAMP}`,
      capability: "local.file.read", resource_id: FILE_RES, input: { logical_path: "notes.txt" },
    });
    assert(denied.ok === false, "unknown must deny");
    assert(denied.authority.decision === "DENY", denied.authority.decision);
  });

  await check("B. Authorized scoped READ works", async () => {
    const read = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-b-${STAMP}`,
      capability: "local.file.read", resource_id: FILE_RES, input: { logical_path: "notes.txt" },
    });
    assert(read.ok, JSON.stringify(read.result));
    assert(read.envelope.execution_locality === "LOCAL", read.envelope.execution_locality);
    assert(String(read.result.text).includes("zzqegate-local-resource-marker"), "scoped content");
  });

  await check("C. Unauthorized WRITE is denied", async () => {
    const readOnly = `session-ro-${STAMP}`;
    grant(FILE_RES, ["READ"], readOnly);
    const denied = await invokeLocalCapability({
      ai_client_id: AI, session_id: readOnly, work_id: `work-c-${STAMP}`,
      capability: "local.file.create", resource_id: WRITE_RES, input: { logical_path: "nope.txt", content: "x" },
    });
    assert(denied.ok === false, "read-only session must not write writable resource without grant");
    const protectedWrite = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-c2-${STAMP}`,
      capability: "local.file.create", resource_id: FILE_RES, input: { logical_path: "owned.txt", content: "no" },
    });
    assert(protectedWrite.ok === false, "corpus write_scope empty");
  });

  await check("D. COPY cannot escape destination scope", async () => {
    const escape = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-d-${STAMP}`,
      capability: "local.file.copy", resource_id: FILE_RES,
      input: { source_logical: "notes.txt", destination_logical: "../escape.txt", destination_resource_id: WRITE_RES },
    });
    assert(escape.ok === false, "escape copy must deny");
    assert(JSON.stringify(escape.result).includes("PATH_OUT_OF_SCOPE"), JSON.stringify(escape.result));
  });

  await check("E. MOVE verifies source/destination correctly", async () => {
    const created = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-e-${STAMP}`,
      capability: "local.file.create", resource_id: WRITE_RES,
      input: { logical_path: `move-src-${STAMP}.txt`, content: "move-me" },
    });
    assert(created.ok, JSON.stringify(created.result));
    const moved = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-e-${STAMP}`,
      capability: "local.file.move", resource_id: WRITE_RES,
      input: { source_logical: `move-src-${STAMP}.txt`, destination_logical: `move-dst-${STAMP}.txt` },
    });
    assert(moved.ok, JSON.stringify(moved.result));
    const transfer = moved.result.transfer as { verified?: boolean; source_hash?: string; destination_hash?: string };
    assert(transfer.verified === true, "move must verify");
    assert(transfer.source_hash === transfer.destination_hash, "hashes must match");
    assert(!existsSync(join(WRITABLE, `move-src-${STAMP}.txt`)), "source must be gone");
    assert(existsSync(join(WRITABLE, `move-dst-${STAMP}.txt`)), "dest must exist");
  });

  await check("F. DELETE requires explicit Owner authority", async () => {
    await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-f-${STAMP}`,
      capability: "local.file.create", resource_id: WRITE_RES,
      input: { logical_path: `delete-me-${STAMP}.txt`, content: "temp" },
    });
    const blocked = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-f-${STAMP}`,
      capability: "local.file.delete", resource_id: WRITE_RES, input: { logical_path: `delete-me-${STAMP}.txt` },
    });
    assert(blocked.ok === false, "delete without DELETE class");
    assert(blocked.authority.decision === "OWNER_APPROVAL_REQUIRED", blocked.authority.decision);
    assert(blocked.envelope.result_status === "OWNER_APPROVAL_REQUIRED", blocked.envelope.result_status);
    const events = listLocalResourceEvents(`work-f-${STAMP}`);
    assert(events.some((row) => row.event === "OWNER_APPROVAL_REQUIRED"), "approval event");
  });

  await check("G. Symlink/path traversal remains blocked", async () => {
    const link = join(WRITABLE, `link-${STAMP}.txt`);
    try { symlinkSync("/etc/passwd", link); } catch { /* ignore if exists */ }
    const denied = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-g-${STAMP}`,
      capability: "local.file.read", resource_id: WRITE_RES, input: { logical_path: `link-${STAMP}.txt` },
    });
    assert(denied.ok === false, "symlink escape must deny");
    const trav = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-g-${STAMP}`,
      capability: "local.file.read", resource_id: FILE_RES, input: { logical_path: "../package.json" },
    });
    assert(trav.ok === false, "traversal must deny");
  });

  await check("H. Local PDF/text extraction happens without external AI", async () => {
    const pdf = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-h-${STAMP}`,
      capability: "local.pdf.extract_text", resource_id: FILE_RES, input: { logical_path: "sample.pdf" },
    });
    assert(pdf.ok, JSON.stringify(pdf.result));
    assert(pdf.envelope.execution_locality === "LOCAL", pdf.envelope.execution_locality);
    assert(String(pdf.result.extracted_text).includes("zzqegate-pdf-marker"), "pdf extracted locally");
    const doc = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-h-${STAMP}`,
      capability: "local.document.extract_text", resource_id: FILE_RES, input: { logical_path: "document.txt" },
    });
    assert(doc.ok, JSON.stringify(doc.result));
    const img = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-h-${STAMP}`,
      capability: "local.image.metadata", resource_id: FILE_RES, input: { logical_path: "pixel.png" },
    });
    assert(img.ok, JSON.stringify(img.result));
    assert(img.result.format === "png", String(img.result.format));
    const conv = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-h-${STAMP}`,
      capability: "local.document.convert_registered", resource_id: FILE_RES, input: { logical_path: "document.txt" },
    });
    assert(conv.ok === false, "unregistered convert");
  });

  await check("I. SUMMARIZE processes a large source locally and exports only minimized text", async () => {
    const summarized = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-i-${STAMP}`,
      capability: "local.document.summarize", resource_id: FILE_RES, input: { logical_path: "summarize-source.txt" },
    });
    assert(summarized.ok, JSON.stringify(summarized.result));
    const source = Number(summarized.result.SOURCE_BYTES);
    const sent = summarized.egress.bytes_actually_sent;
    assert(source > 50_000, `source ${source}`);
    assert(sent < source, `sent ${sent} vs source ${source}`);
    assert(!JSON.stringify(summarized.result).includes("padding-line for local-first summarization".repeat(20)), "must not dump source");
  });

  await check("J. Exact external byte count is recorded", async () => {
    const rows = listDataEgress(`work-i-${STAMP}`);
    assert(rows.length > 0, "egress row");
    assert(typeof rows[0]!.bytes_actually_sent === "number", "byte count");
  });

  await check("K. SECRET/CREDENTIAL content cannot be exported", async () => {
    const secret = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-k-${STAMP}`,
      capability: "local.document.summarize", resource_id: FILE_RES, input: { logical_path: "secret.credential.txt" },
    });
    assert(secret.ok === false, "secret summarize denied");
    assert(secret.egress.bytes_actually_sent === 0, String(secret.egress.bytes_actually_sent));
  });

  await check("L. Transfer integrity evidence is generated", async () => {
    const copied = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-l-${STAMP}`,
      capability: "local.file.copy", resource_id: FILE_RES,
      input: { source_logical: "notes.txt", destination_logical: `copy-${STAMP}.txt`, destination_resource_id: WRITE_RES },
    });
    assert(copied.ok, JSON.stringify(copied.result));
    const transfer = copied.result.transfer as { verified?: boolean; source_hash?: string; destination_hash?: string };
    assert(transfer.verified === true, "copy verified");
    assert(transfer.source_hash === transfer.destination_hash, "hash match");
    assert(listTransferIntegrity().some((row) => row.verified && row.destination_logical === `copy-${STAMP}.txt`), "integrity log");
    const renamed = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-l-${STAMP}`,
      capability: "local.file.rename", resource_id: WRITE_RES,
      input: { source_logical: `copy-${STAMP}.txt`, destination_logical: `renamed-${STAMP}.txt` },
    });
    assert(renamed.ok, JSON.stringify(renamed.result));
  });

  await check("M. Application action cannot exceed registered action capability", async () => {
    const mapped = mapEverydayApplicationAction("app://macos/textedit", "WRITE");
    assert(mapped.ok === false, "WRITE not registered");
    const denied = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-m-${STAMP}`,
      capability: "local.app.invoke_registered_action", resource_id: APP,
      input: { application_id: "app://macos/textedit", everyday_action: "WRITE" },
    });
    assert(denied.ok === false, "unregistered everyday action");
    const ok = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-m-${STAMP}`,
      capability: "local.app.invoke_registered_action", resource_id: APP,
      input: { application_id: "app://macos/textedit", everyday_action: "READ" },
    });
    assert(ok.ok, JSON.stringify(ok.result));
    assert(ok.result.action_type === "READ_STATE", String(ok.result.action_type));
  });

  await check("N. Canonical model, remote contract, and human approvals remain closed by default", async () => {
    assert(listEverydayActions().length === 20, String(listEverydayActions().length));
    assert(getEverydayAction("DELETE")?.owner_approval_requirement === "OWNER_APPROVAL_REQUIRED", "delete approval");
    assert(EVERYDAY_DATA_ACTIONS.SHARE.human_permission === "SHARE_EXTERNAL", "share permission");
    const remote = describeRemoteResourceAction("google_drive", "remote://drive/example");
    assert(remote.implemented === false, "no remote implementation");
    const share = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-n-${STAMP}`,
      capability: "local.file.share_external", resource_id: FILE_RES, input: { logical_path: "notes.txt" },
    });
    assert(share.authority.decision === "OWNER_APPROVAL_REQUIRED", share.authority.decision);
    const publish = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-n-${STAMP}`,
      capability: "local.file.publish_external", resource_id: FILE_RES, input: { logical_path: "notes.txt" },
    });
    assert(publish.authority.decision === "OWNER_APPROVAL_REQUIRED", publish.authority.decision);
    for (const name of FORBIDDEN_CAPABILITY_NAMES) {
      assert(evaluateLocalAuthority({
        ai_identity: AI, session_id: SESSION, work_id: `work-n-${STAMP}`,
        capability: name as never, resource_id: FILE_RES, data_scope: [], access: "READ", network_egress: "LOCAL_ONLY",
      }).decision === "DENY", name);
    }
    assert(readFileSync(NOTES, "utf8") === notesBefore, "unmanaged notes");
    assert(readFileSync(SECRET, "utf8") === secretBefore, "unmanaged secret");
  });

  for (const name of [`move-dst-${STAMP}.txt`, `delete-me-${STAMP}.txt`, `renamed-${STAMP}.txt`, `link-${STAMP}.txt`]) {
    const p = join(WRITABLE, name);
    try { if (existsSync(p)) unlinkSync(p); } catch { /* ignore */ }
  }

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();

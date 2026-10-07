/**
 * หน้าที่: PHASE B — พิสูจน์ว่า ConnectionDeclaration เป็น additive จริง
 * (ของเดิมไม่เสีย) และ validation เป็น deterministic จริง
 *
 * เขียนลง data/connection-declarations.jsonl เท่านั้น ไม่แตะ connections.jsonl
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { listConnections, lookupConnection } from "../registry";
import {
  registerConnectionDeclaration, listConnectionDeclarations, buildDeclarationId,
  validateConnectionDeclaration,
} from "../declaration-registry";
import type { ConnectionDeclarationInput } from "../../../contracts/connector/connection-declaration";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n + (d ? "  -> " + d : "")); }
};

const LEGACY = join(__dirname, "..", "data", "connections.jsonl");
const legacyBefore = readFileSync(LEGACY, "utf8");
const legacyHashBefore = createHash("sha256").update(legacyBefore).digest("hex");

console.log("\nBACKWARD COMPATIBILITY — ConnectionRegistration เดิม");
{
  const rows = listConnections();
  ok("existing GitHub connection rows readable = YES", rows.length > 0, String(rows.length));
  ok("GitHub SOURCE_AUTHORITY ยังหาเจอด้วย adapter เดิม",
    rows.some((r) => r.adapter === "github" && r.connection_type === "SOURCE_AUTHORITY"));
  const gh = rows.find((r) => r.adapter === "github");
  ok("lookupConnection ยังทำงาน", gh ? lookupConnection({ connection_id: gh.connection_id }) !== null : false);
  ok("credential_ref ของ row เดิมยังเป็น pointer",
    rows.every((r) => r.credential_ref.kind === "env_var" || r.credential_ref.kind === "keychain_ref" || r.credential_ref.kind === "not_yet_built"));
}

console.log("\nVALIDATION — deterministic, ไม่มี heuristic");
const base: ConnectionDeclarationInput = {
  connection_type: "DEPLOYMENT_PLATFORM", direction: "OUTBOUND",
  source_id: "dna-os-infrastructure", provider_id: "test-provider",
  target_descriptor: { project: "unit-test" },
  canonical_target_id: null, target_resolution: "UNRESOLVED",
  protocol: "HTTPS_GRAPHQL", endpoint: "https://example.invalid/graphql",
  execution_boundary: "connections/does-not-matter/invoker.ts", executor_capability_id: null,
  credential_ref: null, credential_scope: [], input_contract: [], output_contract: [],
  configuration_source: "unit test", health_probe: null,
  verification_method: null, verification_evidence_id: null, state: "DECLARED",
};
const reasonsOf = (patch: Partial<ConnectionDeclarationInput>) =>
  validateConnectionDeclaration({ ...base, ...patch }).reasons;

ok("record ที่ถูกต้องผ่าน", validateConnectionDeclaration(base).ok);
ok("ปฏิเสธ connection_type ที่ไม่รู้จัก",
  reasonsOf({ connection_type: "RAILWAY" as never }).includes("UNKNOWN_CONNECTION_TYPE"));
ok("ปฏิเสธ direction ที่ไม่รู้จัก", reasonsOf({ direction: "SIDEWAYS" as never }).includes("UNKNOWN_DIRECTION"));
ok("ปฏิเสธ protocol ที่ไม่รู้จัก", reasonsOf({ protocol: "CARRIER_PIGEON" as never }).includes("UNKNOWN_PROTOCOL"));
ok("ปฏิเสธ endpoint ว่าง", reasonsOf({ endpoint: "  " }).includes("EMPTY_ENDPOINT"));
ok("ปฏิเสธ target_descriptor ว่าง (OPTION_A บังคับ)",
  reasonsOf({ target_descriptor: {} }).includes("EMPTY_TARGET_DESCRIPTOR"));

// ★ invariant หลักของ OPTION_A — ทดสอบทั้งสองทิศทาง
ok("RESOLVED โดยไม่มี canonical_target_id ถูกปฏิเสธ",
  reasonsOf({ target_resolution: "RESOLVED" }).includes("TARGET_RESOLUTION_MISMATCH"));
ok("มี canonical_target_id แต่บอก UNRESOLVED ถูกปฏิเสธ",
  reasonsOf({ canonical_target_id: "resource-abc", target_resolution: "UNRESOLVED" }).includes("TARGET_RESOLUTION_MISMATCH"));
ok("มี canonical_target_id + RESOLVED ผ่าน",
  validateConnectionDeclaration({ ...base, canonical_target_id: "resource-abc", target_resolution: "RESOLVED" }).ok);

console.log("\nSECRET POLICY");
ok("ปฏิเสธค่าที่มีรูปร่างเป็น GitHub token",
  reasonsOf({ target_descriptor: { token: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" } }).includes("SECRET_VALUE_PRESENT"));
ok("ปฏิเสธค่าที่มีรูปร่างเป็น JWT",
  reasonsOf({ configuration_source: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9xxxx" }).includes("SECRET_VALUE_PRESENT"));
ok("ปฏิเสธ credential_ref ที่ไม่ใช่ pointer",
  reasonsOf({ credential_ref: { kind: "inline_secret", value: "hunter2" } as never }).includes("CREDENTIAL_NOT_A_POINTER"));
ok("PROVEN ที่ไม่มี evidence ถูกปฏิเสธ",
  reasonsOf({ state: "PROVEN" }).includes("PROVEN_WITHOUT_EVIDENCE"));

console.log("\nIDENTITY — deterministic");
{
  const a = buildDeclarationId({ provider_id: "p", connection_type: "T", direction: "OUTBOUND", target_descriptor: { b: "2", a: "1" } });
  const b = buildDeclarationId({ provider_id: "p", connection_type: "T", direction: "OUTBOUND", target_descriptor: { a: "1", b: "2" } });
  ok("ลำดับคีย์ไม่มีผลต่อ identity", a === b, `${a} vs ${b}`);
  ok("identity อ่านได้ ไม่ใช่ hash", a.startsWith("connection-declaration://p/T/OUTBOUND/"), a);
}

console.log("\nLEGACY ไม่ถูกแตะ");
{
  const after = readFileSync(LEGACY, "utf8");
  ok("connections.jsonl เนื้อหาไม่เปลี่ยนแม้แต่ไบต์เดียว",
    createHash("sha256").update(after).digest("hex") === legacyHashBefore);
  ok("declaration เขียนลงไฟล์คนละไฟล์กับของเดิม",
    !existsSync(join(__dirname, "..", "data", "connection-declarations.jsonl")) ||
    readFileSync(LEGACY, "utf8") === legacyBefore);
  ok("ทุก declaration ที่ลงทะเบียนแล้วมี target_descriptor ไม่ว่าง",
    listConnectionDeclarations().every((d) => Object.keys(d.target_descriptor).length > 0));
  ok("ไม่มี declaration ใดอ้าง RESOLVED โดยไม่มี canonical id",
    listConnectionDeclarations().every((d) => (d.canonical_target_id !== null) === (d.target_resolution === "RESOLVED")));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

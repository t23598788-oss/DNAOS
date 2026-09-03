import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readInstallationInitialization } from "../contract";
import { runLocalInitializationCeremony } from "../composition";
import { runTestOnlyLocalInitializationCeremony } from "./test-only-composition";
import { DNA_OS_STATE_ROOT_ENV } from "../../local-state-root/contract";

declare const process: { exitCode?: number; env: Record<string, string | undefined> };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
let passed = 0; let failed = 0;
const assert = (condition: boolean, message: string): void => { if (!condition) throw new Error(message); };
function check(name: string, body: () => void): void { try { body(); passed++; console.log(`PASS ${name}`); } catch (error) { failed++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); } }

const invocation = { schema_version: "LOCAL_INSTALLATION_CEREMONY_V1", operation: "INITIALIZE_INSTALLATION", authority_basis: "ONE_TIME_LOCAL_INSTALLATION_BOOTSTRAP_AXIOM", invocation_mode: "EXPLICIT_LOCAL_DIRECT_EXECUTION" } as const;
const now = "2026-08-29T12:00:00.000Z";

check("1. production composition remains disarmed", () => assert(runLocalInitializationCeremony(invocation).status === "NOT_READY", "production composition armed"));
check("2. production disarmed path does not mutate state", () => { const root = mkdtempSync(join(tmpdir(), "dna-disarmed-")); process.env[DNA_OS_STATE_ROOT_ENV] = root; runLocalInitializationCeremony(invocation); assert(readInstallationInitialization().state === "UNINITIALIZED" && !existsSync(join(root, "installation")), "disarmed path touched state"); delete process.env[DNA_OS_STATE_ROOT_ENV]; });
check("3. test-only composition creates isolated installation", () => { const root = mkdtempSync(join(tmpdir(), "dna-compose-")); const result = runTestOnlyLocalInitializationCeremony(invocation, root, now); assert(result.status === "INITIALIZATION_CREATED" && result.installation_id.startsWith("installation-") && result.initialization_id.startsWith("init-"), JSON.stringify(result)); });
check("4. evidence is typed and truthful", () => { const root = mkdtempSync(join(tmpdir(), "dna-evidence-")); const result = runTestOnlyLocalInitializationCeremony(invocation, root, now); assert(result.status === "INITIALIZATION_CREATED" && result.evidence.execution_context === "LOCAL_OS_USER_CONTEXT" && result.evidence.authority_basis === invocation.authority_basis, JSON.stringify(result)); });
check("5. initialized state does not generate another ID", () => { const root = mkdtempSync(join(tmpdir(), "dna-replay-")); const first = runTestOnlyLocalInitializationCeremony(invocation, root, now); const second = runTestOnlyLocalInitializationCeremony(invocation, root, now); assert(first.status === "INITIALIZATION_CREATED" && second.status === "ALREADY_INITIALIZED", JSON.stringify({ first, second })); });
check("6. corrupt state stops", () => { const root = mkdtempSync(join(tmpdir(), "dna-corrupt-")); const first = runTestOnlyLocalInitializationCeremony(invocation, root, now); void first; const fs = require("node:fs") as { writeFileSync(path: string, data: string): void }; fs.writeFileSync(join(root, "installation", "initialization.json"), "{broken"); const result = runTestOnlyLocalInitializationCeremony(invocation, root, now); assert(result.status === "CORRUPT", JSON.stringify(result)); });
check("7. invalid invocation never reaches writer", () => { const root = mkdtempSync(join(tmpdir(), "dna-invalid-")); const result = runTestOnlyLocalInitializationCeremony({ ...invocation, authority_basis: "owner" }, root, now); assert(result.status === "INVALID_INVOCATION" && !existsSync(join(root, "installation")), JSON.stringify(result)); });
check("8. no Owner or subsystem is created", () => { const root = mkdtempSync(join(tmpdir(), "dna-scope-")); const result = runTestOnlyLocalInitializationCeremony(invocation, root, now); assert(result.status === "INITIALIZATION_CREATED" && !("owner_id" in result) && !("subsystem_id" in result), JSON.stringify(result)); });

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

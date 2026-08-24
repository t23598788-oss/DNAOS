import { MacOsKeychainProvider } from "../provider";
import type { KeychainCommandRunner } from "../types";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void { if (!condition) throw new Error(message); }
async function check(name: string, body: () => Promise<void>): Promise<void> { try { await body(); passed++; console.log(`PASS ${name}`); } catch (error) { failed++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); } }

async function main(): Promise<void> {
  const ref = { service: "dna-os-test", account: "owner@example.test", kind: "api_key" as const };
  await check("uses only the fixed security find-generic-password command", async () => {
    let call: { executable: string; args: readonly string[] } | undefined;
    const run: KeychainCommandRunner = async (executable, args) => { call = { executable, args }; return { stdout: "dummy-secret", stderr: "", exitCode: 0 }; };
    const result = await new MacOsKeychainProvider({ commandRunner: run, platform: "darwin", auditPath: "/tmp/dna-os-keychain-test-audit.jsonl" }).resolve(ref);
    assert(result.ok && result.secret === "dummy-secret", "expected injected test result only");
    assert(call?.executable === "/usr/bin/security", "unexpected executable");
    assert(JSON.stringify(call?.args) === JSON.stringify(["find-generic-password", "-s", "dna-os-test", "-a", "owner@example.test", "-w"]), "unexpected security argv");
  });
  await check("never attempts to bypass a native security prompt", async () => {
    let args: readonly string[] = [];
    const run: KeychainCommandRunner = async (_executable, received) => { args = received; return { stdout: "", stderr: "User interaction is not allowed", exitCode: 36 }; };
    const result = await new MacOsKeychainProvider({ commandRunner: run, platform: "darwin", auditPath: "/tmp/dna-os-keychain-test-audit.jsonl" }).resolve(ref);
    assert(!result.ok && result.code === "PERMISSION_DENIED", "expected honest permission denial");
    assert(!args.includes("-A") && !args.includes("set-key-partition-list"), "bypass argument was attempted");
  });
  await check("rejects invalid references before any OS call", async () => {
    let called = false;
    const run: KeychainCommandRunner = async () => { called = true; return { stdout: "", stderr: "", exitCode: 0 }; };
    const result = await new MacOsKeychainProvider({ commandRunner: run, platform: "darwin" }).resolve({ ...ref, service: "/etc/passwd\n" });
    assert(!result.ok && result.code === "INVALID_REFERENCE" && !called, "invalid reference reached the OS");
  });
  await check("returns BLOCKED-equivalent non-macOS state and supports idempotency", async () => {
    const provider = new MacOsKeychainProvider({ platform: "linux" });
    const first = await provider.resolve(ref, { idempotencyKey: "wo-1" });
    assert(!first.ok && first.code === "NOT_MACOS", "expected non-macOS refusal");
    const second = await provider.resolve(ref, { idempotencyKey: "wo-1" });
    assert(!second.ok && second.code === "DUPLICATE_WORK_ORDER", "expected duplicate suppression");
  });
  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}
void main();

/**
 * หน้าที่: proves STAGE 1 (INGRESS) — ../resolver.ts's
 * `acceptIngressRequest()` — genuinely validates the bounded request
 * shape, fails closed on every malformed input, enforces target-within-
 * scope, and produces real, structured output a downstream stage
 * genuinely consumes (proven, not merely typed-compatible).
 *
 * How to run: npx tsx control/self-understanding-ingress/tests/ingress.test.ts
 */

import { acceptIngressRequest } from "../contract";
import { runDiscovery } from "../../repository-discovery/contract";
import { join } from "node:path";

declare const process: { exitCode?: number; cwd(): string };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
function check(name: string, body: () => void): void {
  try {
    body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function main(): void {
  check("A. a real, well-formed request -> ACCEPTED with the exact validated shape", () => {
    const result = acceptIngressRequest({ request_id: "req-a", target: "control/self-understanding-ingress", scope: "control", requested_capability: "inventory" });
    assert(result.status === "ACCEPTED", `expected ACCEPTED, got ${result.status}: ${result.reason_code}`);
    assert(result.validated_request?.target === "control/self-understanding-ingress", "expected the real normalized target");
    assert(result.validated_request?.scope === "control", "expected the real normalized scope");
  });

  check("B. missing request_id -> REJECTED, never fabricated", () => {
    const result = acceptIngressRequest({ target: "control/", scope: "control", requested_capability: "inventory" });
    assert(result.status === "REJECTED", `expected REJECTED, got ${result.status}`);
    assert(result.reason_code === "MISSING_REQUEST_ID", `expected MISSING_REQUEST_ID, got ${result.reason_code}`);
  });

  check("C. missing requested_capability -> REJECTED", () => {
    const result = acceptIngressRequest({ request_id: "req-c", target: "control/", scope: "control" });
    assert(result.status === "REJECTED", `expected REJECTED, got ${result.status}`);
    assert(result.reason_code === "MISSING_REQUESTED_CAPABILITY", `expected MISSING_REQUESTED_CAPABILITY, got ${result.reason_code}`);
  });

  check("D. absolute path target -> REJECTED, Agent cannot roam the filesystem via an absolute path", () => {
    const result = acceptIngressRequest({ request_id: "req-d", target: "/etc/passwd", scope: "", requested_capability: "inventory" });
    assert(result.status === "REJECTED", `expected REJECTED, got ${result.status}`);
    assert(result.reason_code?.startsWith("INVALID_TARGET") === true, `expected INVALID_TARGET, got ${result.reason_code}`);
  });

  check("E. path traversal in target -> REJECTED", () => {
    const result = acceptIngressRequest({ request_id: "req-e", target: "control/../../../etc/passwd", scope: "control", requested_capability: "inventory" });
    assert(result.status === "REJECTED", `expected REJECTED, got ${result.status}`);
    assert(result.reason_code?.startsWith("INVALID_TARGET") === true, `expected INVALID_TARGET, got ${result.reason_code}`);
  });

  check("F. target genuinely outside the declared scope -> REJECTED, the required bound is enforced", () => {
    const result = acceptIngressRequest({ request_id: "req-f", target: "software/registry-database", scope: "control", requested_capability: "inventory" });
    assert(result.status === "REJECTED", `expected REJECTED, got ${result.status}`);
    assert(result.reason_code?.startsWith("TARGET_OUTSIDE_SCOPE") === true, `expected TARGET_OUTSIDE_SCOPE, got ${result.reason_code}`);
  });

  check("G. scope=root (\"\") legitimately allows any real target -> ACCEPTED", () => {
    const result = acceptIngressRequest({ request_id: "req-g", target: "software/registry-database", scope: "", requested_capability: "inventory" });
    assert(result.status === "ACCEPTED", `expected ACCEPTED, got ${result.status}: ${result.reason_code}`);
  });

  check("H. target === scope exactly -> ACCEPTED (a request to inspect the whole declared scope itself)", () => {
    const result = acceptIngressRequest({ request_id: "req-h", target: "control/self-understanding-ingress", scope: "control/self-understanding-ingress", requested_capability: "inventory" });
    assert(result.status === "ACCEPTED", `expected ACCEPTED, got ${result.status}: ${result.reason_code}`);
  });

  check("I. malformed candidate (not an object) -> REJECTED, never throws", () => {
    const result = acceptIngressRequest("not-an-object");
    assert(result.status === "REJECTED", `expected REJECTED, got ${result.status}`);
    assert(result.reason_code === "MALFORMED_REQUEST", `expected MALFORMED_REQUEST, got ${result.reason_code}`);
  });

  check("J. REQUIRED PROOF — a real ACCEPTED request's validated_request.target is genuinely consumable by STAGE 2 (control/repository-discovery/'s real runDiscovery()) — the structurally mandatory downstream consumer", () => {
    const result = acceptIngressRequest({ request_id: "req-j", target: "control/self-understanding-ingress", scope: "control", requested_capability: "inventory" });
    assert(result.status === "ACCEPTED", `setup must accept, got ${result.status}: ${result.reason_code}`);
    const repoRoot = join(process.cwd(), result.validated_request!.target);
    const inventory = runDiscovery(repoRoot);
    assert(inventory.records.length > 0, "STAGE 2's real runDiscovery() must genuinely process STAGE 1's validated target and return a real, non-empty inventory");
    const foundSelf = inventory.records.some((r) => r.relative_path.endsWith("resolver.ts"));
    assert(foundSelf, "the real inventory must include this very capability's own resolver.ts — proving genuine, non-fabricated consumption");
  });

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();

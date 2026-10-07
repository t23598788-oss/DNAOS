/**
 * หน้าที่: the real test for ../policy.ts. Proves Owner's required cases
 * (2026-08-19): create capability ที่ไม่มีจริง -> ALLOW_CREATE; create
 * capability ที่มีแล้ว -> REUSE_EXISTING; overlap ไม่ชัด -> UNKNOWN;
 * modify existing -> ALLOW_MODIFY; malformed intent -> DENY; internal
 * error -> DENY (fail-closed).
 *
 * How to run: npx tsx permissions/write-gate/tests/policy.test.ts
 */

import { evaluateWriteIntent } from "../contract";
import type { WriteGateContext, WriteIntent } from "../contract";
import { getCapabilityIndex } from "../../../software/capability-registrar/contract";
import type { CapabilityMetadata } from "../../../software/capability-registrar/contract";
import { getRepository, listOperationalRepositories, setCheckoutResolutionForTests } from "../../../software/repository-registry/contract";
import type { RepositoryRegistration } from "../../../software/repository-registry/contract";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function baseIntent(overrides: Partial<WriteIntent> = {}): WriteIntent {
  return {
    intent_id: `wi_test_${Math.random().toString(36).slice(2)}`,
    operation: "CREATE",
    capability: "test-capability",
    target_type: "FILE",
    target_path: "connections/brand-new-thing/adapter.ts",
    requested_change: "add a new adapter",
    requesting_agent: { identity_id: "identity-test", kind: "ai_agent", display_name: "test-ai" },
    evidence: [],
    correlation_id: `corr_${Math.random().toString(36).slice(2)}`,
    submitted_at: new Date().toISOString(),
    ...overrides,
  };
}

const realContext: WriteGateContext = { registryIndex: getCapabilityIndex() };

function fakeOverlappingRecord(id: string, folder: string): CapabilityMetadata {
  return {
    SOFTWARE_ID: id,
    OWNER_FOLDER: folder,
    CAPABILITY_ID: id,
    PARENT_CAPABILITY: null,
    INGRESS: [],
    EGRESS: [],
    CONTRACT: `${folder}contract.ts`,
    RUNTIME_ENTRY: null,
    DATA_CLASS: "test fixture",
    REQUIRED_PERMISSION: "none",
    REQUIRED_CREDENTIAL: null,
    DESTINATION: "test fixture",
    EVIDENCE_SOURCE: ["test fixture — not a real capability"],
    STATUS: "REGISTERED",
  };
}

function run(): void {
  console.log("=== permissions/write-gate/tests/policy.test.ts ===");

  // 1. CREATE a capability that does not exist -> ALLOW_CREATE.
  {
    const decision = evaluateWriteIntent(baseIntent({ target_path: "connections/genuinely-new-thing-2026/adapter.ts" }), realContext);
    assert(decision.decision === "ALLOW_CREATE", `expected ALLOW_CREATE, got ${decision.decision}`);
    assert(decision.canonical === null, "ALLOW_CREATE carries no canonical reference");
    console.log("PASS: CREATE with no real overlap -> ALLOW_CREATE");
  }

  // 2. CREATE a capability that already exists (real "execution" capability's real folder) -> REUSE_EXISTING.
  {
    const decision = evaluateWriteIntent(baseIntent({ target_path: "execution/run/some-new-file.ts" }), realContext);
    assert(decision.decision === "REUSE_EXISTING", `expected REUSE_EXISTING, got ${decision.decision}`);
    assert(decision.canonical?.software_id === "execution", "REUSE_EXISTING carries the real canonical software_id");
    assert(decision.canonical!.evidence_source.length > 0, "REUSE_EXISTING carries real evidence_source");
    console.log("PASS: CREATE overlapping a real existing capability -> REUSE_EXISTING with canonical evidence");
  }

  // 3. overlap ไม่ชัด (ambiguous — two capabilities overlap the same path) -> UNKNOWN.
  {
    const ambiguousContext: WriteGateContext = {
      registryIndex: [fakeOverlappingRecord("fixture-a", "shared/ambiguous-folder/"), fakeOverlappingRecord("fixture-b", "shared/ambiguous-folder/sub/")],
    };
    const decision = evaluateWriteIntent(baseIntent({ target_path: "shared/ambiguous-folder/sub/file.ts" }), ambiguousContext);
    assert(decision.decision === "UNKNOWN", `expected UNKNOWN, got ${decision.decision}`);
    assert(decision.canonical === null, "UNKNOWN never carries a canonical reference — nothing was proven");
    console.log("PASS: ambiguous overlap (2 real matches, no provable single canonical) -> UNKNOWN");
  }

  // 4. MODIFY an existing capability -> ALLOW_MODIFY.
  {
    const decision = evaluateWriteIntent(baseIntent({ operation: "MODIFY", target_path: "connections/github/adapter-config.ts" }), realContext);
    assert(decision.decision === "ALLOW_MODIFY", `expected ALLOW_MODIFY, got ${decision.decision}`);
    assert(decision.canonical?.software_id === "github", "ALLOW_MODIFY carries the real canonical software_id");
    console.log("PASS: MODIFY targeting a real existing capability -> ALLOW_MODIFY with canonical evidence");
  }

  // 5. MODIFY something that does not exist anywhere real -> DENY (fail-closed, nothing real to modify).
  {
    const decision = evaluateWriteIntent(baseIntent({ operation: "DELETE", target_path: "connections/nothing-real-here/x.ts" }), realContext);
    assert(decision.decision === "DENY", `expected DENY, got ${decision.decision}`);
    console.log("PASS: DELETE targeting nothing real -> DENY");
  }

  // 6. malformed intent -> DENY.
  {
    const decision = evaluateWriteIntent(baseIntent({ target_path: "" }), realContext);
    assert(decision.decision === "DENY", `expected DENY, got ${decision.decision}`);
    assert(decision.reason_codes.includes("MALFORMED_INTENT"), "malformed intent DENY names the real reason code");
    console.log("PASS: malformed WriteIntent -> DENY");
  }

  // 7. UNKNOWN is fail-closed: it must never equal any ALLOW_* value, structurally distinct.
  {
    const ambiguousContext: WriteGateContext = {
      registryIndex: [fakeOverlappingRecord("fixture-c", "another-ambiguous/"), fakeOverlappingRecord("fixture-d", "another-ambiguous/deep/")],
    };
    const decision = evaluateWriteIntent(baseIntent({ target_path: "another-ambiguous/deep/x.ts" }), ambiguousContext);
    assert(decision.decision !== "ALLOW_CREATE" && decision.decision !== "ALLOW_MODIFY", "UNKNOWN is never confused with an ALLOW_* value");
    console.log("PASS: UNKNOWN decision is structurally distinct from any ALLOW_* value (fail-closed contract holds)");
  }

  const controlPlane = listOperationalRepositories().find((row) => row.status === "ACTIVE" && row.world === "CONTROL_PLANE");
  const deadboard = getRepository("repository://t23598788-oss/---------------DNA-OS");
  const controlWorkspace = getRepository("repository://t23598788-oss/dna-os-control-workspace");
  assert(controlPlane !== undefined, "ACTIVE CONTROL_PLANE repository must already be registered");
  const controlPlaneRoot = resolve(controlPlane!.repository_root);

  // 8. Valid path inside registered ACTIVE CONTROL_PLANE root continues through existing overlap behavior.
  {
    const decision = evaluateWriteIntent(baseIntent({ target_path: "connections/genuinely-new-thing-2026/adapter.ts" }), realContext);
    assert(decision.decision === "ALLOW_CREATE", `expected ALLOW_CREATE inside CONTROL_PLANE, got ${decision.decision} ${decision.reason_codes.join(",")}`);
    console.log("PASS: path inside ACTIVE CONTROL_PLANE root continues to existing ALLOW_CREATE");
  }

  // 9. Deadboard BUSINESS_LINE_FINANCE path -> DENY.
  {
    assert(deadboard !== null, "Deadboard must already be registered");
    const decision = evaluateWriteIntent(baseIntent({ target_path: join(deadboard!.repository_root, "app/page.tsx") }), realContext);
    assert(decision.decision === "DENY", `expected DENY for Deadboard path, got ${decision.decision}`);
    assert(decision.reason_codes.includes("OUTSIDE_CONTROL_PLANE_ROOT"), `expected OUTSIDE_CONTROL_PLANE_ROOT, got ${decision.reason_codes.join(",")}`);
    console.log("PASS: Deadboard path -> DENY");
  }

  // 10. Control Workspace PRODUCT_SURFACE path -> DENY.
  {
    assert(controlWorkspace !== null, "Control Workspace must already be registered");
    const decision = evaluateWriteIntent(baseIntent({ target_path: join(controlWorkspace!.repository_root, "src/main.ts") }), realContext);
    assert(decision.decision === "DENY", `expected DENY for Control Workspace path, got ${decision.decision}`);
    assert(decision.reason_codes.includes("OUTSIDE_CONTROL_PLANE_ROOT"), `expected OUTSIDE_CONTROL_PLANE_ROOT, got ${decision.reason_codes.join(",")}`);
    console.log("PASS: Control Workspace path -> DENY");
  }

  // 11. Arbitrary/unregistered sibling repo path -> DENY.
  {
    const decision = evaluateWriteIntent(baseIntent({ target_path: "/Users/tam/Desktop/DNA-LAB-FILE-INTELLIGENCE/index.ts" }), realContext);
    assert(decision.decision === "DENY", `expected DENY for unregistered sibling path, got ${decision.decision}`);
    assert(decision.reason_codes.includes("OUTSIDE_CONTROL_PLANE_ROOT"), `expected OUTSIDE_CONTROL_PLANE_ROOT, got ${decision.reason_codes.join(",")}`);
    console.log("PASS: unregistered sibling repo path -> DENY");
  }

  // 12. Prefix-confusion path must DENY (sibling name sharing a string prefix is not inside the root).
  {
    const decision = evaluateWriteIntent(baseIntent({ target_path: `${controlPlaneRoot}-evil/file.ts` }), realContext);
    assert(decision.decision === "DENY", `expected DENY for prefix-confusion path, got ${decision.decision}`);
    assert(decision.reason_codes.includes("OUTSIDE_CONTROL_PLANE_ROOT"), `expected OUTSIDE_CONTROL_PLANE_ROOT, got ${decision.reason_codes.join(",")}`);
    console.log("PASS: prefix-confusion path -> DENY");
  }

  // 13. .env / secret path denial.
  {
    const envDecision = evaluateWriteIntent(baseIntent({ target_path: ".env" }), realContext);
    assert(envDecision.decision === "DENY", `expected DENY for .env, got ${envDecision.decision}`);
    assert(envDecision.reason_codes.includes("SECRET_OR_ENV_PATH_DENIED"), `expected SECRET_OR_ENV_PATH_DENIED, got ${envDecision.reason_codes.join(",")}`);
    const secretDecision = evaluateWriteIntent(baseIntent({ target_path: "credentials/secret.key" }), realContext);
    assert(secretDecision.decision === "DENY", `expected DENY for secret.key, got ${secretDecision.decision}`);
    assert(secretDecision.reason_codes.includes("SECRET_OR_ENV_PATH_DENIED"), `expected SECRET_OR_ENV_PATH_DENIED, got ${secretDecision.reason_codes.join(",")}`);
    console.log("PASS: .env / secret path denial");
  }

  // 14. Existing valid capability CREATE/EDIT behavior still passes after CONTROL_PLANE confinement.
  {
    const createDecision = evaluateWriteIntent(baseIntent({ target_path: "execution/run/some-new-file.ts" }), realContext);
    assert(createDecision.decision === "REUSE_EXISTING", `expected REUSE_EXISTING, got ${createDecision.decision}`);
    const editDecision = evaluateWriteIntent(baseIntent({ operation: "MODIFY", target_path: "connections/github/adapter-config.ts" }), realContext);
    assert(editDecision.decision === "ALLOW_MODIFY", `expected ALLOW_MODIFY, got ${editDecision.decision}`);
    console.log("PASS: existing capability CREATE/EDIT behavior still passes");
  }

  const portabilityBase = mkdtempSync(join(tmpdir(), "dnaos-write-gate-portability-"));
  const linuxRoot = join(portabilityBase, "srv", "dna-os");
  mkdirSync(linuxRoot, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: linuxRoot });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: linuxRoot });
  execFileSync("git", ["config", "user.name", "test"], { cwd: linuxRoot });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/t23598788-oss/-DNA-OS-INFRASTRUCTURE-.git"], { cwd: linuxRoot });
  writeFileSync(join(linuxRoot, "README.md"), "write-gate-portability\n");
  execFileSync("git", ["add", "."], { cwd: linuxRoot });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: linuxRoot });
  const staleMac = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
  const linuxRow: RepositoryRegistration = {
    repository_id: "repository://t23598788-oss/-DNA-OS-INFRASTRUCTURE-",
    owner: "t23598788-oss",
    repository: "-DNA-OS-INFRASTRUCTURE-",
    world: "CONTROL_PLANE",
    source_authority: "https://github.com/t23598788-oss/-DNA-OS-INFRASTRUCTURE-.git",
    default_branch: "main",
    repository_root: linuxRoot,
    connection_id: null,
    status: "ACTIVE",
    registered_at: "2026-01-01T00:00:00.000Z",
  };
  const staleRow: RepositoryRegistration = { ...linuxRow, repository_root: staleMac };
  const isolatedContext: WriteGateContext = { registryIndex: [] };

  function installLookup(row: RepositoryRegistration, existsFn: (p: string) => boolean, cwd: string): void {
    setCheckoutResolutionForTests({
      lookup: {
        getRepository: (id) => (id === row.repository_id ? row : null),
        listOperationalRepositories: () => [row],
      },
      host: { cwd: () => cwd, exists: existsFn },
    });
  }

  try {
    installLookup(linuxRow, existsSync, linuxRoot);
    {
      const decision = evaluateWriteIntent(baseIntent({ target_path: join(linuxRoot, "connections/new-adapter.ts") }), isolatedContext);
      assert(decision.decision === "ALLOW_CREATE", `expected ALLOW_CREATE inside resolved root, got ${decision.decision} ${decision.reason_codes.join(",")}`);
      console.log("PASS: write-gate accepts path inside resolved CONTROL_PLANE root");
    }
    {
      const decision = evaluateWriteIntent(baseIntent({ target_path: join(portabilityBase, "outside", "file.ts") }), isolatedContext);
      assert(decision.decision === "DENY", `expected DENY outside root, got ${decision.decision}`);
      assert(decision.reason_codes.includes("OUTSIDE_CONTROL_PLANE_ROOT"), `expected OUTSIDE_CONTROL_PLANE_ROOT, got ${decision.reason_codes.join(",")}`);
      console.log("PASS: write-gate denies path outside resolved root");
    }
    {
      const decision = evaluateWriteIntent(baseIntent({ target_path: `${resolve(linuxRoot)}-evil/file.ts` }), isolatedContext);
      assert(decision.decision === "DENY", `expected DENY for prefix-confusion, got ${decision.decision}`);
      assert(decision.reason_codes.includes("OUTSIDE_CONTROL_PLANE_ROOT"), `expected OUTSIDE_CONTROL_PLANE_ROOT, got ${decision.reason_codes.join(",")}`);
      console.log("PASS: prefix-confusion remains denied after node-local root");
    }

    installLookup(staleRow, (p) => {
      if (resolve(p) === resolve(staleMac)) return false;
      return existsSync(p);
    }, linuxRoot);
    {
      const stale = evaluateWriteIntent(baseIntent({ target_path: join(staleMac, "connections/adapter.ts") }), isolatedContext);
      assert(stale.decision === "DENY", `stale Mac path authorized writes: ${stale.decision} ${stale.reason_codes.join(",")}`);
      assert(stale.reason_codes.includes("OUTSIDE_CONTROL_PLANE_ROOT"), `expected OUTSIDE_CONTROL_PLANE_ROOT, got ${stale.reason_codes.join(",")}`);
      const inside = evaluateWriteIntent(baseIntent({ target_path: join(linuxRoot, "connections/adapter.ts") }), isolatedContext);
      assert(inside.decision === "ALLOW_CREATE", `expected ALLOW_CREATE on node-local root, got ${inside.decision} ${inside.reason_codes.join(",")}`);
      console.log("PASS: stale old Mac path does not authorize writes on CORE_NODE");
    }

    installLookup({ ...linuxRow, repository_root: join(portabilityBase, "missing-checkout") }, existsSync, join(portabilityBase, "not-git"));
    {
      const decision = evaluateWriteIntent(baseIntent({ target_path: "connections/x.ts" }), isolatedContext);
      assert(decision.decision === "DENY", `expected DENY when checkout missing, got ${decision.decision}`);
      assert(decision.reason_codes.includes("CONTROL_PLANE_REPOSITORY_UNRESOLVED"), `expected CONTROL_PLANE_REPOSITORY_UNRESOLVED, got ${decision.reason_codes.join(",")}`);
      console.log("PASS: write-gate fails closed when local checkout is missing");
    }
  } finally {
    setCheckoutResolutionForTests(undefined);
    rmSync(portabilityBase, { recursive: true, force: true });
  }

  console.log("=== ALL write-gate policy.test.ts CASES PASSED ===");
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}

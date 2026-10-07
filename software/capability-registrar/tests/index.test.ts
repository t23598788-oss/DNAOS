/**
 * หน้าที่: the real test for ../index.ts. Proves: `getCapabilityIndex()`
 * is a real, lazily-computed, memoized projection of the real 6-entry
 * capability-registry.ts (not an invented/duplicate registry, and not
 * re-scanned on every call); findByCapabilityId/findByOwnerFolder work
 * against real entries; searchOverlap does literal folder-prefix matching
 * only (finds "execution" for a path under execution/run/, finds nothing
 * for a path with no real capability).
 *
 * How to run: npx tsx software/capability-registrar/tests/index.test.ts
 */

import { getCapabilityIndex, findByCapabilityId, findByOwnerFolder, searchOverlap } from "../contract";
import { listCapabilities } from "../../../control/command-router/contract";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function run(): void {
  console.log("=== software/capability-registrar/tests/index.test.ts ===");

  {
    const real = listCapabilities();
    const index = getCapabilityIndex();
    assert(index.length === real.length, `getCapabilityIndex() has one record per real capability-registry.ts entry (expected ${real.length}, got ${index.length})`);
    console.log(`PASS: getCapabilityIndex() is a real 1:1 projection of capability-registry.ts (${index.length} entries)`);
  }

  {
    const first = getCapabilityIndex();
    const second = getCapabilityIndex();
    assert(first === second, "repeated invocation must return the exact same memoized array reference, never re-scanning capability-registry.ts on every call");
    console.log("PASS: getCapabilityIndex() is genuinely memoized across repeated invocations");
  }

  {
    const execution = findByCapabilityId("execution");
    assert(execution !== undefined, "findByCapabilityId finds the real 'execution' entry");
    assert(execution!.STATUS === "CONNECTED", "execution's real health_status CONNECTED maps to CapabilityStatus CONNECTED");
    assert(execution!.OWNER_FOLDER === "execution/run/", `execution's OWNER_FOLDER is derived from its real contract path (got "${execution!.OWNER_FOLDER}")`);
    assert(execution!.PARENT_CAPABILITY === "COMMAND_ROUTER", "PARENT_CAPABILITY is the real, provable COMMAND_ROUTER node");
    console.log("PASS: findByCapabilityId resolves a real entry with correctly-derived fields");
  }

  {
    const fileIntel = findByCapabilityId("file-intelligence");
    assert(fileIntel !== undefined, "file-intelligence entry exists");
    assert(fileIntel!.STATUS === "REGISTERED", "NOT_CONNECTED health_status maps to REGISTERED, never CONNECTED (honest, not optimistic)");
    assert(fileIntel!.OWNER_FOLDER.startsWith("UNKNOWN — "), "a literal 'not_yet_built' contract field never resolves to a fake folder path");
    console.log("PASS: an unresolved contract path is reported honestly, not guessed");
  }

  {
    const byFolder = findByOwnerFolder("execution/run/");
    assert(byFolder?.CAPABILITY_ID === "execution", "findByOwnerFolder resolves the exact real folder");
    console.log("PASS: findByOwnerFolder works on a real folder path");
  }

  {
    const overlaps = searchOverlap("execution/run/some-new-file.ts");
    assert(overlaps.length === 1 && overlaps[0].CAPABILITY_ID === "execution", "a path under a real registered folder is found as a real overlap");
    console.log("PASS: searchOverlap finds a real literal folder-prefix match");
  }

  {
    const overlaps = searchOverlap("connections/some-brand-new-capability-that-does-not-exist/");
    assert(overlaps.length === 0, "a path with no real registered capability returns zero overlaps, never a guessed match");
    console.log("PASS: searchOverlap returns empty for a genuinely new path");
  }

  {
    const overlaps = searchOverlap("connections/github/adapter-config.ts");
    assert(overlaps.length === 1 && overlaps[0].CAPABILITY_ID === "github", "searchOverlap matches a real file inside a registered folder, not just the folder root");
    console.log("PASS: searchOverlap matches a file nested inside a registered folder");
  }

  console.log("=== ALL index.test.ts CASES PASSED ===");
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}

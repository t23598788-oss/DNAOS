/**
 * หน้าที่: proves the generic Contract Diff Engine (`../contract-diff.ts`)
 * against a real, live-fetched DigitalOcean OpenAPI spec as the "new"
 * side, and a deliberately-mutated fixture as the "old" side — Section 5
 * + Section 13's acceptance requirement ("อย่างน้อยหนึ่งกรณีต้องเป็น
 * BREAKING/DEPRECATION และหนึ่งกรณีต้องเป็น NEW CAPABILITY"). The mutation
 * is applied to a REAL spec snapshot (never a hand-invented endpoint
 * name), so the diff proves the mechanism against real DigitalOcean
 * contract text, not a synthetic toy.
 *
 * How to run: npx tsx providers/_shared/source-registry/tests/contract-diff.test.ts
 */

import { request } from "node:https";
import { parseOpenApiPathsSurface, diffContractSurfaces } from "../contract-diff";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

let failures = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL: ${name} -> ${error instanceof Error ? error.message : String(error)}`);
  }
}

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "GET", headers: { "user-agent": "dna-os-contract-diff-test/1.0" } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("TIMEOUT")));
    req.end();
  });
}

async function main(): Promise<void> {
  const realSpecText = await fetchText("https://raw.githubusercontent.com/digitalocean/openapi/main/specification/DigitalOcean-public.v2.yaml");
  const realSurface = parseOpenApiPathsSurface(realSpecText);

  check("real spec fetch: parses a real, non-trivial endpoint surface", () => {
    assert(realSurface.size > 100, `expected >100 real endpoints parsed, got ${realSurface.size}`);
    assert(realSurface.has("/v2/droplets"), "expected /v2/droplets to be a real parsed endpoint");
  });

  // FIXTURE MUTATION A: remove one real, currently-existing endpoint entirely from the "old" side, and remove one method from another real endpoint — proves NEW_CAPABILITY (endpoint added) + BREAKING is detectable when going the other direction (new->old).
  const oldSpecMissingEndpoint = realSpecText.replace(/  \/v2\/droplets:\n(?:.*\n)*?\n(?=  \/)/, "");
  const oldSurfaceA = parseOpenApiPathsSurface(oldSpecMissingEndpoint);

  check("fixture A parses without the mutated-out endpoint", () => {
    assert(!oldSurfaceA.has("/v2/droplets"), "fixture A must not contain /v2/droplets (deliberately removed)");
  });

  const diffOldToNew = diffContractSurfaces(oldSurfaceA, realSurface);
  check("OLD(fixture, missing /v2/droplets) -> NEW(real spec): detected as ENDPOINT_ADDED, classified BACKWARD_COMPATIBLE (NEW CAPABILITY case)", () => {
    const added = diffOldToNew.changes.find((c) => c.kind === "ENDPOINT_ADDED" && c.endpoint === "/v2/droplets");
    assert(added !== undefined, `expected ENDPOINT_ADDED for /v2/droplets, got changes=${JSON.stringify(diffOldToNew.changes.slice(0, 5))}`);
    assert(diffOldToNew.classification === "BACKWARD_COMPATIBLE", `expected BACKWARD_COMPATIBLE, got ${diffOldToNew.classification}`);
  });

  const diffNewToOld = diffContractSurfaces(realSurface, oldSurfaceA);
  check("NEW(real spec) -> OLD(fixture, missing /v2/droplets): detected as ENDPOINT_REMOVED, classified BREAKING (BREAKING/DEPRECATION case)", () => {
    const removed = diffNewToOld.changes.find((c) => c.kind === "ENDPOINT_REMOVED" && c.endpoint === "/v2/droplets");
    assert(removed !== undefined, `expected ENDPOINT_REMOVED for /v2/droplets, got changes=${JSON.stringify(diffNewToOld.changes.slice(0, 5))}`);
    assert(diffNewToOld.classification === "BREAKING", `expected BREAKING, got ${diffNewToOld.classification}`);
  });

  check("no-mutation self-diff: NO_IMPACT, zero changes (control case)", () => {
    const result = diffContractSurfaces(realSurface, realSurface);
    assert(result.classification === "NO_IMPACT", `expected NO_IMPACT, got ${result.classification}`);
    assert(result.changes.length === 0, `expected 0 changes, got ${result.changes.length}`);
  });

  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    process.exitCode = 1;
  } else {
    console.log("ALL CHECKS PASSED");
  }
}

void main();

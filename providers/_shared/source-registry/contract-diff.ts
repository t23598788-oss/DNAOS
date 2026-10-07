/**
 * หน้าที่: the GENERIC Contract Diff Engine — Section 5 (Owner correction):
 * OPENAPI SOURCE -> CONTRACT FINGERPRINT -> DIFF -> ENDPOINT/SCHEMA CHANGE
 * -> CAPABILITY IMPACT ANALYSIS -> LAB. Parses an OpenAPI v2/v3 YAML
 * spec's `paths:` section into `endpoint -> Set<method>` (real, honest
 * scope: this round diffs endpoint+method surface only, NOT the full
 * request/response JSON-schema each `$ref` points at — see this file's
 * own `KnownLimitation` export, not silently omitted).
 *
 * Never auto-modifies a production connector — this module only ever
 * PRODUCES a `ContractDiffResult`; nothing in this repo consumes that
 * result to change a connector automatically (no "DNA OS Lab" exists to
 * receive it yet — see `providers/digitalocean/README.md`'s own honest
 * gap note, same discipline as the Hostinger round's Lab finding).
 *
 * Input: two raw OpenAPI YAML texts (old, new).
 * Output: `parseOpenApiPathsSurface`, `diffContractSurfaces`,
 * `ContractDiffResult`.
 * Dependency ที่อนุญาต: none — leaf, pure text parsing.
 * สิ่งที่ห้ามแตะ: never write the raw spec text this module receives to
 * disk — callers pass it in memory and it is discarded when the call
 * returns; only the returned diff summary is meant to be logged/used.
 */

export type ContractChangeKind = "ENDPOINT_ADDED" | "ENDPOINT_REMOVED" | "METHOD_ADDED" | "METHOD_REMOVED";

export interface ContractChange {
  kind: ContractChangeKind;
  endpoint: string;
  method: string | null;
}

export interface ContractDiffResult {
  changes: readonly ContractChange[];
  classification: "NO_IMPACT" | "BACKWARD_COMPATIBLE" | "BREAKING";
  old_endpoint_count: number;
  new_endpoint_count: number;
}

export const KNOWN_LIMITATION = "Diffs the OpenAPI paths surface (endpoint + HTTP method) only. Request/response schema, required-field, and scope changes inside each endpoint's own $ref file are NOT parsed this round — a genuinely deeper diff would require fetching and parsing every referenced resources/**/*.yml file, out of this round's scope. This limitation is reported, not hidden.";

/** Parses only the top-level `paths:` block's `  /endpoint:` and nested `    method:` lines — real, minimal, honest about what it does not parse (request/response schema inside each $ref). */
export function parseOpenApiPathsSurface(specText: string): Map<string, Set<string>> {
  const surface = new Map<string, Set<string>>();
  const lines = specText.split("\n");
  let inPaths = false;
  let currentEndpoint: string | null = null;
  const methodPattern = /^\s{4}(get|post|put|patch|delete|head|options):\s*$/;
  const endpointPattern = /^\s{2}(\/\S*):\s*$/;

  for (const line of lines) {
    if (/^paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }
    if (!inPaths) continue;
    // A top-level (non-indented) key after `paths:` ends the paths block.
    if (/^\S/.test(line) && !/^paths:/.test(line)) break;

    const endpointMatch = line.match(endpointPattern);
    if (endpointMatch) {
      currentEndpoint = endpointMatch[1];
      if (!surface.has(currentEndpoint)) surface.set(currentEndpoint, new Set());
      continue;
    }
    const methodMatch = line.match(methodPattern);
    if (methodMatch && currentEndpoint) {
      surface.get(currentEndpoint)!.add(methodMatch[1]);
    }
  }
  return surface;
}

export function diffContractSurfaces(oldSurface: Map<string, Set<string>>, newSurface: Map<string, Set<string>>): ContractDiffResult {
  const changes: ContractChange[] = [];

  for (const [endpoint, methods] of newSurface) {
    if (!oldSurface.has(endpoint)) {
      changes.push({ kind: "ENDPOINT_ADDED", endpoint, method: null });
      continue;
    }
    const oldMethods = oldSurface.get(endpoint)!;
    for (const method of methods) if (!oldMethods.has(method)) changes.push({ kind: "METHOD_ADDED", endpoint, method });
  }
  for (const [endpoint, methods] of oldSurface) {
    if (!newSurface.has(endpoint)) {
      changes.push({ kind: "ENDPOINT_REMOVED", endpoint, method: null });
      continue;
    }
    const newMethods = newSurface.get(endpoint)!;
    for (const method of methods) if (!newMethods.has(method)) changes.push({ kind: "METHOD_REMOVED", endpoint, method });
  }

  const hasRemoval = changes.some((c) => c.kind === "ENDPOINT_REMOVED" || c.kind === "METHOD_REMOVED");
  const hasAddition = changes.some((c) => c.kind === "ENDPOINT_ADDED" || c.kind === "METHOD_ADDED");
  const classification: ContractDiffResult["classification"] = hasRemoval ? "BREAKING" : hasAddition ? "BACKWARD_COMPATIBLE" : "NO_IMPACT";

  return { changes, classification, old_endpoint_count: oldSurface.size, new_endpoint_count: newSurface.size };
}

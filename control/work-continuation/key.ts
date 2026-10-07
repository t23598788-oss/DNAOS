/**
 * หน้าที่: THE canonical dependency-key constructor. One function, used by BOTH
 * the producers that record what work is waiting for and the evaluator that
 * matches arriving evidence against it.
 *
 * WHY THIS FILE EXISTS. A private copy of this logic already lived in
 * `control/capability-creation/gate.ts#dependencyKey`, and that is exactly the
 * problem: it was not exported, so no other producer could reuse it, and it was
 * not even applied consistently inside its own file (three call sites there
 * built keys with raw template literals instead). Two producers building
 * slightly different strings for the same fact is the NEAR-MISS failure — and it
 * is silent. Nothing throws, no error is logged, the waiting row simply never
 * matches, and the work waits forever while looking exactly like "still
 * legitimately blocked". A collision would at least be noisy; a near-miss is not.
 *
 * So the constructor lives HERE, beside the evaluator that consumes the keys,
 * and is exported through `./contract.ts`. Both sides import the same function.
 *
 * REUSES EXISTING CANONICAL UTILITIES — no ad-hoc string manipulation:
 *   `control/realtime-change#toRepoRelative`   absolute/relative -> repo-relative
 *   `control/work-coordination#normalizeScopePath` strips leading/trailing "/",
 *                                              refuses "" , "/" and ".." escapes
 * Verified together, all four of these produce the identical key:
 *   `control/x`  `/control/x`  `control/x/`  `<REPO_ROOT>/control/x`
 *
 * Input: a namespace and a raw value.
 * Output: `dependencyKey`, `capabilityKeyOf`, `KEY_NAMESPACES`.
 * Dependency ที่อนุญาต: ../realtime-change/path-resolution.ts,
 * ../work-coordination/contract.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never let this function invent identity. If a value cannot be
 * canonicalised it is returned verbatim and stays UNKNOWN — an unmatched key
 * must never be quietly rewritten into one that happens to match something.
 */

import { toRepoRelative } from "../realtime-change/path-resolution";
import { normalizeScopePath } from "../work-coordination/contract";
import type { DependencyKey } from "./types";

/**
 * The namespaces in real use. Not enforced — `dependencyKey` accepts any
 * namespace, because the match is whole-string equality and a new producer must
 * not need this file edited before it can record a blocker. Listed so both sides
 * can see what already exists rather than inventing a near-duplicate.
 */
export const KEY_NAMESPACES = [
  // recorded by control/capability-creation's completion gate
  "contract_field", "trigger", "caller", "consumer", "routing", "runtime",
  "runtime_evidence", "verification", "registry", "path",
  // recorded by anything blocking on a first-class system fact
  "evidence", "resource", "capability", "external", "owner",
] as const;

/** Namespaces whose value is a repository path and therefore must be path-canonicalised. */
const PATH_VALUED = new Set([
  "path", "trigger", "caller", "consumer", "routing", "runtime",
  "runtime_evidence", "verification", "registry", "capability",
]);

/**
 * Build a canonical dependency key.
 *
 * A path-valued namespace is canonicalised through the two existing utilities in
 * sequence: `toRepoRelative` first (so an absolute path inside the repo becomes
 * repo-relative), then `normalizeScopePath` (so leading/trailing slashes are
 * stripped and a ".." escape is refused). A value carrying a `#symbol` suffix
 * keeps the suffix verbatim — only the path portion is canonicalised, because
 * the symbol is an identifier, not a path.
 *
 * A non-path namespace (`evidence`, `owner`, `external`, `contract_field`) is
 * used verbatim: those values are ids and field names, and normalising them as
 * paths would corrupt them.
 */
export function dependencyKey(namespace: string, value: string): DependencyKey {
  if (!PATH_VALUED.has(namespace)) return `${namespace}:${value}`;

  const [rawPath, ...symbolParts] = value.split("#");
  const symbol = symbolParts.length > 0 ? `#${symbolParts.join("#")}` : "";

  // toRepoRelative turns an absolute in-repo path into a repo-relative one and
  // returns anything outside the repo unchanged; normalizeScopePath then strips
  // the slashes. Applying only one of the two is not enough — "/control/x"
  // survives toRepoRelative and is only fixed by normalizeScopePath.
  // ORDER MATTERS, and getting it wrong is a real bug this capability's own
  // test caught twice:
  //
  //   toRepoRelative FIRST  -> `control/../../etc` becomes an absolute path,
  //     normalizeScopePath then strips the "/" and yields the plausible but
  //     entirely invented `path:Users/tam/Desktop/etc` (test 1E).
  //   refuse-all-absolutes  -> `/control/x`, the commonest near-miss spelling,
  //     is wrongly rejected as an escape (tests 1A/1C/B1).
  //
  // So `normalizeScopePath` runs FIRST as the escape gate: it returns null for
  // "", "/" and anything containing "..", which is exactly the refusal we want,
  // and otherwise strips leading/trailing slashes.
  const gated = normalizeScopePath(rawPath);
  if (gated === null) return `${namespace}:${rawPath}${symbol}`;

  // Only now resolve an ABSOLUTE in-repo path down to its repo-relative form.
  // If `toRepoRelative` still returns something absolute, the path lives outside
  // the repository and the slash-stripped form is the best honest answer.
  const relative = toRepoRelative(rawPath);
  const canonical = relative.startsWith("/") ? gated : (normalizeScopePath(relative) ?? gated);

  return `${namespace}:${canonical}${symbol}`;
}

/**
 * The canonical key for "this capability exists / is registered / is usable",
 * built from the census `path` form (e.g. `control/work-session-state`) — never
 * a display name and never a last segment. Both of those have already made a
 * real registration invisible in this repository.
 */
export function capabilityKeyOf(capabilityPath: string): DependencyKey {
  return dependencyKey("capability", capabilityPath);
}

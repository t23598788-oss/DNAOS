/**
 * หน้าที่: compose ONE canonical write-ownership index from the registries
 * that already exist, for `permissions/write-gate/` to be given as its
 * `WriteGateContext.registryIndex`.
 *
 * THE GATE IS NOT CHANGED, AND MUST NOT BE. `evaluateWriteIntent` and
 * `ruleRegistryLookup` are correct: a MODIFY needs exactly one registered
 * capability at the path, more than one is ambiguous, none is a denial. What
 * was wrong is what the callers handed it — `./index.ts#getCapabilityIndex`,
 * a projection of `control/command-router/`'s 12 ROUTABLE entries — while the
 * owner of a folder like `control/external-system-lifecycle/` lives among the
 * persistent software registry's ownership links. The denial was a true
 * statement about that index, not about ownership.
 *
 * NOT A BLANKET EXPANSION. Existing in the persistent registry earns nothing.
 * An entry is admitted ONLY when every one of these holds, and each is checked
 * against a real row:
 *   - the capability row's status is REGISTERED
 *   - a resource -> capability ownership link exists
 *   - the resource declares a folder `source_location`
 *   - that folder EXISTS on disk in this checkout
 * Anything short of that is excluded and reported, never assumed.
 *
 * NESTING IS RESOLVED BY COMPOSITION, NEVER BY WEAKENING THE GATE:
 *   - the same capability owning a parent and a child folder is collapsed to
 *     the parent. Keeping both would hand `searchOverlap` two rows for one
 *     path and manufacture an ambiguity that does not exist.
 *   - DIFFERENT capabilities owning nesting folders is a REAL ambiguity. Both
 *     rows stay, the gate returns AMBIGUOUS_OVERLAP, and that subtree remains
 *     DENY — which is the correct answer, not a gap to paper over.
 *
 * Input: none.
 * Output: `getWriteOwnershipIndex`, `composeWriteOwnershipIndex`,
 * `WriteOwnershipEntry`.
 * Dependency ที่อนุญาต: ./types.ts, ./index.ts, ../registry-database/contract.ts
 * (+ its persistent adapter), node:fs (folder existence only).
 * สิ่งที่ห้ามแตะ: never admit an entry without an `OWNERSHIP_EVIDENCE_REF`
 * naming the row that proves it. Never collapse two DIFFERENT capabilities to
 * remove an ambiguity — an ambiguity is a finding, and hiding it would grant
 * write permission nobody proved.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { getCapabilityIndex } from "./index";
import type { CapabilityMetadata } from "./types";
import { createPersistentFileStore } from "../registry-database/adapters/persistent-file-store";

const REPO_ROOT = join(__dirname, "..", "..");

/**
 * Paths that NEVER receive write ownership through this index, whatever the
 * registries say.
 *
 * Found by running the impact analysis before promotion, not by foresight:
 * composing the index made `permissions/write-gate/policy.ts` and
 * `credentials/macos-keychain/provider.ts` ALLOW_MODIFY. Both have complete,
 * genuine ownership chains — `write-gate` and
 * `macos-keychain-credential-provider` really do own those folders in the
 * persistent registry — so no rule about missing evidence would have caught
 * it. The problem is not the evidence, it is the consequence: a capability
 * able to rewrite the gate that judges every write, or the resolver that
 * hands out secrets, has defeated the control plane no matter how well
 * registered it is.
 *
 * This is an exclusion from OWNERSHIP, not a change to the gate. Writes to
 * these paths stay DENY with NO_MATCHING_CAPABILITY, exactly as they were
 * before this index existed — the composition grants nothing new here rather
 * than the gate refusing something it used to allow.
 *
 * Removing an entry from this list is an Owner decision and a security
 * boundary change, never a convenience during a repair.
 */
const NEVER_WRITE_OWNED: readonly { prefix: string; why: string }[] = [
  { prefix: "permissions/", why: "the gates that judge every write; a capability that can edit them can authorise itself" },
  { prefix: "credentials/", why: "credential resolvers; write access here is access to every secret they resolve" },
  { prefix: "governance/", why: "the architecture rules a change is judged against" },
  { prefix: "software/registry-database/data/", why: "the canonical registry rows that define ownership itself" },
  { prefix: "control/agent-gateway/data/", why: "the append-only evidence store; rewriting evidence rewrites history" },
];

/** One proven write-ownership record, with every field the Owner required. */
export interface WriteOwnershipEntry {
  readonly CAPABILITY_ID: string;
  readonly CANONICAL_NAME: string;
  readonly OWNED_PATH: string;
  readonly RESOURCE_ID: string | null;
  readonly REGISTRY_SOURCE: "command-router-registrar" | "persistent-software-registry";
  readonly OWNERSHIP_EVIDENCE_REF: string;
  readonly STATUS: string;
}

export interface ExcludedEntry {
  readonly candidate: string;
  readonly path: string | null;
  readonly reason: string;
}

export interface ComposedIndex {
  readonly entries: readonly WriteOwnershipEntry[];
  readonly excluded: readonly ExcludedEntry[];
  /** Paths owned by more than one distinct capability — these stay DENY. */
  readonly ambiguous_paths: readonly { path: string; owners: readonly string[] }[];
  /** Ready to hand straight to `evaluateWriteIntent` as `registryIndex`. */
  readonly registryIndex: readonly CapabilityMetadata[];
}

function normalizeFolder(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

/**
 * Compose the index. Pure with respect to the gate: it reads registries and
 * the filesystem, and returns data. It never evaluates a write.
 */
/** ประเภทของ record ที่มีไว้เป็นเจ้าของทรัพยากรสำหรับพิสูจน์เท่านั้น — ไม่ใช่สถานะ */
export const TEST_FIXTURE_TYPE = "TEST_FIXTURE";
/** เขตเดียวที่ TEST_FIXTURE เป็นเจ้าของได้ */
export const TEST_FIXTURE_ROOT = "tests/__sandbox__/";

export function composeWriteOwnershipIndex(): ComposedIndex {
  const entries: WriteOwnershipEntry[] = [];
  const excluded: ExcludedEntry[] = [];

  // --- source 1: the existing capability-registrar projection ------------
  // Included unchanged so today's twelve decisions are preserved exactly.
  // Its own unresolved-folder rows are excluded by the same rule
  // `searchOverlap` already applies to them.
  for (const record of getCapabilityIndex()) {
    const metadata = record as unknown as CapabilityMetadata & { OWNER_FOLDER: string; CAPABILITY_ID: string; STATUS: string; EVIDENCE_SOURCE?: string };
    if (!metadata.OWNER_FOLDER || metadata.OWNER_FOLDER.startsWith("UNKNOWN")) {
      excluded.push({ candidate: metadata.CAPABILITY_ID, path: metadata.OWNER_FOLDER ?? null,
        reason: "capability-registrar row has no resolvable OWNER_FOLDER (endpoint is not_yet_built) — DECLARED_ONLY, write ownership not proven" });
      continue;
    }
    entries.push({
      CAPABILITY_ID: metadata.CAPABILITY_ID,
      CANONICAL_NAME: metadata.CAPABILITY_ID,
      OWNED_PATH: normalizeFolder(metadata.OWNER_FOLDER),
      RESOURCE_ID: null,
      REGISTRY_SOURCE: "command-router-registrar",
      OWNERSHIP_EVIDENCE_REF: metadata.EVIDENCE_SOURCE ?? `control/command-router/capability-registry.ts#${metadata.CAPABILITY_ID}`,
      STATUS: metadata.STATUS ?? "REGISTERED",
    });
  }

  // --- source 2: persistent software registry ownership links ------------
  let store: ReturnType<typeof createPersistentFileStore> | null = null;
  try { store = createPersistentFileStore(); } catch (error) {
    excluded.push({ candidate: "persistent-software-registry", path: null,
      reason: `unreadable: ${error instanceof Error ? error.message : String(error)}` });
  }

  if (store) {
    const capabilityRows = store.listCapabilityRows ? store.listCapabilityRows() : [];
    const resourceRows = store.listResourceRows ? store.listResourceRows() : [];
    const links = store.listResourceCapabilityLinks ? store.listResourceCapabilityLinks() : [];
    const capabilityById = new Map(capabilityRows.map((c) => [c.capability_id, c]));

    for (const resource of resourceRows) {
      const sourceLocation = (resource as unknown as { source_location?: string }).source_location;
      const resourceId = resource.resource_id;

      if (typeof sourceLocation !== "string" || !sourceLocation.endsWith("/")) {
        // A file-level or symbol-level resource declares no owned FOLDER, and
        // folder ownership is what the gate matches on. Not an error.
        continue;
      }
      const link = links.find((l) => l.resource_id === resourceId);
      if (!link) {
        excluded.push({ candidate: resourceId, path: sourceLocation,
          reason: "no resource -> capability ownership link exists" });
        continue;
      }
      const capability = capabilityById.get(link.capability_id);
      if (!capability) {
        excluded.push({ candidate: resourceId, path: sourceLocation,
          reason: `link names capability ${link.capability_id} which has no row` });
        continue;
      }
      if (capability.status !== "REGISTERED") {
        excluded.push({ candidate: capability.canonical_name, path: sourceLocation,
          reason: `capability status is ${capability.status}, not REGISTERED` });
        continue;
      }
      /**
       * TEST_FIXTURE PATH GUARD (Owner, FIX_TEST_FIXTURE_OWNERSHIP).
       *
       * A fixture record is a REAL, fully REGISTERED row — its lifecycle state is
       * identical to a production capability's, deliberately: a half-registered
       * state would have produced a record that owns nothing and therefore proves
       * nothing. What separates it is its TYPE, and this is the one place that type
       * has teeth — a TEST_FIXTURE may own paths under `tests/__sandbox__/` and
       * nowhere else.
       *
       * The check reads the resolved, normalized path, never prose in `purpose`:
       * a text field cannot be an authorization boundary. A fixture row that names
       * a production path is dropped from the ownership index WITH its reason
       * recorded, so the attempt stays visible instead of silently ignored.
       */
      if ((capability as { capability_type?: string }).capability_type === TEST_FIXTURE_TYPE
          && !normalizeFolder(sourceLocation).startsWith(TEST_FIXTURE_ROOT)) {
        excluded.push({ candidate: capability.canonical_name, path: sourceLocation,
          reason: `capability_type=${TEST_FIXTURE_TYPE} may only own paths under ${TEST_FIXTURE_ROOT} — refused` });
        continue;
      }
      if (!existsSync(join(REPO_ROOT, sourceLocation))) {
        // A declared path that is not in this checkout is not a verified
        // source_location. Admitting it would grant write ownership over
        // something nobody can point at.
        excluded.push({ candidate: capability.canonical_name, path: sourceLocation,
          reason: "declared source_location does not exist in this checkout — ownership not verified" });
        continue;
      }
      entries.push({
        CAPABILITY_ID: capability.capability_id,
        CANONICAL_NAME: capability.canonical_name,
        OWNED_PATH: normalizeFolder(sourceLocation),
        RESOURCE_ID: resourceId,
        REGISTRY_SOURCE: "persistent-software-registry",
        OWNERSHIP_EVIDENCE_REF: `software/registry-database/data/canonical/resources.jsonl#${resourceId} -> resource_capabilities.jsonl -> capabilities.jsonl#${capability.capability_id}`,
        STATUS: capability.status,
      });
    }
  }

  // --- security-critical exclusion, applied to BOTH sources --------------
  // Applied after collection so the exclusion is recorded with its reason
  // rather than silently skipping rows during the walk.
  const admitted: WriteOwnershipEntry[] = [];
  const registrarPaths = new Set(
    entries.filter((e) => e.REGISTRY_SOURCE === "command-router-registrar").map((e) => e.OWNED_PATH));
  for (const entry of entries) {
    // The exclusion applies to NEWLY added ownership only. Applied to
    // everything it removed `permissions/execution-policy/` — a path the
    // original twelve already granted to `permission-reasoner` — turning a
    // standing ALLOW_MODIFY into DENY. That is a regression, not a
    // protection: this composition may refuse to ADD ownership, never take
    // away ownership that already existed.
    const forbidden = entry.REGISTRY_SOURCE === "persistent-software-registry"
      ? NEVER_WRITE_OWNED.find((rule) => entry.OWNED_PATH.startsWith(rule.prefix))
      : undefined;
    if (forbidden) {
      excluded.push({ candidate: entry.CANONICAL_NAME, path: entry.OWNED_PATH,
        reason: `SECURITY_CRITICAL: ${forbidden.why}. Ownership is real and registered; write ownership through this index is refused, and the path stays DENY exactly as before.` });
      continue;
    }
    // A path the command-router registrar already claims keeps that claim as
    // its single owner. A persistent-registry row for the same folder is the
    // same ownership recorded under a different canonical name, and adding it
    // as a SECOND owner turned `execution/run/`, `connections/github/` and
    // `connections/digitalocean/` — all ALLOW_MODIFY today — into
    // AMBIGUOUS_OVERLAP. Source 1 is authoritative for the paths it names.
    if (entry.REGISTRY_SOURCE === "persistent-software-registry" && registrarPaths.has(entry.OWNED_PATH)) {
      excluded.push({ candidate: entry.CANONICAL_NAME, path: entry.OWNED_PATH,
        reason: "the command-router registrar already claims this exact path; adding a second owner would manufacture an ambiguity and change a standing decision" });
      continue;
    }
    admitted.push(entry);
  }

  // --- dedup: one row per (path, capability) -----------------------------
  // Two rows describing the same folder AND the same capability are the same
  // ownership fact recorded twice; keeping both hands `searchOverlap` two hits
  // and turns one owner into an ambiguity.
  //
  // The key is CANONICAL_NAME, not CAPABILITY_ID, and that distinction was
  // found by the impact analysis rather than reasoned out: the SAME real
  // capability carries different ids in the two sources — `research-engine`
  // in the command-router projection, `capability-<uuid>` in the persistent
  // registry — so keying on id let eight paths that are ALLOW_MODIFY today
  // (research-engine, execution, github, os-login, os-ui, digitalocean and
  // two more) become AMBIGUOUS. That is a regression the composition caused,
  // not an ambiguity the registries contain. The canonical name is the field
  // both sources agree on, so it is the field identity is judged by.
  const deduped: WriteOwnershipEntry[] = [];
  const seen = new Set<string>();
  for (const entry of admitted) {
    const key = `${entry.OWNED_PATH}|${entry.CANONICAL_NAME}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }

  // --- nesting: exact path ownership wins over prefix ownership ----------
  // Only when the OWNER IS THE SAME. A deeper folder owned by the same
  // capability adds nothing and would manufacture an ambiguity; a deeper
  // folder owned by a DIFFERENT capability is a real ambiguity and both rows
  // stay so the gate can say DENY.
  const collapsed = deduped.filter((entry) => {
    const shallowerSameOwner = deduped.find((other) =>
      other !== entry
      && other.CANONICAL_NAME === entry.CANONICAL_NAME
      && entry.OWNED_PATH.startsWith(other.OWNED_PATH)
      && entry.OWNED_PATH !== other.OWNED_PATH);
    return !shallowerSameOwner;
  });

  // --- report real ambiguity --------------------------------------------
  const byPath = new Map<string, Set<string>>();
  for (const entry of collapsed) {
    if (!byPath.has(entry.OWNED_PATH)) byPath.set(entry.OWNED_PATH, new Set());
    byPath.get(entry.OWNED_PATH)!.add(entry.CANONICAL_NAME);
  }
  const ambiguous: { path: string; owners: string[] }[] = [];
  for (const [path, owners] of byPath) {
    if (owners.size > 1) ambiguous.push({ path, owners: [...owners] });
  }
  // Nesting between different owners is ambiguity too — recorded so the impact
  // report names it rather than leaving it to be discovered at a gate.
  for (const entry of collapsed) {
    for (const other of collapsed) {
      if (other === entry || other.CANONICAL_NAME === entry.CANONICAL_NAME) continue;
      if (entry.OWNED_PATH.startsWith(other.OWNED_PATH) && entry.OWNED_PATH !== other.OWNED_PATH) {
        if (!ambiguous.some((a) => a.path === entry.OWNED_PATH)) {
          ambiguous.push({ path: entry.OWNED_PATH, owners: [entry.CANONICAL_NAME, other.CANONICAL_NAME] });
        }
      }
    }
  }

  const registryIndex = collapsed.map((entry) => ({
    SOFTWARE_ID: entry.CANONICAL_NAME,
    CAPABILITY_ID: entry.CANONICAL_NAME,
    OWNER_FOLDER: entry.OWNED_PATH,
    PARENT_CAPABILITY: null,
    STATUS: entry.STATUS,
    EVIDENCE_SOURCE: entry.OWNERSHIP_EVIDENCE_REF,
  })) as unknown as readonly CapabilityMetadata[];

  return { entries: collapsed, excluded, ambiguous_paths: ambiguous, registryIndex };
}

/**
 * THE one shared source every Write Gate caller uses. Memoized on first real
 * call, for the same reason `./index.ts#getCapabilityIndex` is: composing at
 * module-load time would reach into the registries while other modules are
 * still loading, and that has already caused one real import cycle in this
 * repo.
 */
let cached: ComposedIndex | null = null;

export function getWriteOwnershipIndex(): readonly CapabilityMetadata[] {
  if (cached === null) cached = composeWriteOwnershipIndex();
  return cached.registryIndex;
}

/** Full composition detail, for impact analysis and audit. Never memoized away. */
export function inspectWriteOwnershipIndex(): ComposedIndex {
  return composeWriteOwnershipIndex();
}

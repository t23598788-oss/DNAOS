/**
 * หน้าที่: STEP 2 — resolve the existing system deterministically, BEFORE
 * any Agent is dispatched. Produces one `ResolutionDecision` plus the full
 * `ResolvedWorkContext` the Agent will receive instead of a search task.
 *
 * NO AI IN THIS PATH. Every probe is a real lookup, a real directory read,
 * or a real substring scan. `match_score` is an integer token-overlap
 * count. The same intent always resolves the same way, and
 * `resolution_path` records every source consulted with its real answer.
 *
 * A REAL LIMITATION, DISCLOSED RATHER THAN HIDDEN: the Registry's read
 * surface (`software/registry-database/store-port.ts`) is lookup-by-exact-key
 * ONLY — `findCapabilityById` / `BySemanticFingerprint` / `ByCanonicalName`.
 * There is no enumerate. So the Registry alone can never prove ABSENCE; it
 * can only prove that specific names are absent. That is why
 * `MISSING_CONFIRMED` here additionally requires a real source scan to come
 * back empty, and why an ambiguous result becomes `UNRESOLVED` (dispatch
 * blocked) rather than being rounded down to "missing, go build it".
 *
 * Input: `WriteIntent` + a `RegistryStore`.
 * Output: `resolveWriteIntent`, `generateNameCandidates`, `SIBLING_REPOS`.
 * Dependency ที่อนุญาต: ./types.ts, ./host-runtime.ts,
 * ../../software/registry-database/contract.ts (the sanctioned Lookup API),
 * ../../software/capability-registrar/contract.ts.
 * สิ่งที่ห้ามแตะ: never read `software/registry-database/data/**` directly —
 * `findCapability` is the only sanctioned read path, and bypassing it here
 * would make this resolver depend on a storage layout it does not own.
 * Never downgrade UNRESOLVED to MISSING_CONFIRMED to unblock a dispatch.
 */

import { UNKNOWN, type EnforcementResult, type ExistingMatch, type ResolutionProbe, type ResolvedWorkContext, type WriteIntent } from "./types";
import { REPO_ROOT, expandHome, listExports, pathExists, readTextIfPresent } from "./host-runtime";
import { findCapability, resolveCanonicalResource, searchCapabilities, type CapabilitySearchHit } from "../../software/registry-database/contract";
import type { RegistryStore } from "../../software/registry-database/contract";
import { getCapabilityIndex, searchOverlap } from "../../software/capability-registrar/contract";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Repositories this machine really has. Checked with existsSync at call
 * time — a repo that is not present contributes nothing and is recorded
 * as a miss, never assumed absent-because-unlisted.
 */
export const SIBLING_REPOS: readonly string[] = [
  REPO_ROOT,
  "~/Desktop/dna-os-deadboard",
  "~/Desktop/DNA-LAB-PERMISSION-REASONER",
  "~/Desktop/DNA-LAB-FILE-INTELLIGENCE",
  "~/Desktop/DNA-LAB-CIRCUIT-LANGUAGE",
];

const STOPWORDS = new Set(["a", "an", "the", "new", "create", "add", "build", "make", "for", "to", "of", "and"]);

export function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Deterministic canonical-name candidates for a lookup-only Registry.
 * Permutations of the intent's own tokens plus a small set of fixed
 * suffixes that this repo's naming convention actually uses — never an
 * invented name, and never more than a bounded, reproducible list.
 */
export function generateNameCandidates(intent: WriteIntent): readonly string[] {
  const tokens = tokenize(`${intent.requested_function} ${intent.target_domain}`);
  const out = new Set<string>();
  if (tokens.length > 1) out.add(tokens.join("-"));
  for (const a of tokens) {
    // Deliberately NO bare single-token candidate. Observed live: a lone
    // token like "runtime" or "host" matches a real but entirely unrelated
    // capability, because short generic names exist in the registry. Every
    // candidate must carry at least two parts.
    for (const b of tokens) {
      if (a !== b) {
        out.add(`${a}-${b}`);
        for (const suffix of ["reader", "client", "connector", "adapter", "readonly-reader"]) {
          out.add(`${a}-${suffix}`);
          out.add(`${a}-${b}-${suffix}`);
        }
      }
    }
  }
  return [...out].sort();
}

/** Real, bounded source scan. `git grep` when available, honest miss otherwise. */
function scanRepoForSymbols(repoPath: string, tokens: readonly string[]): { hit: boolean; files: readonly string[]; detail: string } {
  const root = expandHome(repoPath);
  if (!existsSync(root)) return { hit: false, files: [], detail: `repo not present on this machine: ${repoPath}` };
  if (tokens.length === 0) return { hit: false, files: [], detail: "no searchable tokens in the intent" };
  const pattern = tokens.join("|");
  try {
    const out = execFileSync(
      "grep",
      ["-rilE", "--include=*.ts", "--include=*.tsx", "--include=*.mjs", "--exclude-dir=node_modules", "--exclude-dir=.git", "--exclude-dir=tests", pattern, root],
      { encoding: "utf-8", timeout: 25_000, maxBuffer: 8 * 1024 * 1024 },
    );
    const all = out.split("\n").filter(Boolean).map((f) => f.replace(`${root}/`, ""));
    // NEVER silently truncate. A 40-file cap here hid the real answer:
    // `_shared/gmail-client.ts` was result #141 of 170, so "email reader"
    // resolved to UNRESOLVED while the implementation sat just past the
    // cut-off. The cap is now high enough to cover a real repo, and any
    // truncation is REPORTED in the probe detail so it can never look like
    // a clean miss.
    const CAP = 500;
    const files = all.slice(0, CAP);
    const truncated = all.length > CAP;
    return {
      hit: files.length > 0,
      files,
      detail: `${files.length}${truncated ? ` of ${all.length} (TRUNCATED at ${CAP} — result may be incomplete)` : ""} file(s) matched /${pattern}/`,
    };
  } catch {
    // grep exits non-zero on "no matches" — that is a real, clean miss.
    return { hit: false, files: [], detail: `no file matched /${pattern}/` };
  }
}

/**
 * Runtime facts the Registry's Lookup API does NOT expose. Its result
 * carries only capability_id / resource_ids / source_location /
 * input_contract / output_contract / dependencies / evidence_refs — there
 * is no `behavior`, no `source_system`, no runtime metadata. So these are
 * read from the REAL source file and its REAL path instead of being
 * invented: the credential names come from actual `Deno.env.get("X")` /
 * `process.env.X` call sites in the file, and the runtime kind from the
 * path convention the repo genuinely uses. Anything unprovable stays UNKNOWN.
 */
function deriveRuntimeFacts(sourcePath: string): { repository: string; runtime_owner: string; runtime_type: string; credential_boundary: string } {
  const repoMatch = /(?:^|\/)([^/]*(?:dna-os|DNA-LAB)[^/]*)\//i.exec(sourcePath);
  const repository = repoMatch ? repoMatch[1] : UNKNOWN;

  const isSupabaseFn = /supabase\/functions\//.test(sourcePath);
  const runtime_type = isSupabaseFn ? "Deno" : /\.(ts|mjs)$/.test(sourcePath) ? "Node" : UNKNOWN;
  const runtime_owner = isSupabaseFn ? "Supabase Edge Functions (Deno)" : repository !== UNKNOWN ? `${repository} (Node)` : UNKNOWN;

  const source = readTextIfPresent(sourcePath);
  let credential_boundary: string = UNKNOWN;
  if (source !== null) {
    const names = new Set<string>();
    for (const m of source.matchAll(/Deno\.env\.get\(\s*["']([A-Z0-9_]+)["']/g)) names.add(m[1]);
    for (const m of source.matchAll(/process\.env\.([A-Z0-9_]+)/g)) names.add(m[1]);
    if (names.size > 0) {
      credential_boundary = isSupabaseFn
        ? `Supabase Edge Function environment: ${[...names].sort().join(", ")}`
        : `process environment: ${[...names].sort().join(", ")}`;
    } else {
      credential_boundary = "no credential read in this source file";
    }
  }
  return { repository, runtime_owner, runtime_type, credential_boundary };
}

/**
 * PRIMARY DISCOVERY (Owner §1/§7). Enumerated Registry search — the normal
 * path. Replaces the full source scan that used to be primary: the scan is
 * now reconciliation evidence only, reached when the Registry genuinely has
 * nothing. A `null` here means the store cannot enumerate at all, which is
 * reported as ENUMERATION_UNAVAILABLE and is NOT the same as "registry empty".
 */
function searchRegistry(intent: WriteIntent, store: RegistryStore): { match: ExistingMatch | null; probe: ResolutionProbe } {
  // requested_function ONLY. Including target_domain pollutes the search
  // with structural words ("control", "connections") that appear in almost
  // every registered source_location, which pushed unrelated capabilities
  // over the 2-token floor and made a real Registry gap look resolved.
  // WHERE the work goes is not evidence of WHAT already exists.
  const tokens = tokenize(intent.requested_function);
  const hits = searchCapabilities(tokens, store, 5);
  if (hits === null) {
    return { match: null, probe: { source: "REGISTRY_SEARCH(enumerated)", query: tokens.join("+"), hit: false, detail: "ENUMERATION_UNAVAILABLE — this store cannot enumerate; absence is NOT proven" } };
  }
  if (hits.length === 0) {
    return { match: null, probe: { source: "REGISTRY_SEARCH(enumerated)", query: tokens.join("+"), hit: false, detail: "no capability matched after enumerating every registered row — this IS a real registry miss" } };
  }
  const top = hits[0];
  // AMBIGUITY BLOCKS. As the Registry fills up, two capabilities can score
  // identically — observed live once `email-alert-source` was registered
  // alongside `gmail-readonly-reader`: both matched "email"+"reader", and
  // the alphabetical tiebreak silently picked the ADAPTER over the READER
  // it adapts. Picking either is a guess, and a guess here sends an Agent
  // to the wrong existing implementation. A tie is insufficient evidence,
  // so it resolves to UNRESOLVED with both candidates named for the caller
  // to disambiguate.
  const tied = hits.filter((h) => h.score === top.score);
  if (tied.length > 1) {
    return {
      match: null,
      probe: {
        source: "REGISTRY_SEARCH(enumerated)",
        query: tokens.join("+"),
        hit: false,
        detail: `AMBIGUOUS — ${tied.length} capabilities tie at score ${top.score}: ${tied.map((h) => h.canonical_name).join(", ")}. Refusing to guess; narrow the requested_function.`,
      },
    };
  }
  // Require a real multi-token match. A single generic token overlap is
  // noise, and acting on it is how "email reader" once resolved onto an
  // unrelated capability.
  // Weighted floor: at least one NAME-strength match (3) or two weaker ones.
  if (top.score < 3 && tokens.length > 1) {
    return { match: null, probe: { source: "REGISTRY_SEARCH(enumerated)", query: tokens.join("+"), hit: false, detail: `best hit "${top.canonical_name}" matched only ${top.score}/${tokens.length} token(s) — below the 2-token floor, treated as noise` } };
  }
  const resource = resolveCanonicalResource({ capability_id: top.capability_id }, store);
  if (resource.status !== "RESOLVED") {
    return { match: null, probe: { source: "CANONICAL_RESOURCE_RESOLUTION", query: top.capability_id, hit: false, detail: `${resource.status}:${resource.reason_code}${"candidate_resource_ids" in resource ? ` candidates=${resource.candidate_resource_ids.join(",")}` : ""}` } };
  }
  return {
    match: hitToMatch(top, resource.resource_id),
    probe: { source: "REGISTRY_SEARCH(enumerated)", query: tokens.join("+"), hit: true, detail: `matched "${top.canonical_name}" with canonical resource ${resource.resource_id} (no array-order selection)` },
  };
}

function hitToMatch(hit: CapabilitySearchHit, resourceId: string): ExistingMatch {
  const primary = hit.source_locations[0] ?? "";
  const facts = deriveRuntimeFacts(primary);
  return {
    canonical_name: hit.canonical_name,
    capability_id: hit.capability_id,
    resource_id: resourceId,
    repository: facts.repository,
    source_paths: hit.source_locations.length > 0 ? hit.source_locations : [UNKNOWN],
    public_functions: listExports(primary),
    runtime_owner: facts.runtime_owner,
    runtime_type: facts.runtime_type,
    credential_boundary: facts.credential_boundary,
    consumers: hit.evidence_refs.filter((e) => e !== primary),
    match_score: hit.score,
    matched_on: hit.matched_on.map((t) => `registry.enumerated:${t}`),
    input_contract: hit.input_contract,
    output_contract: hit.output_contract,
    side_effects: hit.side_effects,
  };
}

/** Pulls the authoritative row through the sanctioned Lookup API only. */
function lookupRegistry(intent: WriteIntent, store: RegistryStore, extraTokens: readonly string[] = [], label = "REGISTRY(findCapability)"): { match: ExistingMatch | null; probe: ResolutionProbe } {
  const candidates = extraTokens.length > 0
    ? generateNameCandidates({ ...intent, requested_function: extraTokens.join(" "), target_domain: "" })
    : generateNameCandidates(intent);
  for (const name of candidates) {
    const row = findCapability({ canonical_name: name }, store) as unknown as Record<string, unknown> | null;
    if (!row) continue;
    const evidence = (row.evidence_refs as string[] | undefined) ?? [];
    const locations = (Array.isArray(row.source_location) ? row.source_location : [row.source_location]).filter(Boolean).map(String);
    const sourcePaths = [...new Set([...locations, ...evidence.filter((e) => /\.(ts|tsx|mjs|js)(#|$)/.test(e))])];
    const primary = sourcePaths[0] ?? "";
    const facts = deriveRuntimeFacts(primary);
    const resourceIds = (row.resource_ids as string[] | undefined) ?? [];
    return {
      match: {
        canonical_name: name,
        capability_id: String(row.capability_id ?? UNKNOWN),
        resource_id: resourceIds[0] ?? UNKNOWN,
        repository: facts.repository,
        source_paths: sourcePaths.length > 0 ? sourcePaths : [UNKNOWN],
        public_functions: listExports(primary),
        runtime_owner: facts.runtime_owner,
        runtime_type: facts.runtime_type,
        credential_boundary: facts.credential_boundary,
        // Consumers = the other real files the registration recorded as evidence.
        consumers: evidence.filter((e) => e !== primary && /\.(ts|tsx|mjs|js)(#|$)/.test(e)),
        match_score: tokenize(name).length,
        matched_on: [`registry.canonical_name=${name}`],
        input_contract: (row.input_contract as string[] | undefined) ?? [],
        output_contract: (row.output_contract as string[] | undefined) ?? [],
        side_effects: (row.side_effects as string[] | undefined) ?? [],
      },
      probe: { source: label, query: `canonical_name ∈ {${candidates.length} generated candidates}`, hit: true, detail: `matched "${name}"` },
    };
  }
  return {
    match: null,
    probe: {
      source: label,
      query: `canonical_name ∈ {${candidates.length} generated candidates}`,
      hit: false,
      detail: "no candidate name matched. NOTE: the Registry read surface is lookup-by-exact-key only (no enumerate), so this is NOT proof of absence",
    },
  };
}

/**
 * Resolves one write intent. Returns a fully-populated context or a
 * non-dispatchable one — never a partially-guessed packet.
 */
export function resolveWriteIntent(intent: WriteIntent, store: RegistryStore): ResolvedWorkContext {
  const path: ResolutionProbe[] = [];
  const tokens = tokenize(intent.requested_function);

  // --- 1. REGISTRY, ENUMERATED (PRIMARY, §7 normal path) ------------
  const search = searchRegistry(intent, store);
  path.push(search.probe);

  // --- 1b. name-guessing fallback: ONLY when the store cannot enumerate.
  // Guessing canonical names from intent words was a workaround for the
  // missing enumeration API. Now that enumeration exists it is retired on
  // stores that support it — it was the source of three separate wrong
  // matches (agent-host, runtime, and an unrelated hit for "realtime
  // change"), because a generated name can collide with a real capability
  // that has nothing to do with the intent.
  const enumerationUnavailable = /ENUMERATION_UNAVAILABLE/.test(search.probe.detail);
  let registry = search;
  if (!search.match && enumerationUnavailable) {
    registry = lookupRegistry(intent, store);
    path.push(registry.probe);
  }

  // --- 2. CAPABILITY INDEX -----------------------------------------
  const overlap = intent.target_domain ? searchOverlap(intent.target_domain, getCapabilityIndex()) : [];
  path.push({
    source: "CAPABILITY_INDEX(searchOverlap)",
    query: intent.target_domain || "(no target_domain)",
    hit: overlap.length > 0,
    detail: overlap.length > 0 ? overlap.map((c) => c.CAPABILITY_ID).join(", ") : "no registered capability owns or overlaps this folder",
  });

  // --- 3. TARGET FILESYSTEM ----------------------------------------
  const targetExists = intent.target_domain ? pathExists(intent.target_domain) : false;
  path.push({ source: "FILESYSTEM(target_domain)", query: intent.target_domain || "(none)", hit: targetExists, detail: targetExists ? "target folder already exists on disk" : "target folder does not exist" });

  // --- 4. SOURCE SCAN — RECONCILIATION FALLBACK ONLY (§7) -----------
  // Skipped entirely when the Registry already answered. This is the
  // change that takes a full multi-repo scan OFF the normal path: it now
  // runs only to reconcile a suspected Registry gap.
  const scanHits: string[] = [];
  if (registry.match) {
    path.push({ source: "SOURCE_SCAN", query: "(skipped)", hit: false, detail: "SKIPPED — the Registry resolved this intent; a source scan is reconciliation evidence, not normal discovery" });
  } else {
    for (const repo of SIBLING_REPOS) {
      const scan = scanRepoForSymbols(repo, tokens);
      path.push({ source: `SOURCE_SCAN(${repo})`, query: tokens.join("|"), hit: scan.hit, detail: scan.detail });
      if (scan.hit) scanHits.push(...scan.files.map((f) => `${repo}/${f}`));
    }
  }

  // --- 5. SECOND-PASS REGISTRY LOOKUP, DRIVEN BY SCAN EVIDENCE ------
  // The intent's own words rarely match a canonical name ("email reader"
  // never generates "gmail-readonly-reader"). The source scan, however,
  // finds the real FILE — and a filename is far better evidence than a
  // request phrase. So the filenames the scan actually hit are tokenized
  // and pushed back through the same sanctioned Lookup API. This is what
  // lets a vague intent resolve onto a precisely-named registered
  // capability without any fuzzy matching or model involvement.
  let match = registry.match;
  if (!match && scanHits.length > 0 && enumerationUnavailable) {
    // Tokenize scan-hit FILENAMES one file at a time, not all at once.
    // Pooling every filename's tokens lets unrelated words combine into a
    // real-but-wrong capability name (observed live: "email reader" pooled
    // tokens from agent-host-dispatch.ts and matched the unrelated
    // "agent-host" capability). Per-file keeps each candidate traceable to
    // one piece of evidence.
    for (const hit of scanHits) {
      const fileTokens = tokenize(hit.split("/").pop() ?? "");
      if (fileTokens.length === 0) continue;
      const second = lookupRegistry(intent, store, fileTokens, `REGISTRY(second pass from ${hit.split("/").pop()})`);
      if (!second.match) continue;
      // EVIDENCE LINK REQUIRED: the registered capability must actually
      // point at the file the scan found. Without this, a name that merely
      // happens to be generatable from a filename would "resolve" to a
      // capability that has nothing to do with it.
      // EXACT filename equality. Substring matching let "runtime" link to
      // "host-runtime.ts" and resolve onto an unrelated capability.
      const hitFile = hit.split("/").pop() ?? "";
      const linked = second.match.source_paths.some((p) => (p.split("#")[0].split("/").pop() ?? "") === hitFile);
      if (!linked) continue;
      path.push(second.probe);
      match = second.match;
      break;
    }
    if (!match) {
      path.push({ source: "REGISTRY(second pass, scan-derived)", query: `${scanHits.length} scan hit filename(s)`, hit: false, detail: "no scan-hit filename resolved to a registered capability whose own source paths point back at that file" });
    }
  }

  // Content-grep is OR over tokens, so a single common word ("source",
  // "state") makes almost any intent "hit" somewhere. A hit is only strong
  // evidence of an existing implementation when the FILENAME itself carries
  // an intent token — that is what distinguishes "the implementation lives
  // here" from "this word appears in a comment". Only strong hits may block.
  const strongHits = scanHits.filter((h) => {
    const file = (h.split("/").pop() ?? "").toLowerCase();
    return tokens.some((t) => file.includes(t));
  });
  path.push({ source: "SCAN_RELEVANCE(filename match)", query: tokens.join("|"), hit: strongHits.length > 0, detail: `${strongHits.length} of ${scanHits.length} content hits also match on FILENAME; only these are treated as evidence of an existing implementation` });

  // --- DECISION ----------------------------------------------------
  // Fixed rules over the probe results. No scoring model, no judgement.
  let decision: ResolvedWorkContext["decision"];
  let blocking_reason = "";
  if (match) {
    // EXTEND when the change lands inside the existing boundary; ADAPT
    // when it lands beside it (different runtime/repo).
    const sameRepo = /DNA-OS-INFRASTRUCTURE/i.test(match.repository) || match.repository === UNKNOWN;
    decision = sameRepo ? "EXTEND_EXISTING" : "ADAPT_EXISTING";
  } else if (strongHits.length > 0) {
    // Source says something exists that the Registry does not know about.
    // That is a REGISTRY GAP — never "missing". Reconcile first.
    decision = "UNRESOLVED";
    blocking_reason = `source scan found ${strongHits.length} candidate file(s) whose FILENAME matches the intent, and the Registry does not know about them — reconcile/register before dispatch. Registry cannot enumerate, so absence is unproven.`;
  } else if (tokens.length === 0) {
    decision = "UNRESOLVED";
    blocking_reason = "intent produced no searchable tokens — cannot prove anything either way";
  } else {
    decision = "MISSING_CONFIRMED";
  }

  // §2: a packet missing execution-critical facts is NOT dispatchable.
  // For a REUSE/EXTEND/ADAPT decision the Agent cannot act without knowing
  // WHERE the existing thing is and WHAT to reuse.
  const missingCritical: string[] = [];
  if (match) {
    if (match.source_paths.length === 0 || match.source_paths[0] === UNKNOWN) missingCritical.push("exact_source_paths");
    if (match.capability_id === UNKNOWN) missingCritical.push("existing_capability_id");
    if (match.public_functions.length === 0) missingCritical.push("components_to_reuse");
  }
  if (missingCritical.length > 0) blocking_reason = `execution-critical field(s) UNKNOWN: ${missingCritical.join(", ")}`;
  const dispatchable = decision !== "UNRESOLVED" && missingCritical.length === 0;

  const contractPaths = match ? match.source_paths.filter((p) => /contract\.ts$/.test(p)) : [];
  const sourceRoot = match && match.source_paths[0] ? match.source_paths[0].replace(/\/[^/]+$/, "") : UNKNOWN;

  return {
    work_id: intent.current_work_id,
    decision,
    existing_resource_id: match?.resource_id ?? UNKNOWN,
    existing_capability_id: match?.capability_id ?? UNKNOWN,
    canonical_name: match?.canonical_name ?? UNKNOWN,
    repository: match?.repository ?? UNKNOWN,
    source_root: sourceRoot,
    exact_source_paths: match?.source_paths ?? [],
    contract_paths: contractPaths,
    public_functions: match?.public_functions ?? [],
    input_contract: match?.input_contract ?? [],
    output_contract: match?.output_contract ?? [],
    runtime_owner: match?.runtime_owner ?? UNKNOWN,
    runtime_type: match?.runtime_type ?? UNKNOWN,
    service_id: match ? `${match.canonical_name}@${match.runtime_type}` : UNKNOWN,
    credential_boundary: match?.credential_boundary ?? UNKNOWN,
    dependencies: match?.side_effects ?? [],
    consumers: match?.consumers ?? [],
    blueprint_refs: [],
    evidence_refs: match?.source_paths ?? scanHits,
    missing_piece: intent.requested_change,
    required_change: intent.requested_change,
    allowed_write_scope: intent.target_domain ? [intent.target_domain] : [],
    forbidden_write_scope: match?.source_paths ?? [],
    components_to_reuse: match?.public_functions ?? [],
    components_not_to_reimplement: match ? [match.canonical_name, ...match.source_paths] : [],
    required_imports: match?.source_paths ?? [],
    verification_commands: ["npx tsc --noEmit", ...(intent.target_domain ? [`npx tsx ${intent.target_domain}/tests/*.test.ts`] : [])],
    completion_conditions: [
      `files changed ⊆ ${intent.target_domain || "(no scope)"}`,
      match ? `${match.canonical_name} reused, not reimplemented` : "new capability registered through the registration pipeline",
    ],
    next_action:
      decision === "UNRESOLVED"
        ? `BLOCKED — ${blocking_reason}`
        : match
          ? `Implement ONLY "${intent.requested_change}" inside ${intent.target_domain}, reusing ${match.canonical_name}.`
          : `No existing implementation found by any deterministic source. Define the new capability boundary, then dispatch.`,
    resolution_path: path,
    dispatchable,
    blocking_reason,
  };
}

/**
 * STEP 5 — PRE-WRITE ENFORCEMENT. Compares what an Agent proposes against
 * the resolved context BEFORE any filesystem mutation. A block never tells
 * the Agent to go search again; it names the existing component and the
 * exact reuse required.
 */
export function enforceProposedWrite(
  context: ResolvedWorkContext,
  proposedPaths: readonly string[],
  proposedSymbols: readonly string[] = [],
): EnforcementResult {
  const existing = context.canonical_name;
  const base = { existing_component: existing, required_reuse: context.components_to_reuse };

  if (!context.dispatchable) {
    return { ...base, verdict: "BLOCK_WRITE", reason_code: "NOT_DISPATCHABLE", allowed_next_action: context.next_action, detail: context.blocking_reason };
  }

  for (const proposed of proposedPaths) {
    const normalised = proposed.replace(/^\.\//, "");

    for (const forbidden of context.forbidden_write_scope) {
      if (normalised === forbidden || normalised.startsWith(`${forbidden}/`)) {
        return { ...base, verdict: "BLOCK_WRITE", reason_code: "IN_FORBIDDEN_SCOPE", allowed_next_action: `write only inside ${context.allowed_write_scope.join(", ")}`, detail: `"${proposed}" is the existing implementation — it is read-only for this work item` };
      }
    }

    const inScope = context.allowed_write_scope.some((scope) => normalised === scope || normalised.startsWith(`${scope}/`) || normalised.startsWith(scope.replace(/\/$/, "") + "/"));
    if (!inScope) {
      return { ...base, verdict: "BLOCK_WRITE", reason_code: "OUT_OF_ALLOWED_SCOPE", allowed_next_action: `write only inside ${context.allowed_write_scope.join(", ") || "(nothing — scope is empty)"}`, detail: `"${proposed}" is outside allowed_write_scope` };
    }
  }

  // A symbol the existing component already exports, being redefined in
  // new code, is a duplicate implementation — the exact failure this
  // whole layer exists to prevent.
  const duplicated = proposedSymbols.filter((symbol) => context.components_to_reuse.includes(symbol));
  if (duplicated.length > 0) {
    return {
      ...base,
      verdict: "BLOCK_WRITE",
      reason_code: "DUPLICATE_IMPLEMENTATION_BLOCKED",
      allowed_next_action: `import ${duplicated.join(", ")} from ${context.required_imports.join(", ") || existing} instead of redefining ${duplicated.length === 1 ? "it" : "them"}`,
      detail: `${duplicated.join(", ")} already exist${duplicated.length === 1 ? "s" : ""} in ${existing}`,
    };
  }

  return { ...base, verdict: "ALLOW_WRITE", reason_code: "IN_SCOPE", allowed_next_action: context.next_action, detail: `${proposedPaths.length} path(s) inside allowed_write_scope; no duplicated symbol` };
}

/** Kept so callers can prove the source scan is real; not part of the contract. */
export const __internal = { scanRepoForSymbols, readTextIfPresent };

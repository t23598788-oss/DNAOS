/**
 * Build Pipeline — Build Type Registry & Environment Profile Registry
 * (owner, 2026-08-06, Software Factory Step 9). Declares the real Build
 * Types the Build Pipeline runs and the real Environment Profiles it can
 * build under. Every IMPLEMENTED Build Type either runs a real,
 * already-registered command via the Execution Runtime (Step 2), or is
 * DERIVED from the one real `next build` run's real output (Next.js
 * exposes no honest separate client/server build flag — splitting them
 * into independently-run builds would be a fabrication, not a real
 * capability). CUSTOM_BUILD is honestly NOT_IMPLEMENTED (reserved
 * placeholder, same pattern as testRegistry.ts's CUSTOM_TEST).
 *
 * Reuse investigation (section 1) confirmed real, by direct inspection:
 *  - package.json's real "build" script is `next build`; "prebuild"
 *    (npm-lifecycle-auto-run before "build") is `npx tsx
 *    scripts/deploy-gate.ts`, which runs the existing real
 *    scripts/governance.sh and reads DNA_OS_HEALTH.json — NOT a Deploy
 *    Pipeline (it deploys nothing, contacts no registry/host); its name is
 *    historical. Both already run as part of the ALREADY-registered
 *    "build" CommandDefinition in executionRegistry.ts (Step 2) — reused
 *    as-is here, never re-implemented.
 *  - package-lock.json is the repo's real lockfile (no packageManager
 *    field in package.json; no yarn.lock/pnpm-lock.yaml/bun.lockb present).
 *  - next.config.ts sets no generateBuildId — .next/BUILD_ID is therefore
 *    a real, non-deterministic random id per build. This is load-bearing
 *    for Reproducibility Check honesty (see buildRuntime.ts).
 *  - tsconfig.json has "noEmit": true — there is no real, separate
 *    "TypeScript emit" in this repo; TYPESCRIPT_EMIT_CHECK honestly reuses
 *    the same registered "typecheck" command Step 8's TYPESCRIPT_CHECK
 *    already uses, documented as non-emitting.
 *  - vercel.json only configures cron routes, no custom build command —
 *    Vercel really would run the same `npm run build`. No real Vercel/CI
 *    runner is reachable from this environment, so those two Environment
 *    Profiles are honestly COMPATIBILITY_ONLY, never claimed IMPLEMENTED.
 *  - The existing "Build Output" Bottom Console tab is pre-existing static
 *    mock text (MOCK_BUILD_OUTPUT) — unrelated, not reused, not removed.
 *    This step adds a separate, real "Build" tab.
 *  - No prior Build Runtime/Build Store of any kind exists anywhere in
 *    this codebase — confirmed by a full grep of engines/shared/ide-lib/
 *    before writing buildRuntime.ts.
 */
export type BuildTypeId =
  | "NEXT_PRODUCTION_BUILD" | "TYPESCRIPT_EMIT_CHECK" | "REGISTRY_GENERATION" | "ARCHITECTURE_GENERATION"
  | "STATIC_ASSET_BUILD" | "SERVER_BUNDLE_BUILD" | "CLIENT_BUNDLE_BUILD" | "BUILD_MANIFEST_VALIDATION"
  | "BUILD_ARTIFACT_INTEGRITY" | "REPRODUCIBILITY_CHECK" | "CUSTOM_BUILD";

export type BuildTypeStatus = "IMPLEMENTED" | "NOT_IMPLEMENTED";
/** How this Build Type produces its real result. COMMAND = runs a real,
 * registered Execution Runtime command. DERIVED = never runs its own
 * process; real-derives its result from NEXT_PRODUCTION_BUILD's one real
 * `next build` output (the only honest way to report
 * static/server/client/manifest/integrity facts without fabricating a
 * separately-run build Next.js doesn't actually expose). */
export type BuildExecutionMode = "COMMAND" | "DERIVED" | "NOT_IMPLEMENTED";

export interface BuildTypeDefinition {
  id: BuildTypeId;
  name: string;
  description: string;
  implementation: string;
  executionMode: BuildExecutionMode;
  commandId: string | null;
  producer: string;
  requiredInputs: string[];
  producedOutputs: string[];
  workingDirectory: "workspace_root";
  timeoutMs: number;
  maxOutputBytes: number;
  changesWorkspace: boolean;
  requiresExclusiveLock: boolean;
  requiresOwnerConfirmation: boolean;
  prerequisites: BuildTypeId[];
  blockingPolicy: string;
  evidenceSource: string;
  status: BuildTypeStatus;
  limitations: string[];
}

const MIN_5 = 5 * 60_000, MIN_10 = 10 * 60_000, SEC_20 = 20_000;

export const BUILD_TYPE_REGISTRY: Record<BuildTypeId, BuildTypeDefinition> = {
  NEXT_PRODUCTION_BUILD: {
    id: "NEXT_PRODUCTION_BUILD", name: "Next.js Production Build",
    description: "Real `npm run build` → prebuild (scripts/deploy-gate.ts) then `next build` — the exact real command this repo already uses, via the already-registered \"build\" Execution Runtime command (Step 2). Never a second implementation.",
    implementation: "engines/shared/ide-lib/buildRuntime.ts#runNextProductionBuild",
    executionMode: "COMMAND", commandId: "build",
    producer: "executionRegistry.ts's real \"build\" CommandDefinition",
    requiredInputs: ["real working tree", "package.json", "package-lock.json", "tsconfig.json", "next.config.ts"],
    producedOutputs: [".next/server/**", ".next/static/**", ".next/*.json manifests", ".next/BUILD_ID"],
    workingDirectory: "workspace_root", timeoutMs: MIN_10, maxOutputBytes: 5_242_880,
    changesWorkspace: true, requiresExclusiveLock: true, requiresOwnerConfirmation: true, prerequisites: [],
    blockingPolicy: "a non-zero real exit code or a real \"Failed to compile\"/type-error diagnostic is ERROR and blocking",
    evidenceSource: "engines/shared/ide-lib/executionRegistry.ts's \"build\" CommandDefinition (mode WORKSPACE_WRITE, exclusiveLockKey \"build-artifacts\")",
    status: "IMPLEMENTED", limitations: [],
  },
  TYPESCRIPT_EMIT_CHECK: {
    id: "TYPESCRIPT_EMIT_CHECK", name: "TypeScript Emit Check",
    description: "Real `npx tsc --noEmit` via the already-registered \"typecheck\" command. This repo's tsconfig.json sets noEmit:true — there is no real, separate emit step; this Build Type honestly reuses the same non-emitting real diagnostic pass Step 8's TYPESCRIPT_CHECK already runs, as the pre-build type gate.",
    implementation: "engines/shared/ide-lib/buildRuntime.ts#runTypeScriptEmitCheck",
    executionMode: "COMMAND", commandId: "typecheck",
    producer: "executionRegistry.ts's real \"typecheck\" CommandDefinition",
    requiredInputs: ["real working tree", "tsconfig.json"],
    producedOutputs: ["real tsc diagnostics (parsed from stdout) — no emitted .js/.d.ts files, by tsconfig.json's own noEmit:true"],
    workingDirectory: "workspace_root", timeoutMs: MIN_5, maxOutputBytes: 5_242_880,
    changesWorkspace: false, requiresExclusiveLock: false, requiresOwnerConfirmation: false, prerequisites: [],
    blockingPolicy: "any real tsc error diagnostic is ERROR and blocking",
    evidenceSource: "tsconfig.json's real \"noEmit\": true field",
    status: "IMPLEMENTED", limitations: ["never emits real .js/.d.ts output — this repo's tsconfig makes that honestly impossible to claim"],
  },
  REGISTRY_GENERATION: {
    id: "REGISTRY_GENERATION", name: "Registry Generation",
    description: "Real `npm run sync` via the already-registered \"registry.sync\" command — regenerates registry/module-registry.json, registry/architecture-book.json, registry/system-control-graph.json, registry/governance-summary.json from real, current source. A declared GENERATED_REGISTRY mutation, never a source-file write.",
    implementation: "engines/shared/ide-lib/buildRuntime.ts#runRegistryGeneration",
    executionMode: "COMMAND", commandId: "registry.sync",
    producer: "executionRegistry.ts's real \"registry.sync\" CommandDefinition",
    requiredInputs: ["real working tree"],
    producedOutputs: ["registry/module-registry.json", "registry/architecture-book.json", "registry/system-control-graph.json", "registry/governance-summary.json"],
    workingDirectory: "workspace_root", timeoutMs: MIN_5, maxOutputBytes: 5_242_880,
    changesWorkspace: true, requiresExclusiveLock: true, requiresOwnerConfirmation: true, prerequisites: [],
    blockingPolicy: "a non-zero real exit code is ERROR and blocking",
    evidenceSource: "engines/shared/ide-lib/executionRegistry.ts's \"registry.sync\" CommandDefinition",
    status: "IMPLEMENTED", limitations: [],
  },
  ARCHITECTURE_GENERATION: {
    id: "ARCHITECTURE_GENERATION", name: "Architecture Generation",
    description: "Real `npm run architecture:check` via the already-registered \"architecture.check\" command (Step 2) — reused as-is, never re-implemented.",
    implementation: "engines/shared/ide-lib/buildRuntime.ts#runArchitectureGeneration",
    executionMode: "COMMAND", commandId: "architecture.check",
    producer: "executionRegistry.ts's real \"architecture.check\" CommandDefinition",
    requiredInputs: ["real working tree", "registry/module-registry.json"],
    producedOutputs: ["registry/system-control-graph.json", "registry/system-control-summary.json"],
    workingDirectory: "workspace_root", timeoutMs: MIN_10, maxOutputBytes: 5_242_880,
    changesWorkspace: true, requiresExclusiveLock: true, requiresOwnerConfirmation: true, prerequisites: [],
    blockingPolicy: "a non-zero real exit code is ERROR and blocking",
    evidenceSource: "engines/shared/ide-lib/executionRegistry.ts's \"architecture.check\" CommandDefinition",
    status: "IMPLEMENTED", limitations: [],
  },
  STATIC_ASSET_BUILD: {
    id: "STATIC_ASSET_BUILD", name: "Static Asset Build (derived)",
    description: "Never run as a separate process — Next.js exposes no honest static-only build flag. Real-derives the static output subset (.next/static/**, and routes-manifest.json's real staticRoutes[]) from NEXT_PRODUCTION_BUILD's one real output, after that build completes.",
    implementation: "engines/shared/ide-lib/buildRuntime.ts#classifyOutputInventory",
    executionMode: "DERIVED", commandId: null,
    producer: "engines/shared/ide-lib/buildRuntime.ts",
    requiredInputs: ["NEXT_PRODUCTION_BUILD's real output"],
    producedOutputs: ["real static file inventory subset"],
    workingDirectory: "workspace_root", timeoutMs: SEC_20, maxOutputBytes: 5_242_880,
    changesWorkspace: false, requiresExclusiveLock: false, requiresOwnerConfirmation: false, prerequisites: ["NEXT_PRODUCTION_BUILD"],
    blockingPolicy: "never independently blocking — inherits NEXT_PRODUCTION_BUILD's real result",
    evidenceSource: "real .next/routes-manifest.json staticRoutes[] + real .next/static/** directory listing",
    status: "IMPLEMENTED", limitations: ["not a separately-run build — Next.js does not expose one honestly"],
  },
  SERVER_BUNDLE_BUILD: {
    id: "SERVER_BUNDLE_BUILD", name: "Server Bundle Build (derived)",
    description: "Never run as a separate process — same honest limitation as STATIC_ASSET_BUILD. Real-derives the server bundle subset (.next/server/**, and app-path-routes-manifest.json's real /api/**+/route entries) from NEXT_PRODUCTION_BUILD's one real output.",
    implementation: "engines/shared/ide-lib/buildRuntime.ts#classifyOutputInventory",
    executionMode: "DERIVED", commandId: null,
    producer: "engines/shared/ide-lib/buildRuntime.ts",
    requiredInputs: ["NEXT_PRODUCTION_BUILD's real output"],
    producedOutputs: ["real server bundle inventory subset"],
    workingDirectory: "workspace_root", timeoutMs: SEC_20, maxOutputBytes: 5_242_880,
    changesWorkspace: false, requiresExclusiveLock: false, requiresOwnerConfirmation: false, prerequisites: ["NEXT_PRODUCTION_BUILD"],
    blockingPolicy: "never independently blocking — inherits NEXT_PRODUCTION_BUILD's real result",
    evidenceSource: "real .next/server/** directory listing + real .next/app-path-routes-manifest.json",
    status: "IMPLEMENTED", limitations: ["not a separately-run build — Next.js does not expose one honestly"],
  },
  CLIENT_BUNDLE_BUILD: {
    id: "CLIENT_BUNDLE_BUILD", name: "Client Bundle Build (derived)",
    description: "Never run as a separate process — same honest limitation as STATIC_ASSET_BUILD/SERVER_BUNDLE_BUILD. Real-derives the client chunk subset (.next/static/chunks/**) from NEXT_PRODUCTION_BUILD's one real output.",
    implementation: "engines/shared/ide-lib/buildRuntime.ts#classifyOutputInventory",
    executionMode: "DERIVED", commandId: null,
    producer: "engines/shared/ide-lib/buildRuntime.ts",
    requiredInputs: ["NEXT_PRODUCTION_BUILD's real output"],
    producedOutputs: ["real client chunk inventory subset"],
    workingDirectory: "workspace_root", timeoutMs: SEC_20, maxOutputBytes: 5_242_880,
    changesWorkspace: false, requiresExclusiveLock: false, requiresOwnerConfirmation: false, prerequisites: ["NEXT_PRODUCTION_BUILD"],
    blockingPolicy: "never independently blocking — inherits NEXT_PRODUCTION_BUILD's real result",
    evidenceSource: "real .next/static/chunks/** directory listing",
    status: "IMPLEMENTED", limitations: ["not a separately-run build — Next.js does not expose one honestly"],
  },
  BUILD_MANIFEST_VALIDATION: {
    id: "BUILD_MANIFEST_VALIDATION", name: "Build Manifest Validation",
    description: "Real, structural validation of the Build Manifest this runtime itself assembled from real output — never a second manifest generator, never a guess from source alone.",
    implementation: "engines/shared/ide-lib/buildRuntime.ts#validateBuildManifest",
    executionMode: "DERIVED", commandId: null,
    producer: "engines/shared/ide-lib/buildRuntime.ts",
    requiredInputs: ["real Build Manifest"],
    producedOutputs: ["real integrityStatus"],
    workingDirectory: "workspace_root", timeoutMs: SEC_20, maxOutputBytes: 5_242_880,
    changesWorkspace: false, requiresExclusiveLock: false, requiresOwnerConfirmation: false, prerequisites: ["NEXT_PRODUCTION_BUILD"],
    blockingPolicy: "a missing required manifest field or a real output/manifest count mismatch is ERROR and blocking",
    evidenceSource: "engines/shared/ide-lib/buildRuntime.ts's own real manifest object",
    status: "IMPLEMENTED", limitations: [],
  },
  BUILD_ARTIFACT_INTEGRITY: {
    id: "BUILD_ARTIFACT_INTEGRITY", name: "Build Artifact Integrity",
    description: "Real re-checksum of every real output file against the Build Manifest's recorded checksum, missing/duplicate/zero-byte-critical detection, real secret-pattern and source-map absolute-path leakage scan.",
    implementation: "engines/shared/ide-lib/buildRuntime.ts#checkBuildIntegrity",
    executionMode: "DERIVED", commandId: null,
    producer: "engines/shared/ide-lib/buildRuntime.ts",
    requiredInputs: ["real Build Manifest", "real output files"],
    producedOutputs: ["real BUILD_INTEGRITY_REPORT"],
    workingDirectory: "workspace_root", timeoutMs: SEC_20, maxOutputBytes: 5_242_880,
    changesWorkspace: false, requiresExclusiveLock: false, requiresOwnerConfirmation: false, prerequisites: ["NEXT_PRODUCTION_BUILD", "BUILD_MANIFEST_VALIDATION"],
    blockingPolicy: "a real checksum mismatch, missing critical output, or real secret-pattern match is ERROR and blocking",
    evidenceSource: "real re-read + re-hash of every output file",
    status: "IMPLEMENTED", limitations: [],
  },
  REPRODUCIBILITY_CHECK: {
    id: "REPRODUCIBILITY_CHECK", name: "Reproducibility Check",
    description: "Real comparison of two real Build Runs' output inventories. This repo's next.config.ts sets no generateBuildId, so .next/BUILD_ID is a real, non-deterministic random token per build — the ONE normalization this check applies (both to output paths and to file content) before comparing; any other difference is reported as real, never suppressed. Never declares VERIFIED from a single run.",
    implementation: "engines/shared/ide-lib/buildRuntime.ts#compareBuildRuns",
    executionMode: "DERIVED", commandId: null,
    producer: "engines/shared/ide-lib/buildRuntime.ts",
    requiredInputs: ["two real Build Runs with matching sourceFingerprint/environmentProfile/dependencyLockHash"],
    producedOutputs: ["real BUILD_REPRODUCIBILITY_REPORT"],
    workingDirectory: "workspace_root", timeoutMs: SEC_20, maxOutputBytes: 5_242_880,
    changesWorkspace: false, requiresExclusiveLock: false, requiresOwnerConfirmation: false, prerequisites: ["NEXT_PRODUCTION_BUILD"],
    blockingPolicy: "never blocking — informational reproducibility status only",
    evidenceSource: "real per-file checksum comparison across two real Build Runs",
    status: "IMPLEMENTED", limitations: ["requires 2 real Build Runs with matching inputs — a single run is always NOT_VERIFIED", "BUILD_ID itself is expected to differ and is normalized before comparison — documented, not hidden"],
  },
  CUSTOM_BUILD: {
    id: "CUSTOM_BUILD", name: "Custom Build",
    description: "Reserved for a future generic/user-defined Build Type, same honest placeholder pattern as testRegistry.ts's CUSTOM_TEST — no real executor exists yet.",
    implementation: "NOT_IMPLEMENTED",
    executionMode: "NOT_IMPLEMENTED", commandId: null,
    producer: "none", requiredInputs: [], producedOutputs: [],
    workingDirectory: "workspace_root", timeoutMs: SEC_20, maxOutputBytes: 0,
    changesWorkspace: false, requiresExclusiveLock: false, requiresOwnerConfirmation: false, prerequisites: [],
    blockingPolicy: "n/a — always reports NOT_IMPLEMENTED, never a guessed pass/fail",
    evidenceSource: "none — no real implementation exists to cite.",
    status: "NOT_IMPLEMENTED", limitations: ["no real executor exists"],
  },
};

export function listBuildTypes(): BuildTypeDefinition[] {
  return Object.values(BUILD_TYPE_REGISTRY);
}
export function getBuildTypeDefinition(id: string): BuildTypeDefinition | undefined {
  return BUILD_TYPE_REGISTRY[id as BuildTypeId];
}

// ============================================================
// Environment Profile Registry (section 5)
// ============================================================
export type EnvironmentProfileId = "LOCAL_PRODUCTION_BUILD" | "CI_PRODUCTION_BUILD" | "VERCEL_COMPATIBILITY_CHECK";
export type EnvironmentProfileStatus = "IMPLEMENTED" | "COMPATIBILITY_ONLY" | "NOT_IMPLEMENTED";

export interface EnvironmentProfileDefinition {
  id: EnvironmentProfileId;
  name: string;
  runtime: string;
  nodeVersion: string;
  packageManager: string;
  packageManagerVersion: string;
  operatingSystem: string;
  architecture: string;
  environmentVariablePolicy: string;
  allowedEnvironmentKeys: string[];
  requiredEnvironmentKeys: string[];
  outputDirectory: string;
  cacheDirectory: string;
  cleanBuildPolicy: "INCREMENTAL_BUILD" | "ISOLATED_OUTPUT_BUILD";
  networkPolicy: string;
  status: EnvironmentProfileStatus;
  evidenceSource: string;
  limitations: string[];
}

// Real, current process identity — read once at module load (process.version
// is a real Node API, never guessed). Package manager version is read
// lazily by buildRuntime.ts via a real, allowlisted `npm --version` call
// (not embedded here as a hardcoded guess).
const REAL_NODE_VERSION = process.version;
const REAL_OS = process.platform;
const REAL_ARCH = process.arch;

export const ENVIRONMENT_PROFILE_REGISTRY: Record<EnvironmentProfileId, EnvironmentProfileDefinition> = {
  LOCAL_PRODUCTION_BUILD: {
    id: "LOCAL_PRODUCTION_BUILD", name: "Local Production Build",
    runtime: "node", nodeVersion: REAL_NODE_VERSION, packageManager: "npm", packageManagerVersion: "resolved live via `npm --version`",
    operatingSystem: REAL_OS, architecture: REAL_ARCH,
    environmentVariablePolicy: "presence-only — key name and present/missing recorded, real values are NEVER read into any Build record",
    allowedEnvironmentKeys: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY", "NODE_ENV"],
    requiredEnvironmentKeys: [],
    outputDirectory: ".next", cacheDirectory: ".next/cache",
    cleanBuildPolicy: "INCREMENTAL_BUILD",
    networkPolicy: "same as this process's real network access — no isolation applied this phase",
    status: "IMPLEMENTED",
    evidenceSource: "this Node process's real process.version/process.platform/process.arch + this repo's real next.config.ts outputDirectory convention",
    limitations: ["INCREMENTAL_BUILD only — deleting .next before a build would be a real file-write/delete operation with no policy yet (section 10), so this phase never performs a clean build; reproducibilityStatus is capped accordingly (see buildRuntime.ts)"],
  },
  CI_PRODUCTION_BUILD: {
    id: "CI_PRODUCTION_BUILD", name: "CI Production Build",
    runtime: "node", nodeVersion: "unknown — no real CI runner reachable from this environment", packageManager: "npm", packageManagerVersion: "unknown",
    operatingSystem: "unknown", architecture: "unknown",
    environmentVariablePolicy: "presence-only — same policy as LOCAL_PRODUCTION_BUILD, not yet enforceable without a real CI runner",
    allowedEnvironmentKeys: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY", "NODE_ENV"],
    requiredEnvironmentKeys: [],
    outputDirectory: ".next", cacheDirectory: ".next/cache",
    cleanBuildPolicy: "ISOLATED_OUTPUT_BUILD",
    networkPolicy: "unknown — no real CI runner configuration exists in this repo to cite",
    status: "COMPATIBILITY_ONLY",
    evidenceSource: "none — no real CI workflow file (.github/workflows, etc.) exists in this repo",
    limitations: ["no real CI runner is reachable from this environment — this profile can only be used for real, honest compatibility comparison of build INPUTS (lockfile/config hashes), never a real executed CI build"],
  },
  VERCEL_COMPATIBILITY_CHECK: {
    id: "VERCEL_COMPATIBILITY_CHECK", name: "Vercel Compatibility Check",
    runtime: "node", nodeVersion: "unknown — Vercel's real build runner is not reachable from this environment", packageManager: "npm", packageManagerVersion: "unknown",
    operatingSystem: "linux (Vercel's documented real build image family)", architecture: "unknown",
    environmentVariablePolicy: "presence-only",
    allowedEnvironmentKeys: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY", "NODE_ENV"],
    requiredEnvironmentKeys: [],
    outputDirectory: ".next", cacheDirectory: ".next/cache",
    cleanBuildPolicy: "ISOLATED_OUTPUT_BUILD",
    networkPolicy: "unknown — Vercel's real network policy is not reachable/verifiable from this environment",
    status: "COMPATIBILITY_ONLY",
    evidenceSource: "real vercel.json (this repo's only real Vercel config — cron routes only, no custom build command, meaning Vercel really runs the same `npm run build`) + real .vercel/project.json linkage",
    limitations: ["no real Vercel build runner is reachable from this environment — this profile only verifies that vercel.json declares no custom build override, never a real executed Vercel build"],
  },
};

export function listEnvironmentProfiles(): EnvironmentProfileDefinition[] {
  return Object.values(ENVIRONMENT_PROFILE_REGISTRY);
}
export function getEnvironmentProfileDefinition(id: string): EnvironmentProfileDefinition | undefined {
  return ENVIRONMENT_PROFILE_REGISTRY[id as EnvironmentProfileId];
}

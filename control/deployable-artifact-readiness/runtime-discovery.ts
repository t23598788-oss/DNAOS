/**
 * หน้าที่: PROJECT/RUNTIME DISCOVERY — reads ONLY real files at the
 * repository root and reports typed facts. Every fact here traces to one
 * specific file's existence (or, for the "direct execution, no build"
 * proof, one specific field's real value) — never an inference from
 * dependency names, comments, or any AI judgement about "what kind of
 * project this looks like".
 *
 * Input: a repo root path.
 * Output: `discoverProjectRuntime` -> `RuntimeDiscoveryResult`.
 * Dependency ที่อนุญาต: node:fs, node:path, ./types.ts.
 * สิ่งที่ห้ามแตะ: never add a language/runtime/framework fact that isn't
 * backed by one of the real marker files checked below. Never call an
 * LLM or any heuristic text-similarity check here.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeDiscoveryResult } from "./types";

interface Marker {
  file: string;
  fact: { kind: "language" | "runtime" | "framework" | "package_manager" | "build_system"; value: string };
}

const MARKERS: readonly Marker[] = [
  { file: "package.json", fact: { kind: "runtime", value: "node" } },
  { file: "package-lock.json", fact: { kind: "package_manager", value: "npm" } },
  { file: "pnpm-lock.yaml", fact: { kind: "package_manager", value: "pnpm" } },
  { file: "yarn.lock", fact: { kind: "package_manager", value: "yarn" } },
  { file: "tsconfig.json", fact: { kind: "language", value: "typescript" } },
  { file: "next.config.js", fact: { kind: "framework", value: "next" } },
  { file: "next.config.ts", fact: { kind: "framework", value: "next" } },
  { file: "next.config.mjs", fact: { kind: "framework", value: "next" } },
  { file: "vite.config.js", fact: { kind: "framework", value: "vite" } },
  { file: "vite.config.ts", fact: { kind: "framework", value: "vite" } },
  { file: "vite.config.mjs", fact: { kind: "framework", value: "vite" } },
  { file: "Dockerfile", fact: { kind: "build_system", value: "docker" } },
  { file: "pyproject.toml", fact: { kind: "language", value: "python" } },
  { file: "requirements.txt", fact: { kind: "language", value: "python" } },
  { file: "go.mod", fact: { kind: "language", value: "go" } },
  { file: "Cargo.toml", fact: { kind: "language", value: "rust" } },
  { file: "pom.xml", fact: { kind: "language", value: "java" } },
  { file: "build.gradle", fact: { kind: "language", value: "java" } },
  { file: "Makefile", fact: { kind: "build_system", value: "make" } },
];

function findCsproj(repoRoot: string): boolean {
  // A single, shallow, real read of the repo root's own directory listing — never a recursive/guessed scan.
  try {
    return readdirSync(repoRoot).some((name) => name.toLowerCase().endsWith(".csproj"));
  } catch {
    return false;
  }
}

export function discoverProjectRuntime(repoRoot: string): RuntimeDiscoveryResult {
  const languages = new Set<string>();
  const runtimes = new Set<string>();
  const frameworks = new Set<string>();
  const packageManagers = new Set<string>();
  const buildSystems = new Set<string>();
  const evidenceRefs: string[] = [];

  for (const marker of MARKERS) {
    if (existsSync(join(repoRoot, marker.file))) {
      evidenceRefs.push(marker.file);
      const target = { language: languages, runtime: runtimes, framework: frameworks, package_manager: packageManagers, build_system: buildSystems }[marker.fact.kind];
      target.add(marker.fact.value);
    }
  }

  if (findCsproj(repoRoot)) {
    languages.add("csharp");
    evidenceRefs.push("*.csproj");
  }

  // If the language is TypeScript/JavaScript on Node, "javascript" is
  // always a real, present fact too (TypeScript compiles to it) — but
  // only ever added alongside a real package.json/tsconfig.json marker,
  // never on its own guess.
  if (runtimes.has("node")) languages.add("javascript");

  if (languages.size === 0 && runtimes.size === 0) {
    return { status: "UNRESOLVED", reason_code: "RUNTIME_NOT_RESOLVED", languages: [], runtimes: [], frameworks: [], package_managers: [], build_systems: [], evidence_refs: [] };
  }

  return {
    status: "RESOLVED",
    reason_code: "RUNTIME_RESOLVED",
    languages: [...languages],
    runtimes: [...runtimes],
    frameworks: [...frameworks],
    package_managers: [...packageManagers],
    build_systems: [...buildSystems],
    evidence_refs: evidenceRefs,
  };
}

/**
 * Real, inspectable proof (not an assumption) that a Node/TypeScript
 * project needs no build step: `tsconfig.json`'s own `compilerOptions.
 * noEmit === true` (TypeScript itself is configured to never produce
 * compiled output) AND every real `package.json` script that names a
 * `.ts`/`.tsx` file invokes it through a direct-source runner (`tsx` or
 * `ts-node`), never a compiled `dist/`/`build/`/`.next/` entrypoint.
 */
export function provesNodeTypescriptBuildNotRequired(repoRoot: string): { proven: boolean; evidence_refs: readonly string[] } {
  const tsconfigPath = join(repoRoot, "tsconfig.json");
  const packageJsonPath = join(repoRoot, "package.json");
  if (!existsSync(tsconfigPath) || !existsSync(packageJsonPath)) return { proven: false, evidence_refs: [] };

  let tsconfig: { compilerOptions?: { noEmit?: boolean } };
  let packageJson: { scripts?: Record<string, string> };
  try {
    tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8"));
    packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  } catch {
    return { proven: false, evidence_refs: [] };
  }

  if (tsconfig.compilerOptions?.noEmit !== true) return { proven: false, evidence_refs: [] };

  const scripts = packageJson.scripts ?? {};
  const tsInvokingScripts = Object.entries(scripts).filter(([, command]) => /\.tsx?\b/.test(command));
  const allDirectlyRunViaTsRunner = tsInvokingScripts.every(([, command]) => /\btsx\b|\bts-node\b/.test(command));
  const anyReferencesCompiledOutput = Object.values(scripts).some((command) => /\b(dist|build|\.next|out)\//.test(command));

  if (tsInvokingScripts.length === 0 || !allDirectlyRunViaTsRunner || anyReferencesCompiledOutput) {
    return { proven: false, evidence_refs: [] };
  }

  return { proven: true, evidence_refs: ["tsconfig.json (compilerOptions.noEmit=true)", "package.json (every .ts script invoked directly via tsx/ts-node, none reference a compiled dist/build/.next/out path)"] };
}

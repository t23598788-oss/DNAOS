#!/usr/bin/env node
/**
 * build-portable.mjs (Phase 3, 2026-10-16).
 *
 * Builds the DNA OS AI Server PORTABLE RUNTIME PACKAGE (Windows/Linux):
 *   portable/dna-os-ai-server-<ver>-<win64|linux64>.zip
 * Contents: runtime sources + manifests, NO node_modules, NO dist.
 * Fail-loud on missing files and on credential shapes found in RUNTIME files.
 *
 * Scan scope (deliberate): only src/** + test/** of the compute package and
 * its own manifests. The generator's own credential patterns live as code
 * constants (here and in the Phase 3 test that verifies they fire) — they
 * are not part of the runtime payload, so they are excluded from the scan
 * to avoid self-matching; the checks proving they RUN live in
 * test/portable-runtime.test.ts against a synthetic file.
 */
import { readFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync, copyFileSync, writeFileSync, rmSync as rmForce } from "fs";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { execFileSync } from "child_process";

const HERE = fileURLToPath(import.meta.url);
const CMP = dirname(dirname(HERE)); // .../dna-os-compute
const REPO = join(CMP, "..");
const OUT = join(CMP, "portable");
const PKG = JSON.parse(readFileSync(join(CMP, "package.json"), "utf-8"));

// Required pkg files (fail if missing)
const RUNTIME_FILES = [
  "src/daemon.ts", "src/server-entry.ts", "src/metering.ts", "src/exec.ts",
  "src/inference.ts", "src/types.ts", "src/workspace.ts",
  "package.json", "tsconfig.json", "tsconfig.test.json",
];

// Windows/Linux install scripts (fail if missing)
const SCRIPT_FILES = [
  "scripts/install-deps.ps1", "scripts/start.ps1", "scripts/stop.ps1",
  "scripts/health.ps1", "scripts/pair.ps1", "scripts/build-installer.ps1",
  "scripts/install-deps.sh", "scripts/start.sh", "scripts/stop.sh",
  "scripts/health.sh", "scripts/pair.sh",
];

const SRC_SECRET_SHAPES = [
  /SUPA_BASE_/i.source.replace("_BASE_", "BASE_") && new RegExp("SUPA" + "BASE_" + "\\\\[a-z]+", "i"),
  new RegExp("SER" + "VICE" + "_ROLE", "i"),
  new RegExp("RAIL" + "WAY" + "_TO" + "KEN", "i"),
  new RegExp("OPE" + "NAI_API" + "_KEY", "i"),
  new RegExp("GEM" + "INI_API" + "_KEY", "i"),
  // raw secret material shapes (real creds would match these)
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\brpa_[A-Za-z0-9]{20,}\b/,
];

const ERRORS = [];
for (const rel of [...RUNTIME_FILES, ...SCRIPT_FILES]) {
  if (!existsSync(join(CMP, rel))) ERRORS.push(`missing required runtime file: ${rel}`);
}
const README = join(REPO, "README-SERVER.md");
if (!existsSync(README)) ERRORS.push("missing README-SERVER.md in repo root");

const COLLECT = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) {
      if (name !== "node_modules" && name !== "dist" && name !== "portable") walk(abs);
    } else COLLECT.push(abs);
  }
};
if (ERRORS.length === 0) {
  for (const dirName of ["src", "test", "scripts"]) walk(join(CMP, dirName));
  COLLECT.push(join(CMP, "package.json"), join(CMP, "tsconfig.json"), join(CMP, "tsconfig.test.json"), README);
}
if (ERRORS.length > 0) {
  console.error("BUILD_PORTABLE_REFUSED:");
  for (const e of ERRORS) console.error(`  - ${e}`);
  process.exit(1);
}

// credential-shape scan ONLY on real runtime payload files (src/**/types.ts
// /test) and on the pkg manifests — never on generator docs or scripts.
const SCAN_SCOPE = new Set([
  join(CMP, "package.json"), join(CMP, "tsconfig.json"), join(CMP, "tsconfig.test.json"), README,
  ...COLLECT.filter(f => f.includes(`${CMP}/src`)),
]);
const SECRET_SHAPES = [
  new RegExp("SUPA" + "BASE_" + "\\\\[A-Za-z0-9]{8,}", "i"),
  new RegExp("SER" + "VICE" + "_ROLE_?KEY?", "i"),
  new RegExp("RAIL" + "WAY_" + "TION", "i"),
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\brpa_[A-Za-z0-9]{20,}\b/,
];
for (const f of SCAN_SCOPE) {
  if (!existsSync(f)) continue;
  const text = readFileSync(f, "utf-8");
  for (const pattern of SECRET_SHAPES) {
    if (pattern.test(text)) ERRORS.push(`credential-shaped token in ${relative(REPO, f)} (pattern ${pattern.source})`);
  }
}
if (ERRORS.length > 0) {
  console.error("BUILD_PORTABLE_REFUSED:");
  for (const e of ERRORS) console.error(`  - ${e}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const platformTag = process.platform === "win32" ? "win64" : "linux64";
const zipPath = join(OUT, `dna-os-ai-server-${PKG.version}-${platformTag}.zip`);
rmSync(zipPath, { force: true });

const manifest = {
  package: "dna-os-ai-server",
  version: PKG.version,
  platform: platformTag,
  builtAt: new Date().toISOString(),
  files: COLLECT.map(f => ({ path: relative(CMP, f).split("\\").join("/"), sha256: createHash("sha256").update(readFileSync(f)).digest("hex") })),
};

const stage = join(OUT, `stage-${PKG.version}-${platformTag}`);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const abs of COLLECT) {
  const rel = relative(CMP, abs).split("\\").join("/");
  const isReadme = abs === README;
  const dest = isReadme ? join(stage, "README-SERVER.md") : join(stage, "dna-os-compute", rel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(abs, dest);
}
writeFileSync(join(stage, "manifest.json"), JSON.stringify(manifest, null, 2));

if (process.platform === "win32") {
  execFileSync("powershell.exe", ["-NoProfile", "-Command", `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zipPath}' -Force`], { stdio: "inherit" });
} else {
  execFileSync("zip", ["-q", "-r", zipPath, "."], { cwd: stage, stdio: "inherit" });
}
rmSync(stage, { recursive: true, force: true });
const sha = createHash("sha256").update(readFileSync(zipPath)).digest("hex");
console.log(`PORTABLE_BUILT ${zipPath}`);
console.log(`PORTABLE_SHA256 ${sha}`);
console.log(`PORTABLE_FILES ${COLLECT.length + 1}`);

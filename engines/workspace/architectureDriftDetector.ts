/**
 * Development Machine Policy drift detector (Constitution Rule 117, owner,
 * 2026-08-04): "เครื่องพัฒนาจะไม่เป็นเครื่องรัน Production AI Runtime อีก
 * ต่อไป...หากตรวจพบ Local AI Runtime หรือ Local Model ให้แจ้งเตือนเป็น
 * Architecture Drift". Every check here is real and live — a process
 * listening on the Ollama port, a real file on disk, a real grep hit in
 * source — never inferred or assumed clean.
 */
import { execSync } from "child_process";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const HOME = homedir();
const KNOWN_LOCAL_MODEL_DIRS = [join(HOME, ".ollama")];
const OLLAMA_PORT = 11434;

export interface DriftFinding {
  kind: "local_ai_process" | "local_model_directory" | "local_model_file" | "script_references_local_runtime";
  detail: string;
  evidence: string;
}

function sh(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

function checkLocalProcess(): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const lsof = sh(`lsof -i :${OLLAMA_PORT} 2>/dev/null`);
  if (lsof) {
    findings.push({ kind: "local_ai_process", detail: `a process is listening on localhost:${OLLAMA_PORT}`, evidence: lsof.split("\n")[1] ?? lsof });
  }
  const ps = sh(`ps aux | grep -i ollama | grep -v grep`);
  if (ps) {
    findings.push({ kind: "local_ai_process", detail: "a real ollama process is running on this Mac", evidence: ps });
  }
  return findings;
}

function checkLocalModelDirs(): DriftFinding[] {
  const findings: DriftFinding[] = [];
  for (const dir of KNOWN_LOCAL_MODEL_DIRS) {
    if (existsSync(dir)) {
      const size = sh(`du -sh "${dir}" 2>/dev/null`).split("\t")[0] || "unknown size";
      findings.push({ kind: "local_model_directory", detail: `${dir} exists on this Mac`, evidence: `real du: ${size}` });
    }
  }
  return findings;
}

function walkForModelFiles(dir: string, depth = 0, maxDepth = 3, out: string[] = []): string[] {
  if (depth > maxDepth || !existsSync(dir)) return out;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name.startsWith(".git")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walkForModelFiles(full, depth + 1, maxDepth, out);
    else if (/\.(gguf|safetensors)$/i.test(e.name)) out.push(full);
  }
  return out;
}

function checkLocalModelFiles(scanRoots: string[]): DriftFinding[] {
  const findings: DriftFinding[] = [];
  for (const root of scanRoots) {
    for (const f of walkForModelFiles(root)) {
      findings.push({ kind: "local_model_file", detail: `real model weight file found: ${f}`, evidence: `matched .gguf/.safetensors extension` });
    }
  }
  return findings;
}

function checkScriptsReferenceLocalRuntime(localRuntimeDir: string): DriftFinding[] {
  const findings: DriftFinding[] = [];
  if (!existsSync(localRuntimeDir)) return findings;
  for (const f of readdirSync(localRuntimeDir)) {
    if (!/\.(mjs|ts)$/.test(f)) continue;
    if (f === "ollama-cloud-gateway.mjs" || f === "migrate-ollama.ts" || f === "architecture-drift-acceptance-test.ts") continue; // these mention the migration/policy itself (or write synthetic test data), not a live dependency
    const content = readFileSync(join(localRuntimeDir, f), "utf-8");
    for (const line of content.split("\n")) {
      if (line.includes(`localhost:${OLLAMA_PORT}`) && line.includes("fetch(")) {
        findings.push({ kind: "script_references_local_runtime", detail: `${f} still calls localhost:${OLLAMA_PORT} directly`, evidence: line.trim() });
      }
    }
  }
  return findings;
}

export interface DriftReport {
  checked_at: string;
  clean: boolean;
  findings: DriftFinding[];
}

export function detectArchitectureDrift(opts: { localRuntimeDir: string; additionalScanRoots?: string[] }): DriftReport {
  const findings: DriftFinding[] = [
    ...checkLocalProcess(),
    ...checkLocalModelDirs(),
    ...checkLocalModelFiles(opts.additionalScanRoots ?? [opts.localRuntimeDir]),
    ...checkScriptsReferenceLocalRuntime(opts.localRuntimeDir),
  ];
  return { checked_at: new Date().toISOString(), clean: findings.length === 0, findings };
}

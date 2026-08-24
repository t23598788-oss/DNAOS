/**
 * หน้าที่: real, bounded availability detection per provider — never
 * mocked, never defaulted to LIVE. Two real signals only: (1) a running
 * process matching a known, fixed pattern (`pgrep -f`), (2) a known local
 * config/session directory's mere EXISTENCE (never its contents — same
 * "never read the credential value" discipline as
 * connections/github/credential-resolution.ts). Process found -> LIVE.
 * No process but config dir exists -> WAITING_LOGIN (installed, not
 * confirmed logged in/running). Neither found -> UNKNOWN. This process
 * itself IS Claude Code, so claude-code is always LIVE by construction,
 * not detection.
 *
 * Input: none.
 * Output: detectAvailability(provider): Promise<{availability, mechanism}>.
 * Dependency ที่อนุญาต: ./contract.ts (types only), node:child_process,
 * node:fs, node:os.
 * สิ่งที่ห้ามแตะ: never read the contents of a provider's config/session
 * file — existence only.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentProvider, Availability } from "./contract";

const execFileAsync = promisify(execFile);

interface DetectionResult {
  availability: Availability;
  mechanism: string;
}

/** Exported read-only for connections/agent-registry/session-registry.ts's real PID lookup — same fixed pattern this file already uses for availability, never a new provider adapter. */
export const PROCESS_PATTERNS: Partial<Record<AgentProvider, string>> = {
  codex: "codex app-server",
  gemini: "gemini",
  copilot: "copilot",
};

const CONFIG_DIRS: Partial<Record<AgentProvider, string>> = {
  codex: join(homedir(), ".codex"),
  gemini: join(homedir(), ".gemini"),
  copilot: join(homedir(), ".config/github-copilot"),
  kimi: join(homedir(), ".kimi"),
};

async function processMatches(pattern: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/pgrep", ["-f", pattern], { timeout: 5_000, maxBuffer: 8 * 1024 });
    return stdout.trim().length > 0;
  } catch {
    return false; // pgrep exits non-zero when no match — a real "not found", not an error
  }
}

export async function detectAvailability(provider: AgentProvider): Promise<DetectionResult> {
  if (provider === "claude-code") {
    return { availability: "LIVE", mechanism: "this process IS Claude Code — self-evident, not a detected signal" };
  }

  const processPattern = PROCESS_PATTERNS[provider];
  if (processPattern) {
    const running = await processMatches(processPattern);
    if (running) return { availability: "LIVE", mechanism: `pgrep -f "${processPattern}" matched a running process` };
  }

  const configDir = CONFIG_DIRS[provider];
  if (configDir && existsSync(configDir)) {
    return { availability: "WAITING_LOGIN", mechanism: `config directory ${configDir} exists (existence only, contents never read) but no matching process is currently running` };
  }

  return { availability: "UNKNOWN", mechanism: `no running process matched and no known config directory found for provider "${provider}"` };
}

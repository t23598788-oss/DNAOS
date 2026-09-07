/**
 * หน้าที่: the ONLY file in `control/owner-command-semantics/` (Owner
 * UNLOCK, 2026-09-06, PHASE 2D) allowed to touch `node:child_process`.
 * Moved out of `../resolver.ts#runModel` so "the conversation layer can
 * launch a process" is one narrow, auditable file instead of a capability
 * spread across resolver logic.
 *
 * FIXED, not configurable:
 * - `LAUNCHER_PATH` is a literal path computed from `process.cwd()` (the
 *   repo root — see `control/conversation-read-model/store.ts`'s header for
 *   why `__dirname` is wrong once this file compiles into
 *   `control/conversation-runtime/dist/`, Owner UNLOCK 2026-09-06,
 *   REMOVE_TSX_FROM_PRODUCTION_CONVERSATION_RUNTIME), never from Owner
 *   text, a caller argument, or an environment variable.
 * - The only two argv elements passed to it are `sandboxDir` (created by
 *   `mkdtempSync` in this same file, never Owner-supplied) and the literal
 *   string `"input.json"`.
 * - Owner text reaches the child process only as the CONTENT of
 *   `input.json`, written by this file before launch — never as argv, never
 *   interpolated into a shell string. `../run-semantic.sh` itself execs a
 *   hardcoded command line (see its own header) and the kernel-enforced
 *   `../sandbox-profile.sb` denies network and file access outside three
 *   named literals plus the sandbox dir.
 *
 * Input: raw Owner text, an optional sandbox dir override (tests only), an
 * optional `mode` + closed candidate list (REMOVE_HUMAN_PHRASE_HARDCODING_FROM_SELF_KNOWLEDGE_ROUTING,
 * Owner UNLOCK 2026-09-07) — the same shape `../semantic-runner.py` already
 * accepts for its existing `OWNER_TOOL_REQUEST_V1` mode (a `mode` string plus
 * a closed candidate list the model must choose from, never free text it
 * invents). Adding a caller-selectable `mode` is NOT new argv/executable
 * authority — it is still one fixed field inside the SAME `input.json`
 * content this file already wrote before this change; the launcher command
 * line (`LAUNCHER_PATH`, `[dir, "input.json"]`) is unchanged.
 * Output: `{ ok: true; raw: string }` (the model's raw stdout) or
 * `{ ok: false; reason: string }`.
 * Dependency ที่อนุญาต: node:child_process, node:fs, node:path, node:os.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามรับ executable path จาก caller — `LAUNCHER_PATH` คงที่เสมอ.
 * - ห้ามรับ argv เพิ่มจาก caller หรือจากข้อความ Owner.
 * - ห้ามเปลี่ยนจาก `execFileSync` ไปเป็น `exec`/shell string ใดๆ.
 * - `mode`/`allowedCandidates` ต้องเป็น string คงที่ที่ caller เลือกจากรายการ
 *   ปิดเท่านั้น — ห้ามให้ข้อความ Owner ไหลเข้าไปเป็นค่า mode.
 */

declare const require: any;
declare const process: { cwd(): string };

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

const LAUNCHER_PATH: string = path.join(process.cwd(), "control/owner-command-semantics/run-semantic.sh");

export type LanguageProcessorOutcome = { ok: true; raw: string } | { ok: false; reason: string };

export interface LanguageProcessorRequestOptions {
  /** A fixed mode string the CALLER selects — never derived from Owner text. */
  readonly mode?: string;
  /** The closed set of values the model may choose from for this mode — never Owner-supplied. */
  readonly allowedCandidates?: readonly string[];
}

/**
 * `sandboxDir`, when supplied, must already exist and hold only this
 * request's `input.json` — callers never pass a caller-controlled
 * executable or argv through it, only a scratch directory path.
 */
/**
 * Private local-Qwen adapter implementation.  The processor registry owns
 * selection; callers outside this folder only receive `runLanguageProcessor`
 * from the public contract.  Keeping the process launch here preserves the
 * one-file child-process boundary.
 */
export function runFixedLocalQwenProcessor(rawText: string, sandboxDir?: string, options?: LanguageProcessorRequestOptions): LanguageProcessorOutcome {
  const dir = sandboxDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "dna-os-semantic-"));
  try {
    fs.mkdirSync(dir, { recursive: true });
    const input: Record<string, unknown> = { raw_text: rawText };
    if (options?.mode) input.mode = options.mode;
    if (options?.allowedCandidates) input.allowed_candidates = options.allowedCandidates;
    fs.writeFileSync(path.join(dir, "input.json"), JSON.stringify(input));
    const raw = execFileSync(LAUNCHER_PATH, [dir, "input.json"], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { ok: true, raw: String(raw) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

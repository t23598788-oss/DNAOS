/**
 * หน้าที่: the ONE append-only audit trail for Voice Control itself
 * (transcript → resolved intent → what the dispatcher did). Same
 * flat-JSONL, append-only convention `connections/os-ui/adapter-
 * contract.ts`'s own `appendAudit` and `control/agent-gateway/memory-
 * store.ts` already use — never a new database engine.
 *
 * This is deliberately SEPARATE from `connections/os-ui/data/work-order-
 * audit.jsonl` (which already records the real `read_screen`/`speak`
 * Work Orders this capability dispatches) — the two are linked by a
 * shared `correlation_id`, embedded as each Work Order's own
 * `idempotency_key` (`voice-cmd-<id>-read` / `-speak`), so
 * `grep <correlation_id>` across both files traces the full chain: Voice
 * Command -> Work Order -> read_screen/speak -> outcome (STEP
 * requirement I).
 *
 * Input: `VoiceCommandAuditEntry`.
 * Output: `appendVoiceCommandAudit`.
 * Dependency ที่อนุญาต: node:fs, node:path, ./types.ts.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { HandleTranscriptResult } from "./types";

const DATA_DIR_RELATIVE = "connections/voice-command/data";
const AUDIT_FILENAME = "voice-command-audit.jsonl";

export interface VoiceCommandAuditEntry extends HandleTranscriptResult {
  recorded_at: string;
  read_work_order_key: string | null;
  speak_work_order_key: string | null;
  error: string | null;
}

export function appendVoiceCommandAudit(entry: VoiceCommandAuditEntry, repoRoot: string = process.cwd()): void {
  const dir = join(repoRoot, DATA_DIR_RELATIVE);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, AUDIT_FILENAME), `${JSON.stringify(entry)}\n`, "utf-8");
}

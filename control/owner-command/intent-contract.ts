/**
 * หน้าที่: the deterministic owner of the executable Owner-intent vocabulary.
 *
 * WHY IT EXISTS (measured 2026-09-02). The list of intent values that can
 * actually run was written down in three unrelated places — the LLM prompt in
 * `../owner-command-semantics/semantic-runner.py`, a local `operationByIntent`
 * const in `./structured-intent.ts`, and a display switch in
 * `../owner-projection/display-payload.ts` — and no file imported it from any
 * other. Nothing validated it either: `validateOwnerIntent` accepted any
 * non-empty string. The consequences were real and observed in
 * `../owner-command-semantics/data/semantic-history.jsonl`:
 *   - `LIST_CAPABILITIES` was offered to the model by the prompt while no
 *     consumer existed for it;
 *   - `existing` reached the runtime five times, because the prompt's own JSON
 *     example used the prose `"existing Core intent type"` as the field's value
 *     and the model copied it;
 *   - every one of those was reported to the Owner as CAPABILITY_UNKNOWN, which
 *     says "the capability could not be resolved" — a different boundary
 *     entirely from "that intent is not in the contract".
 *
 * THE MODEL DOES NOT DEFINE EXECUTABLE VOCABULARY. `./data/executable-intent-contract.json`
 * is the single artifact; this module types and reads it, and the prompt reads
 * the same file. A prompt may describe the allowed values; it may never be the
 * authority for them.
 *
 * Input: none (reads its own data file).
 * Output: EXECUTABLE_INTENTS, NON_EXECUTABLE_INTENTS, operationForIntent,
 * classifyIntentType.
 * Dependency ที่อนุญาต: node:fs, node:path, node:url.
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่มค่าเข้า `executable` โดยไม่มีผู้บริโภคจริงที่ชี้ได้,
 * ห้ามสร้าง alias ระหว่างค่า, และห้ามให้ไฟล์อื่นประกาศคำศัพท์นี้ซ้ำอีก.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const INTENT_CONTRACT_FILE: string = join(MODULE_DIR, "data", "executable-intent-contract.json");

interface ExecutableEntry { intent_type: string; operation: string | null; consumer: string }
interface ContractShape {
  contract_version: string;
  executable: ExecutableEntry[];
  non_executable: Array<{ intent_type: string; meaning: string }>;
}

const contract = JSON.parse(readFileSync(INTENT_CONTRACT_FILE, "utf8")) as ContractShape;

export const EXECUTABLE_INTENTS: readonly string[] = contract.executable.map((entry) => entry.intent_type);
export const NON_EXECUTABLE_INTENTS: readonly string[] = contract.non_executable.map((entry) => entry.intent_type);

/** The operation an intent maps to, or null when its consumer needs no operation id (a registry read, an agent work request). */
export function operationForIntent(intentType: string): string | null {
  return contract.executable.find((entry) => entry.intent_type === intentType)?.operation ?? null;
}

export type IntentClass = "EXECUTABLE" | "NON_EXECUTABLE" | "NOT_IN_CONTRACT";

/**
 * The only question this module answers about a value the model produced.
 * NOT_IN_CONTRACT is deliberately its own answer: it is not "unknown
 * capability" and not "unknown intent" — it is "software never agreed this
 * word means anything".
 */
export function classifyIntentType(intentType: unknown): IntentClass {
  if (typeof intentType !== "string" || intentType.length === 0) return "NOT_IN_CONTRACT";
  if (EXECUTABLE_INTENTS.includes(intentType)) return "EXECUTABLE";
  if (NON_EXECUTABLE_INTENTS.includes(intentType)) return "NON_EXECUTABLE";
  return "NOT_IN_CONTRACT";
}

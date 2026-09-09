/**
 * หน้าที่: the ONLY module outside this folder is allowed to import from —
 * the public contract of `control/owner-command-semantics/language-processor/`.
 * `./fixed-runner.ts` (the one file with `node:child_process` in this whole
 * conversation layer) is private implementation.
 *
 * Input: re-exports only.
 * Output: `runLanguageProcessor`, `type LanguageProcessorOutcome`.
 * Dependency ที่อนุญาต: ./fixed-runner.ts.
 * สิ่งที่ห้ามแตะ: ห้าม re-export อะไรที่เปิดทางให้ caller เปลี่ยน executable
 * path หรือ argv ของ `./fixed-runner.ts`.
 */

export { runLanguageProcessor, activeLanguageProcessor, getLanguageProcessor, listLanguageProcessors } from "./registry";
export type { LanguageProcessorRegistration, LanguageProcessorAvailability } from "./registry";
export type { LanguageProcessorOutcome, LanguageProcessorRequestOptions } from "./fixed-runner";

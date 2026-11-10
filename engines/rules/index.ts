/**
 * Rules engine — public surface.
 *
 * Callers (API routes, workers) import from here only:
 *   runRulesForEvent   evaluate + optionally send + always log
 *   matchesEvent       pure condition check (used by the UI rule preview)
 *   resolveRecipients  role → people (used by the God View "who gets this")
 */
export * from "./types";
export { matchesEvent, explainMatch, readPath } from "./matching";
export { resolveRecipients } from "./recipients";
export { runRulesForEvent, renderTemplate } from "./dispatch";
export type { DispatchOptions, LineSender, SendResult } from "./dispatch";

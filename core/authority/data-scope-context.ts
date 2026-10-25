/**
 * Request-scoped data access scope (STEP 1, 2026-10-25).
 *
 * The AI/cognitive pipeline calls the dispatcher from several layers
 * (pipeline, executor, planner) that must not grow a scope parameter in every
 * signature. This module carries the ONE scope resolved at the HTTP boundary
 * for the duration of that request, so an inner caller cannot invent a wider
 * scope and a request that never set one fails closed at the dispatcher.
 *
 * Node-only (`node:async_hooks`). Do not import from Edge/middleware code.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { DataScope } from "./data-scope";

const storage = new AsyncLocalStorage<DataScope>();

/** Run `fn` with the request's verified scope attached. */
export function runWithDataScope<T>(scope: DataScope, fn: () => T): T {
  return storage.run(scope, fn);
}

/** The scope attached by the current HTTP boundary, or null when none was set. */
export function currentDataScope(): DataScope | null {
  return storage.getStore() ?? null;
}

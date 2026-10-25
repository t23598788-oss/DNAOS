/**
 * Auto-save real debounce runtime (owner, 2026-08-10, TASK-069 —
 * activating Auto-save as the first genuinely ACTIVE /admin/ide setting,
 * capability #61). Extracted into its own module for the SAME reason
 * ide-regression-test.ts's header already documents for tree.ts/search.ts:
 * "so this suite exercises the exact code the [real caller] calls, not a
 * copy that could drift from it" —
 *
 *   - components/ide-shell/IDEWorkspace.tsx wires this real scheduler's
 *     `onFire` to the EXACT SAME real saveFile() the manual Save button
 *     calls (via a ref — see IDEWorkspace.tsx's autoSaveSchedulerRef).
 *     saveFile() itself already enforces the LOCKED/CRITICAL gates (and
 *     app/api/admin/ide/file/route.ts independently re-enforces LOCKED
 *     server-side) — this module never touches, re-implements, or bypasses
 *     any of that. It ONLY decides WHEN to call the real save path.
 *   - app/api/admin/ide/file/route.ts cites the same real
 *     AUTO_SAVE_DEBOUNCE_MS constant in its RUNTIME_BEHAVIOR_VERIFIED
 *     evidence text — never a re-typed literal.
 *   - scripts/autosave-runtime-test.ts exercises this SAME real scheduler
 *     (real setTimeout, and at least one real assertion using the REAL
 *     AUTO_SAVE_DEBOUNCE_MS interval, not only a shortened test interval).
 *
 * Pure timer bookkeeping only — no fs/network/React import — safe to import
 * from a client component ("use client"), a server route, or a plain Node
 * test script alike (setTimeout/clearTimeout are universal).
 */

/** Real, reasonable debounce interval — the one source of truth, never
 * re-typed as a literal at any of its 3 real call sites
 * (IDEWorkspace.tsx, file/route.ts's evidence text, autosave-runtime-test.ts). */
export const AUTO_SAVE_DEBOUNCE_MS = 2000;

export interface AutoSaveScheduler {
  /** (Re)start the debounce timer for one tab — a real reset on every
   * call, so rapid consecutive edits only ever produce ONE eventual save,
   * not one per keystroke. A no-op that leaves NO live timer running
   * whenever isEnabled() is false at the moment this is called. */
  schedule(tabId: string, path: string): void;
  /** Cancel any pending timer for one tab (e.g. tab closed). */
  cancel(tabId: string): void;
  /** Cancel every pending timer — called the instant Auto-save flips OFF,
   * so no already-scheduled timer can go on to fire after the setting
   * changed (belt-and-suspenders on top of the real re-check `schedule()`
   * itself performs at fire time — see below). */
  cancelAll(): void;
  /** Test-only introspection — never read by production wiring. */
  __debugPendingCount(): number;
}

export interface AutoSaveSchedulerOptions {
  /** Real, live gate — checked BOTH when a timer is (re)started AND again
   * right before it actually fires. This double check is what guarantees
   * Auto-save=OFF can never leave a live timer running that ignores the
   * OFF state: even a timer that was already pending when the setting
   * flipped OFF will refuse to fire once it wakes up. */
  isEnabled: () => boolean;
  /** ms to wait after the most recent schedule() call before firing. Real
   * production callers must pass AUTO_SAVE_DEBOUNCE_MS. */
  debounceMs: number;
  /** Called when the debounce interval elapses with Auto-save still ON.
   * Real production wiring passes a function that calls the EXACT SAME
   * saveFile() the manual Save button calls — never a reimplementation of
   * the write path. */
  onFire: (tabId: string, path: string) => void;
}

export function createAutoSaveScheduler(options: AutoSaveSchedulerOptions): AutoSaveScheduler {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return {
    schedule(tabId, path) {
      const existing = timers.get(tabId);
      if (existing) clearTimeout(existing);
      timers.delete(tabId);
      if (!options.isEnabled()) return; // OFF -> never starts a live timer
      const timer = setTimeout(() => {
        timers.delete(tabId);
        if (!options.isEnabled()) return; // re-checked at fire time — OFF mid-wait must cancel the effect, never a stale fire
        options.onFire(tabId, path);
      }, options.debounceMs);
      timers.set(tabId, timer);
    },
    cancel(tabId) {
      const existing = timers.get(tabId);
      if (existing) {
        clearTimeout(existing);
        timers.delete(tabId);
      }
    },
    cancelAll() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
    __debugPendingCount() {
      return timers.size;
    },
  };
}

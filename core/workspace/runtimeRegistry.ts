import type { RuntimeHandle, RuntimeId, RuntimeStatus, Listener, Unsubscribe } from "./types";

// Runtime Registry — every running system (business engine wrapper, background
// job, live subscription) is registered here exactly once, independent of
// which page (if any) is currently mounted. No page may create or destroy a
// runtime on navigation; a runtime is only ever added/removed by an explicit
// register()/unregister() call from wherever actually owns its lifecycle.
//
// Module-level singleton (not React state) — this is what lets a runtime
// survive a Next.js route change, which unmounts the page component that
// happened to be showing it.

const runtimes = new Map<RuntimeId, RuntimeHandle>();
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((l) => l());
}

export const runtimeRegistry = {
  register(handle: RuntimeHandle): void {
    runtimes.set(handle.id, handle);
    notify();
  },

  unregister(id: RuntimeId): void {
    runtimes.delete(id);
    notify();
  },

  getStatus(id: RuntimeId): RuntimeStatus | undefined {
    return runtimes.get(id)?.status;
  },

  get(id: RuntimeId): RuntimeHandle | undefined {
    return runtimes.get(id);
  },

  list(): RuntimeHandle[] {
    return Array.from(runtimes.values());
  },

  // useSyncExternalStore-compatible.
  subscribe(listener: Listener): Unsubscribe {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export type RuntimeRegistry = typeof runtimeRegistry;
import type { Presenter, RuntimeId, Listener, Unsubscribe } from "./types";
import { runtimeRegistry } from "./runtimeRegistry";

// Presenter Registry — Separated Presentation / Presentation Model (Martin
// Fowler). Each runtime that has UI-facing data registers a Presenter here,
// converting its raw runtime data into a view-model. This is the only
// permitted bridge between Business Engines and UI: a Business Engine must
// never import anything UI-shaped, and WorkspaceShell/pages must never call
// a Business Engine directly — they only ever read a view-model out of here.

const presenters = new Map<RuntimeId, Presenter>();
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((l) => l());
}

export const presenterRegistry = {
  register<TRuntimeData, TViewModel>(
    runtimeId: RuntimeId,
    presenter: Presenter<TRuntimeData, TViewModel>
  ): void {
    presenters.set(runtimeId, presenter as Presenter);
    notify();
  },

  unregister(runtimeId: RuntimeId): void {
    presenters.delete(runtimeId);
    notify();
  },

  // Resolves the current runtime's data through its registered presenter.
  // Returns undefined if either the runtime or its presenter isn't registered.
  getViewModel(runtimeId: RuntimeId): unknown | undefined {
    const presenter = presenters.get(runtimeId);
    const handle = runtimeRegistry.get(runtimeId);
    if (!presenter || !handle) return undefined;
    return presenter.toViewModel(handle);
  },

  subscribe(listener: Listener): Unsubscribe {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export type PresenterRegistry = typeof presenterRegistry;
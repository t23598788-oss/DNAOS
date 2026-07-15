import type { AttachmentEntry, RuntimeId, Visibility, DockPosition, Listener, Unsubscribe } from "./types";

// Attachment Registry — tracks which runtimes are attached to the workspace,
// and their visibility/position. Deliberately separate from Runtime Registry:
// attaching/detaching/hiding a runtime here never starts or stops it — that
// would collapse "is it running" and "is it shown" back into one concept,
// which is the exact thing this layer split exists to prevent.
//
// Only screenController.ts is expected to call the mutating methods below —
// enforced by convention/comment for now (Phase 0, nothing consumes this yet),
// the same way this codebase's other cross-module rules are documented rather
// than force-compiled.

const entries = new Map<RuntimeId, AttachmentEntry>();
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((l) => l());
}

function ensure(runtimeId: RuntimeId): AttachmentEntry {
  let entry = entries.get(runtimeId);
  if (!entry) {
    entry = { runtimeId, attached: false, visibility: "hidden", position: "floating" };
    entries.set(runtimeId, entry);
  }
  return entry;
}

export const attachmentRegistry = {
  // Intended callers: screenController.ts only.
  attach(runtimeId: RuntimeId): void {
    ensure(runtimeId).attached = true;
    notify();
  },

  detach(runtimeId: RuntimeId): void {
    const entry = entries.get(runtimeId);
    if (entry) entry.attached = false;
    notify();
  },

  setVisibility(runtimeId: RuntimeId, visibility: Visibility): void {
    ensure(runtimeId).visibility = visibility;
    notify();
  },

  setPosition(runtimeId: RuntimeId, position: DockPosition): void {
    ensure(runtimeId).position = position;
    notify();
  },

  // Read-only, safe for any caller.
  isAttached(runtimeId: RuntimeId): boolean {
    return entries.get(runtimeId)?.attached ?? false;
  },

  get(runtimeId: RuntimeId): AttachmentEntry | undefined {
    return entries.get(runtimeId);
  },

  list(): AttachmentEntry[] {
    return Array.from(entries.values());
  },

  subscribe(listener: Listener): Unsubscribe {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export type AttachmentRegistry = typeof attachmentRegistry;
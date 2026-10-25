"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import { screenController } from "@/core/workspace";
import type { WorkspaceSnapshot } from "@/core/workspace";

// Workspace Context — Phase 0 (architecture foundation). Formalizes the
// user/auth identity every /admin, /business, /partner, /user layout already
// computes via requireAuthPage() and currently passes down as one-off props,
// plus read-only access to Screen Controller's render snapshot.
//
// Not mounted into app/admin/layout.tsx or WorkspaceShell.tsx yet — creating
// this must not change how anything currently renders. A later phase wraps
// the existing layouts with <WorkspaceProvider> and switches WorkspaceShell
// to read navItems/userEmail from here instead of props.

export interface WorkspaceIdentity {
  userEmail: string;
  role: string;
}

const WorkspaceContext = createContext<WorkspaceIdentity | null>(null);

export function WorkspaceProvider({
  identity,
  children,
}: {
  identity: WorkspaceIdentity;
  children: React.ReactNode;
}) {
  return <WorkspaceContext.Provider value={identity}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaceIdentity(): WorkspaceIdentity {
  const identity = useContext(WorkspaceContext);
  if (!identity) {
    throw new Error("useWorkspaceIdentity() called outside <WorkspaceProvider> — not wired into any layout yet (Phase 0)");
  }
  return identity;
}

// Read-only subscription to Screen Controller's snapshot — survives
// navigation because screenController's state lives outside React (module
// singleton), this hook just re-renders whichever component calls it when
// that state changes.
export function useWorkspaceState(): WorkspaceSnapshot {
  return useSyncExternalStore(
    screenController.subscribe,
    screenController.getSnapshot,
    screenController.getSnapshot
  );
}
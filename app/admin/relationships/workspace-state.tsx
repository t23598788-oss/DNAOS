"use client"

// Owner request 2026-07-11: compose AI Assistant / Business Event Engine /
// Document Engine / Preview Engine / Automation Engine / Rule Engine /
// Timeline / Action Bar / Property Inspector through ONE shared state
// instead of independent pieces. This holds the cross-cutting concerns that
// more than one of those modules needs to read or write — bootstrap-only
// state (relationship list loading, detail fetch) stays local to page.tsx
// since nothing else needs to react to it.
//
// Architecture Migration Phase 1 (2026-07-13): relocated from
// app/admin/line-customers/workspace-state.tsx unchanged — the workspace
// identity moved to relationship_id at the page/feed layer, not here.
// `lineUserId` below stays as-is: a pending preview/send action still
// targets one specific LINE thread (the real send mechanics), which is a
// property of the action, not the workspace's root identity.

import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from "react"

// Owner request 2026-07-11: unifies the two previously-separate confirm
// flows (document.create's Rule-72 token vs debt-reminder's mode param) at
// the state layer — one shape both the Document Engine and the Automation/
// debt-send path populate, so Action Bar + Preview Engine only need to know
// about one "pending preview" concept.
export interface PendingPreview {
  kind: "document_create" | "debt_reminder_send"
  entryId: string
  lineUserId: string
  flexPreview?: object
  fullHtml?: string
  confirmToken?: string
  confirmAction?: string
}

export interface Selection {
  kind: "document" | "business_event" | "action_log" | "message"
  id: string
}

export interface AutomationStatus {
  debtReminderEnabled: boolean
  debtReminderHour: number
}

interface WorkspaceState {
  pendingPreview: PendingPreview | null
  selection: Selection | null
  automation: AutomationStatus | null
}

type WorkspaceAction =
  | { type: "SET_PENDING_PREVIEW"; preview: PendingPreview | null }
  | { type: "SELECT_ITEM"; selection: Selection | null }
  | { type: "SET_AUTOMATION"; automation: AutomationStatus }

const initialState: WorkspaceState = { pendingPreview: null, selection: null, automation: null }

function reducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "SET_PENDING_PREVIEW":
      return { ...state, pendingPreview: action.preview }
    case "SELECT_ITEM":
      return { ...state, selection: action.selection }
    case "SET_AUTOMATION":
      return { ...state, automation: action.automation }
    default:
      return state
  }
}

const WorkspaceContext = createContext<{ state: WorkspaceState; dispatch: Dispatch<WorkspaceAction> } | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  return <WorkspaceContext.Provider value={{ state, dispatch }}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error("useWorkspace must be used inside <WorkspaceProvider>")
  return ctx
}

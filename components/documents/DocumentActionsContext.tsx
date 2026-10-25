"use client"

/**
 * DocumentActionsContext — ตัวกลางให้ Top Tab Bar (BizNav) เรียก action ของ
 * DocumentBuilder (ที่อยู่ใน section create-document) ได้ โดยไม่ต้องสร้าง
 * Toolbar ใหม่ (owner: Print/Share/Save ต้องอยู่บน Top Bar เดิมเท่านั้น)
 *
 * ไม่มี business logic — เป็น wiring ล้วน: DocumentBuilder register action ของตัวเอง,
 * BizNav consume แล้วเรียกเมื่อผู้ใช้กดปุ่มบน top bar (แสดงเฉพาะแท็บ create-document)
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"

export interface DocumentActions {
  print?: () => void
  save?: () => void
  share?: () => void
  canPrint: boolean
  canSave: boolean
  canShare: boolean
  saving: boolean
  /** ข้อความสถานะ share (ถ้ามี) */
  shareHint?: string
}

interface Ctx {
  actions: DocumentActions | null
  register: (a: DocumentActions | null) => void
}

const DocumentActionsCtx = createContext<Ctx>({ actions: null, register: () => {} })

export function DocumentActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<DocumentActions | null>(null)
  const register = useCallback((a: DocumentActions | null) => setActions(a), [])
  const value = useMemo(() => ({ actions, register }), [actions, register])
  return <DocumentActionsCtx.Provider value={value}>{children}</DocumentActionsCtx.Provider>
}

export function useDocumentActions(): Ctx {
  return useContext(DocumentActionsCtx)
}

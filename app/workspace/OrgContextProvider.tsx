"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * WORKSPACE ORG CONTEXT PROVIDER (STEP 3)
 *
 * แหล่งความจริงเดียวของ "องค์กรที่ workspace กำลังทำงานด้วย" ฝั่ง UI:
 *   · GET /api/workspace/org-context (session + membership ของผู้ใช้เอง)
 *   · setOrg = POST แล้วอัปเดต state — ไม่มี tenant เริ่มต้น ไม่มี "DNA OS"
 *   · ใช้ key/remount ที่ผู้บริโภคเพื่อล้างบริบทแชตเมื่อเปลี่ยน org
 */
export interface WorkspaceOrg {
  organizationId: string;
  name: string;
  role: string;
}
interface Ctx {
  memberships: WorkspaceOrg[];
  current: WorkspaceOrg | null;
  ready: boolean;
  switchTo: (organizationId: string) => Promise<boolean>;
}
const OrgCtx = createContext<Ctx | null>(null);

export function OrgContextProvider({ children }: { children: ReactNode }) {
  const [memberships, setMemberships] = useState<WorkspaceOrg[]>([]);
  const [current, setCurrent] = useState<WorkspaceOrg | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/workspace/org-context", { cache: "no-store" })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !data) return;
        const list: WorkspaceOrg[] = Array.isArray(data.memberships)
          ? data.memberships.map((m: { organizationId: string; name: string; role: string }) => ({
              organizationId: m.organizationId,
              name: m.name,
              role: m.role,
            }))
          : [];
        setMemberships(list);
        const selected = typeof data.selected === "string" ? data.selected : "";
        setCurrent(list.find((m) => m.organizationId === selected) ?? null);
      })
      .catch(() => {})
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  const switchTo = useCallback(async (organizationId: string) => {
    const target = memberships.find((m) => m.organizationId === organizationId) ?? null;
    if (!target) return false;
    try {
      const res = await fetch("/api/workspace/org-context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      if (!res.ok) return false;
      setCurrent(target);
      return true;
    } catch {
      return false;
    }
  }, [memberships]);

  const value = useMemo(() => ({ memberships, current, ready, switchTo }), [memberships, current, ready, switchTo]);
  return <OrgCtx.Provider value={value}>{children}</OrgCtx.Provider>;
}

export function useWorkspaceOrg(): Ctx {
  const ctx = useContext(OrgCtx);
  if (!ctx) throw new Error("useWorkspaceOrg ต้องใช้ภายใน OrgContextProvider");
  return ctx;
}

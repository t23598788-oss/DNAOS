"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * WORKSPACE ORG CONTEXT PROVIDER (STEP 3 · แก้ DUPLICATE CONTROL 2026-10-18)
 *
 * แหล่งความจริงเดียวของ "องค์กรที่ workspace กำลังทำงานด้วย" ฝั่ง UI:
 *   · GET /api/workspace/org-context (session + membership ของผู้ใช้เอง) — เฉพาะ top-level
 *   · setOrg = POST แล้วอัปเดต state — ไม่มี tenant เริ่มต้น ไม่มี "DNA OS"
 *   · ใช้ key/remount ที่ผู้บริโภคเพื่อล้างบริบทแชตเมื่อเปลี่ยน org
 *
 * SINGLE CONTROL (owner fix 2026-10-18): workspace จริงเป็นสองชั้น — หน้า /workspace (ชั้นนอก)
 * ฝัง desktop shell (material-workspace) และชั้นในเปิด /workspace?materialSurface=chat|tools.
 * ก่อนหน้านี้ทุกชั้นเรนเดอร์ OrgContextControl ของตัวเอง → production เห็นตัวเลือกองค์กร 2 ชุด
 * ซ้อนกัน (วัดจริง: parent x=1238,y=12 และ nested x=1190,y=12 — ทับกันมุมขวาบน)
 *
 * แก้ที่รากด้วย state กลางเดิม ไม่สร้างตัวเลือกใหม่:
 *   · standalone = true  → ชั้นนอกเท่านั้น: fetch + POST + เป็นเจ้าของค่า และ "ประกาศ" ลง iframe ลูก
 *   · standalone = false → ชั้นใน: ไม่ fetch/ไม่ POST เอง (ไม่ใช่ authority ที่สอง) รับค่าที่ประกาศมา
 *     และขอค่าปัจจุบันจาก parent ตอน mount (ครอบกรณี iframe โหลดหลังผู้ใช้เลือกไปแล้ว)
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

/** ข้อความข้ามชั้น (same-origin เท่านั้น) — ชื่อไม่ชนกับข้อความอื่นของ workspace */
const ORG_BROADCAST = "dna-org-context";
const ORG_REQUEST = "dna-org-context-request";

const OrgCtx = createContext<Ctx | null>(null);

export function OrgContextProvider({ children, standalone = true }: { children: ReactNode; standalone?: boolean }) {
  const [memberships, setMemberships] = useState<WorkspaceOrg[]>([]);
  const [current, setCurrent] = useState<WorkspaceOrg | null>(null);
  const [ready, setReady] = useState(false);

  /** ชั้นนอก: อ่าน membership ของผู้ใช้เอง แล้วแจ้งลูกทุกตัวว่าค่าปัจจุบันคืออะไร */
  useEffect(() => {
    if (!standalone) return;
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
  }, [standalone]);

  /** ชั้นนอก: ประกาศ org ปัจจุบันให้ iframe ลูก (รวม list เพื่อให้ชั้นในแสดงชื่อได้โดยไม่ต้อง fetch ซ้ำ) */
  useEffect(() => {
    if (!standalone || typeof window === "undefined") return;
    const payload = { type: ORG_BROADCAST, org: current, memberships };
    for (const frame of Array.from(document.querySelectorAll("iframe"))) {
      try {
        frame.contentWindow?.postMessage(payload, window.location.origin);
      } catch { /* frame ยังไม่พร้อม — ลูกจะขอเองตอน mount */ }
    }
  }, [standalone, current, memberships]);

  /**
   * ชั้นใน: ขอค่าปัจจุบัน + รับการประกาศ (แหล่งความจริงเดียวกัน ไม่มี fetch ซ้ำ)
   *
   * ROBUST HANDSHAKE (owner 2026-10-18): หน้าจอแชตถูกโหลดค้างไว้ตั้งแต่ shell เปิด ⇒ คำขอครั้งแรก
   * อาจออกก่อนที่ชั้นนอก (เจ้าของ state) หรือ shell ที่ทำหน้าที่ส่งต่อ จะพร้อมรับ ⇒ ประกาศตอบกลับหล่นหาย
   * และไม่มีการประกาศซ้ำอีก เพราะค่าองค์กรไม่เปลี่ยน จึงขอซ้ำแบบมีขอบเขตจนกว่าจะได้ประกาศจริง
   * (ไม่เพิ่ม authority/ที่จัดเก็บใหม่ — ยังเป็นค่าจากชั้นนอกเท่านั้น) */
  useEffect(() => {
    if (standalone || typeof window === "undefined") return;
    let timer: ReturnType<typeof setInterval> | null = null;
    let attempts = 0;
    const ask = () => {
      try {
        window.parent?.postMessage({ type: ORG_REQUEST }, window.location.origin);
      } catch {
        /* parent เข้าถึงไม่ได้ = ไม่มีบริบท */
      }
    };
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; org?: WorkspaceOrg | null; memberships?: WorkspaceOrg[] } | null;
      if (!data || data.type !== ORG_BROADCAST) return;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      setMemberships(Array.isArray(data.memberships) ? data.memberships : []);
      setCurrent(data.org ?? null);
      setReady(true);
    };
    window.addEventListener("message", receive);
    ask();
    timer = setInterval(() => {
      attempts += 1;
      if (attempts > 15) {
        if (timer) clearInterval(timer);
        timer = null;
        return;
      }
      ask();
    }, 400);
    return () => {
      if (timer) clearInterval(timer);
      window.removeEventListener("message", receive);
    };
  }, [standalone]);

  /** ชั้นนอก: ตอบคำขอของ iframe ที่โหลดทีหลัง (ผู้ใช้อาจเลือก org ไปแล้วก่อน frame เปิด) */
  useEffect(() => {
    if (!standalone || typeof window === "undefined") return;
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string } | null;
      if (!data || data.type !== ORG_REQUEST) return;
      for (const frame of Array.from(document.querySelectorAll("iframe"))) {
        if (frame.contentWindow === event.source) {
          frame.contentWindow?.postMessage({ type: ORG_BROADCAST, org: current, memberships }, window.location.origin);
        }
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [standalone, current, memberships]);

  const switchTo = useCallback(async (organizationId: string) => {
    const target = memberships.find((m) => m.organizationId === organizationId) ?? null;
    if (!target) return false;
    // ชั้นในไม่ POST เอง — ให้ชั้นนอก (เจ้าของ state) เป็นผู้สลับ แล้วประกาศกลับมา
    if (!standalone) return false;
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
  }, [memberships, standalone]);

  const value = useMemo(() => ({ memberships, current, ready, switchTo }), [memberships, current, ready, switchTo]);
  return <OrgCtx.Provider value={value}>{children}</OrgCtx.Provider>;
}

export function useWorkspaceOrg(): Ctx {
  const ctx = useContext(OrgCtx);
  if (!ctx) throw new Error("useWorkspaceOrg ต้องใช้ภายใน OrgContextProvider");
  return ctx;
}

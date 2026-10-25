"use client";
import { useEffect, useRef, type ComponentProps } from "react";
import { useSearchParams } from "next/navigation";
import { openExternal } from "@/components/admin/openExternal";
import { WorkspaceFrame as DNAOSChatEngine } from "./DNAOSChatEngine";
import { DesktopWorkspaceShell } from "./DesktopWorkspaceShell";
import { OrgContextProvider, useWorkspaceOrg } from "./OrgContextProvider";

/**
 * WORKSPACE FRAME — เปลือกเดียวของ workspace (ชั้นนอก /workspace และชั้นใน ?materialSurface=)
 *
 * SINGLE ORG CONTROL (owner fix 2026-10-18): หน้านี้ถูกเรนเดอร์ 2 ระดับ —
 *   ชั้นนอก: /workspace (ฝัง desktop shell เป็น iframe)
 *   ชั้นใน: /workspace?materialSurface=chat|tools (iframe ที่ shell เปิด)
 * ถ้าทั้งสองระดับเรนเดอร์ OrgContextControl พร้อมกัน ผู้ใช้จะเห็นตัวเลือกองค์กร 2 ชุดซ้อนมุมขวาบน
 * (วัดจริงก่อนแก้: parent 1238,12 + nested 1190,12) → จึงให้ "ชั้นนอกเท่านั้น" เป็นเจ้าของ
 * ตัวเลือก + state (standalone) และชั้นในรับค่าผ่าน provider ตัวเดิม (standalone=false)
 * ส่วนไอคอน/แถบเครื่องมือ: ชั้นในเมื่อถูกฝังจะไม่วาดเมนูซ้ำของ shell (ส่ง embedded=true)
 */
export function WorkspaceFrame(props: ComponentProps<typeof DNAOSChatEngine>) {
 const { children }=props;
 const searchParams=useSearchParams();
 const materialSurface=searchParams.get("materialSurface");
 /** ชั้นใน = ถูกฝังอยู่ใน desktop shell (shell เป็นผู้ให้ navigation เดียว) */
 const embedded = !!materialSurface || searchParams.has("desktopContent");
 const frame=useRef<HTMLIFrameElement>(null);
 useEffect(()=>{
  const receive=(event:MessageEvent)=>{
   if(event.origin!==window.location.origin||event.source!==frame.current?.contentWindow)return;
   if(event.data?.type==="dna-desktop-open-external"&&typeof event.data.url==="string")void openExternal(event.data.url);
  };
  window.addEventListener("message",receive);
  return ()=>window.removeEventListener("message",receive);
 },[]);
 return (
  <OrgContextProvider standalone={!embedded}>
   {/* NAVIGATION CLEANUP (owner 2026-10-18): ไม่มีตัวเลือก "องค์กร"/"สำนักงานใหญ่" มุมขวาบนอีก
       — OrgContextProvider ยังเป็นเจ้าของ state เดียว (อ่าน cookie ที่ผู้ใช้เลือกไว้ผ่าน
       GET /api/workspace/org-context) และ ChatWithOrg ยัง remount ตาม org เดิม
       ⇒ ลบเฉพาะ "หน้าจอเลือก" ไม่แตะข้อมูลองค์กร สิทธิ์ หรือ API ใด ๆ */}
   {/* SINGLE SIDEBAR (owner 2026-10-18): ผิวเครื่องมือถูกฝังใน shell ⇒ ไม่วาด aside/tab strip ของตัวเอง */}
   {materialSurface==="tools" ? <DesktopWorkspaceShell embedded={embedded}/> : (children||materialSurface==="chat"||searchParams.has("desktopContent")) ? <ChatWithOrg embedded={embedded} {...props}/> : <iframe ref={frame} title="DNA OS Workspace" src="/material-workspace/index.html?dna=1&desktop=1" style={{display:"block",width:"100%",height:"100dvh",border:0}} />}
  </OrgContextProvider>
 );
}

/** ผู้ใช้ทุกตัว import แบบ named ({ WorkspaceFrame }) — default export = duplicate ของ knip */

/** แชตต้อง remount ตาม org (key) — เปลี่ยน org แล้วบริบท/ผลลัพธ์เดิมหายทั้งหมด */
function ChatWithOrg(props: ComponentProps<typeof DNAOSChatEngine>) {
  const { current } = useWorkspaceOrg();
  return <DNAOSChatEngine key={current?.organizationId ?? "no-org"} {...props} orgContext={current} />;
}

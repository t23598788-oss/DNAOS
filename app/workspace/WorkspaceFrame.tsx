"use client";
import { useEffect, useRef, type ComponentProps } from "react";
import { useSearchParams } from "next/navigation";
import { openExternal } from "@/components/admin/openExternal";
import { WorkspaceFrame as DNAOSChatEngine } from "./DNAOSChatEngine";
import { DesktopWorkspaceShell } from "./DesktopWorkspaceShell";
import { OrgContextControl } from "./OrgContextControl";
import { OrgContextProvider, useWorkspaceOrg } from "./OrgContextProvider";

/** The owner-provided L-shaped workspace is the sole presentation shell. */
export function WorkspaceFrame(props: ComponentProps<typeof DNAOSChatEngine>) {
 const { children }=props;
 const searchParams=useSearchParams();
 const materialSurface=searchParams.get("materialSurface");
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
  <OrgContextProvider>
   <OrgContextControl />
   {materialSurface==="tools" ? <DesktopWorkspaceShell/> : (children||materialSurface==="chat"||searchParams.has("desktopContent")) ? <ChatWithOrg {...props}/> : <iframe ref={frame} title="DNA OS Workspace" src="/material-workspace/index.html?dna=1&desktop=1" style={{display:"block",width:"100%",height:"100dvh",border:0}} />}
  </OrgContextProvider>
 );
}

/** ผู้ใช้ทุกตัว import แบบ named ({ WorkspaceFrame }) — default export = duplicate ของ knip */

/** แชตต้อง remount ตาม org (key) — เปลี่ยน org แล้วบริบท/ผลลัพธ์เดิมหายทั้งหมด */
function ChatWithOrg(props: ComponentProps<typeof DNAOSChatEngine>) {
  const { current } = useWorkspaceOrg();
  return <DNAOSChatEngine key={current?.organizationId ?? "no-org"} {...props} orgContext={current} />;
}

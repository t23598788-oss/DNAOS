"use client";

/**
 * WORKSPACE FRAME — BUSINESS UI SHELL ใหม่ตาม reference ของ Owner
 * (sites/workspace-frame/dist/index.html = dna-workspace-frame, v2 2026-09-24)
 *
 * หลัก: หน้าหลักโล่ง · กลางจอ = บอร์ดแชท/คำสั่ง · เมนูซ่อนที่ขอบจอ (กดค่อยเปิด) ·
 * icon ความสามารถเป็นตัวเลือก · ไม่โชว์ dashboard/status/system บนหน้าหลัก ·
 * ไม่มีเมนูถาวรขนาดใหญ่ · ทุกปุ่ม map ไป route เดิมของ DNA OS ·
 * ปุ่มที่ยังไม่มี backend จริง = disabled ชัดเจน (ห้าม fake) ·
 * route/backend เดิมใช้ต่อ — ไม่แตะ business logic/canonical/auth/migration
 */
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useWorkspaceOrg } from "./OrgContextProvider";
import { useRouter } from "next/navigation";
import {
  Grid2X2, Ellipsis, MessageSquare, Settings, FileText, MessageCircle,
  Wallet, MapPin, Briefcase, Users, ScanLine, Files, FileOutput, Printer,
  Download, Share2, History, Paperclip, ArrowUp, X,
  FileSignature, Banknote, Mountain, Server, Cloud, Volume2,
  Image as ImageIcon, Mic, Plus,
} from "lucide-react";
import { openExternal } from "@/components/admin/openExternal";
import FlexPreview from "@/presentation/viewer/FlexPreview";
import Viewer from "@/presentation/viewer/Viewer";
import { RichText } from "@/presentation/ai/RichText";
import { PartnerTimelineList, PartnerSummaryCard } from "@/presentation/panels/PartnerTimeline";
import { BusinessDisplayRenderer } from "@/app/admin/ui-gallery/_lib/BusinessDisplayRenderer";
import type { BusinessDisplayModel } from "@/app/admin/ui-gallery/_lib/businessDisplayModel";
import { sectionsToBlocks, type ChatResult, type ResultSectionLike } from "@/app/api/chat/_lib/chatResultTypes";
import { speak } from "@/components/admin/ttsSpeak";
import { createBrowserSupabase } from "@/services/supabase/browser";

type FrameItem = {
  icon: React.ElementType;
  label: string;
  /** route เดิมของ DNA OS — map ตาม reference ใหม่ */
  route?: string;
  /** URL ภายนอก (เปิดผ่าน openExternal — Tauri+web pattern เดิมของ rail) */
  external?: string;
  /** ยังไม่มี backend จริง → disabled (ห้ามทำปุ่มหลอก) */
  disabledNote?: string;
};

// RUNPOD console shortcut (owner 2026-08-03): เดิมอยู่ใน IconRail ของ
// relationships — shell ใหม่คงไว้ใน drawer (external = เปิด browser จริง
// ไม่ใช่ navigate webview เหมือนเหตุผลเดิมที่ rail ไม่มี href)
const RUNPOD_CONSOLE_URL = "https://console.runpod.io/pods";

/** apps ตาม reference: ไฟล์·เอกสาร·LINE·การเงิน·GPS·งาน·รายชื่อ·สแกน/AI (+ความสัมพันธ์ ตามคำสั่ง map ของ Owner) */
/** รายการถัดไป = จุดหมาย rail เดิมของ relationships ที่ย้ายมา shell (คงทางเข้าไว้ครบทุกตัว) */
const APPS: FrameItem[] = [
  { icon: Files, label: "ไฟล์", route: "/admin/storage" },
  { icon: FileText, label: "เอกสาร", route: "/admin/create-document" },
  { icon: MessageCircle, label: "LINE", route: "/admin/line-customers" },
  { icon: Wallet, label: "การเงิน", route: "/admin/finance" },
  { icon: MapPin, label: "GPS", route: "/admin/equipment" },
  { icon: Briefcase, label: "งาน", route: "/admin/jobs" },
  { icon: Users, label: "รายชื่อ", route: "/admin/partners" },
  { icon: ScanLine, label: "สแกน / AI", route: "/admin/receipts" },
  { icon: MessageSquare, label: "ความสัมพันธ์", route: "/admin/relationships" },
  { icon: FileSignature, label: "รายการเอกสาร", route: "/admin/transactions" },
  { icon: Banknote, label: "ลูกหนี้", route: "/admin/debt-tracking" },
  { icon: Mountain, label: "ศูนย์ควบคุมทรัพยากร", route: "/admin/pits" },
  { icon: Server, label: "ค่าใช้จ่าย", route: "/admin/infrastructure" },
  { icon: Cloud, label: "Cloud GPU", external: RUNPOD_CONSOLE_URL },
];

/** actions ตาม reference — เหลือแค่ตัวที่มี backend จริง (ประวัติ→event-inbox) ที่เหลือ disabled */
const ACTIONS: FrameItem[] = [
  { icon: History, label: "ประวัติ / หลักฐาน", route: "/admin/event-inbox" },
  { icon: FileOutput, label: "แปลงไฟล์", disabledNote: "ยังไม่มี backend แปลงไฟล์" },
  { icon: Printer, label: "พิมพ์", disabledNote: "ใช้ในหน้าเอกสาร (ปุ่ม พิมพ์ / ส่งออก PDF)" },
  { icon: Download, label: "ดาวน์โหลด", disabledNote: "ยังไม่มี backend ดาวน์โหลดรวม" },
  { icon: Share2, label: "แชร์ / ส่งต่อ", disabledNote: "ยังไม่มี backend แชร์/ส่ง" },
];

/**
 * QAI COMPOSER TOOLS (owner 2026-10-18 ข้อ 02)
 * แสดงเฉพาะเครื่องมือที่มีอยู่จริง — ทั้งสามรายการใช้ "ระบบอัปโหลดเดิม"
 * (POST /api/admin/upload · bucket attachments · route เดิม) ต่างกันแค่ชนิดไฟล์ที่เปิดให้เลือก
 * ไม่มีระบบอัปโหลด/เครื่องมือใหม่ และไม่มี backend ใหม่
 */
type ComposerToolId = "file" | "image" | "document";
const COMPOSER_TOOLS: { id: ComposerToolId; label: string; icon: React.ElementType; accept: string }[] = [
  { id: "file", label: "แนบไฟล์", icon: Paperclip, accept: "" },
  { id: "image", label: "รูปภาพ", icon: ImageIcon, accept: "image/png,image/jpeg,image/webp,image/gif" },
  { id: "document", label: "เอกสาร", icon: FileText, accept: ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" },
];

/**
 * ระบบรับเสียงเดิมของ DNA OS = มีแต่ TTS (speak) — ยังไม่มี speech-input capability
 * ที่ลงทะเบียนไว้ จึงตรวจเฉพาะ hook ที่มีจริงก่อนเปิดใช้ปุ่มไมค์
 * (ไม่สร้าง Voice Engine ใหม่ตามข้อ 03 · ถ้าไม่มี = แสดงสถานะไม่พร้อมใช้งาน)
 */
function voiceInputAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return typeof (window as unknown as { dnaVoiceInput?: unknown }).dnaVoiceInput === "function";
}

/** CSS ยึด tokens + โครงสร้างของ reference (paper/ink/line/soft · edge drawer · stage โล่ง) */
const FRAME_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap');
/* Theme tokens arrive from the shell's existing settings point via postMessage
   (dna-workspace-theme). Defaults equal the pre-existing palette, so an
   unthemed workspace renders exactly as before. */
/* WORKSPACE READABILITY STANDARD (owner 2026-10-19): หมึกหลักเข้มขึ้น (#2a2723 เดิม #36332f)
   · base 14px · ข้อความหลัก/สนทนา 16px · หัวข้อ 18–20px · ทุกข้อความ ≥14px */
#dna-frame{--paper:#fff;--ink:#2a2723;--line:#ece7e0;--soft:#f6f3ef;--muted:color-mix(in srgb,var(--ink) 74%,var(--paper));--qai-compose-bg:rgba(255,255,255,.78);--qai-compose-hover:#fff;--qai-compose-focus:#fff;--qai-compose-border:rgba(120,110,98,.16);--qai-compose-border-strong:rgba(120,110,98,.32);--qai-blur:8px;--qai-radius:14px;position:relative;background:var(--paper);color:var(--ink);font:14px/1.6 'Sarabun',Tahoma,system-ui,sans-serif;font-size:var(--qai-font-size,14px);border:1px solid var(--line);border-radius:16px;overflow:hidden;height:100dvh;display:flex;flex-direction:column}
#dna-frame .stage{position:relative;flex:1 1 auto;min-height:0;padding:56px 48px calc(10px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column}
#dna-frame *{box-sizing:border-box}
#dna-frame button,#dna-frame textarea{font:inherit;color:inherit}
#dna-frame button{background:transparent;border:1px solid var(--line);border-radius:9px;padding:8px 12px;min-height:44px;cursor:pointer}
#dna-frame button:hover,#dna-frame button[aria-pressed=true]{background:var(--soft)}
#dna-frame button[aria-disabled=true]{opacity:.45;cursor:not-allowed}
#dna-frame button[aria-disabled=true]:hover{background:transparent}
#dna-frame .corner{position:absolute;z-index:4;right:14px;top:16px;background:var(--paper)}
#dna-frame .gear{position:absolute;left:12px;bottom:16px;z-index:3;background:var(--paper)}
#dna-frame .stage--bleed{padding:52px 12px calc(10px + env(safe-area-inset-bottom,0px))}
#dna-frame .edge{position:absolute;top:20px;padding:8px}
#dna-frame .edge.left{left:8px}
/* top:82px = ตำแหน่ง reference (sites/workspace-frame) — ตอนนี้ stage เริ่มที่ y=0
   หลังถอด header จึงต้องเว้นมุมขวาบนให้ปุ่ม .corner (ข้อความ) ไม่ซ้อน Ellipsis */
#dna-frame .edge.right{right:8px;top:82px}
#dna-frame .drawer{position:absolute;top:76px;left:12px;right:12px;z-index:2;background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:16px;box-shadow:0 12px 24px #0002}
#dna-frame .drawer .row,#dna-frame .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#dna-frame .tools{display:grid;grid-template-columns:repeat(auto-fit,minmax(115px,1fr));gap:8px;margin-top:12px}
#dna-frame .tools button{display:flex;align-items:center;gap:8px;justify-content:flex-start;text-align:left}
#dna-frame .canvas{flex:1;min-height:0;min-width:0;display:flex;flex-direction:column}
#dna-frame .msg-panel{position:absolute;top:56px;right:12px;bottom:12px;width:min(420px,calc(100% - 24px));z-index:5;background:var(--paper);border:1px solid var(--line);border-radius:14px;box-shadow:0 12px 24px #0002;display:flex;flex-direction:column;padding:14px;gap:10px;overflow:hidden}
#dna-frame .msg-panel .row strong{margin-right:auto;font-weight:500}
#dna-frame .msg-panel .panel-body{flex:1;min-height:0;overflow:auto}
#dna-frame .content{flex:1;padding:32px 0;min-height:200px;display:flex;flex-direction:column}
#dna-frame .content--fill{padding:0;min-height:0;overflow:hidden}
#dna-frame .content--fill>div,#dna-frame .content--fill>section{flex:1 1 0%;min-height:0}
#dna-frame .count{background:#a34a3a;color:#fff;min-width:20px;border-radius:10px;font-size:14px;padding:0 6px;margin-left:auto}
/* ── WORKSPACE DISPLAY STANDARD V1 (docs/WORKSPACE_DISPLAY_STANDARD_V1.md) ──
   Q-Timeline: ข้อความจริงชิดซ้ายบนพื้น Workspace สี paper/ink เดิม · ไม่มี bubble
   ไม่มี border/box-shadow รอบข้อความ · หนึ่งคำถาม = หนึ่ง q-entry */
#dna-frame .q-timeline{width:100%;min-width:0;display:flex;flex-direction:column;align-items:stretch;gap:32px;flex:1 1 auto;min-height:0;overflow-y:auto;padding-bottom:12px}
#dna-frame .content:not(.content--fill) .q-timeline{max-height:none}
#dna-frame .content--fill .q-timeline{flex:0 1 auto;max-height:42vh}
#dna-frame .q-entry{width:100%;min-width:0;display:flex;flex-direction:column;align-items:stretch;background:transparent;border:0;border-radius:0;box-shadow:none}
#dna-frame .q-heading{display:flex;align-items:flex-start;gap:12px;width:100%;min-width:0}
#dna-frame .q-label{flex:0 0 auto;font-weight:700;font-size:16px}
#dna-frame .q-question{flex:1;min-width:0;font-size:16px;font-weight:600;line-height:1.65;overflow-wrap:anywhere}
#dna-frame .q-content{width:100%;min-width:0;padding:12px 0 0 26px}
#dna-frame .q-answer{width:100%;min-width:0;font-size:16px;font-weight:400;line-height:1.8;overflow-wrap:anywhere;background:transparent;border:0;border-radius:0;box-shadow:none}
#dna-frame .q-answer>div+div{margin-top:14px}
#dna-frame .q-events{width:100%;min-width:0;font-size:14px;line-height:1.6}
#dna-frame .q-events>div+div{margin-top:4px}
#dna-frame .q-error{width:100%;min-width:0;color:#a8342c;background:transparent;border:0;border-radius:0;box-shadow:none}
#dna-frame .workspace-content-column{width:100%;max-width:1040px;min-width:0;margin-inline:auto;box-sizing:border-box;padding-inline:16px}
#dna-frame button[disabled]{opacity:.5;cursor:not-allowed}
#dna-frame button[disabled]:hover{background:transparent}
/* หัวข้อเปิดจอ = 20px (อยู่ในช่วงหัวข้อ 18–20px ตาม WORKSPACE READABILITY STANDARD) */
#dna-frame .blank{text-align:center;padding:42px 0;font-size:20px;font-weight:600}
/* QAI COMPOSER — กล่องเดียว (owner 2026-10-18 ข้อ 01–04): กล่องเปล่า ~50px
   · ปุ่ม (+) ซ้าย · ช่องพิมพ์กลาง · ไมค์ + ส่งขวา · ไอคอนขนาดเล็กสม่ำเสมอ
   · พื้นหลังโปร่งแสงเล็กน้อย เส้นขอบบาง เงาอ่อน — ยังคมชัดเมื่อ hover/focus */
#dna-frame .compose{border:1px solid var(--qai-compose-border);border-radius:var(--qai-radius);padding:5px 7px 5px 8px;margin-top:auto;background:var(--qai-compose-bg);backdrop-filter:blur(var(--qai-blur));-webkit-backdrop-filter:blur(var(--qai-blur));box-shadow:0 3px 14px rgba(45,38,30,.045);transition:opacity .16s ease,background-color .16s ease,border-color .16s ease,box-shadow .16s ease}
#dna-frame .compose-main{display:flex;align-items:flex-end;gap:6px;min-height:38px}
#dna-frame .compose-main button{display:grid;place-items:center;flex:0 0 32px;width:32px;height:32px;min-height:0;padding:0;border:1px solid transparent;border-radius:9px;background:transparent;color:var(--ink)}
#dna-frame .compose-main button:hover{background:var(--soft)}
#dna-frame .compose-main button:disabled{opacity:.55;cursor:not-allowed;background:transparent}
#dna-frame .compose-main button[aria-disabled=true]{opacity:.55;cursor:help;background:transparent}
#dna-frame .compose-main button[aria-disabled=true]:hover{background:transparent}
#dna-frame .compose-main svg{width:18px;height:18px}
#dna-frame .compose-main .compose-mic{color:#8a8279}
#dna-frame .compose-main .compose-send{background:#514b45;border-color:#514b45;color:#fff}
#dna-frame .compose-main .compose-send:hover{background:#3e3934}
/* เมนูเครื่องมือ (+) — แถวกระชับเหนือช่องพิมพ์ · เปิดเฉพาะเครื่องมือที่มีอยู่จริง */
#dna-frame .compose-tray{display:flex;align-items:center;gap:6px;padding:0 2px 5px;flex-wrap:wrap}
#dna-frame .compose-tray[hidden],#dna-frame .compose-menu[hidden]{display:none}
#dna-frame .compose-menu{display:flex;align-items:center;gap:4px;flex:1 1 auto;min-width:0}
#dna-frame .compose-menu>button{display:inline-flex;align-items:center;gap:5px;height:32px;min-height:0;padding:0 10px;border:1px solid var(--line);border-radius:8px;background:#fff;font-size:14px;color:#514b45;white-space:nowrap}
#dna-frame .compose-menu>button:hover{background:var(--soft)}
#dna-frame .compose-menu svg{width:15px;height:15px}
#dna-frame .compose-menu .compose-menu-close{margin-left:auto;width:26px;padding:0;justify-content:center;border-color:transparent;background:transparent;color:#8a8279;font-size:15px}
#dna-frame .compose-chip{display:inline-flex;align-items:center;gap:6px;font-size:14px;color:#514b45;background:var(--soft);border-radius:999px;padding:3px 4px 3px 10px;white-space:nowrap}
#dna-frame .compose-chip button{display:grid;place-items:center;width:20px;height:20px;min-height:0;padding:0;border:0;border-radius:50%;background:transparent;color:#8a8279}
#dna-frame .compose-chip button:hover{background:#e9e3da}
#dna-frame .compose-note{display:inline-flex;align-items:center;gap:6px;font-size:14px;line-height:1.4;color:#8a5738;background:#fdf8ef;border:1px solid #f0e3cd;border-radius:999px;padding:3px 4px 3px 10px}
#dna-frame .compose-note button{display:grid;place-items:center;width:20px;height:20px;min-height:0;padding:0;border:0;border-radius:50%;background:transparent;color:#8a5738}
#dna-frame .compose-note button:hover{background:#f6ead6}
/* ONE AI COMPOSER — บริบทแท็บที่กำลังเปิดอยู่ (รับจาก shell ผ่าน postMessage เดิม) */
#dna-frame .compose-context-row{display:flex;padding:0 2px 4px}
#dna-frame .compose-context{display:inline-flex;align-items:center;gap:6px;max-width:100%;min-width:0;font-size:14px;color:var(--muted);background:var(--soft);border-radius:999px;padding:3px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#dna-frame .compose-context strong{font-weight:600;color:var(--ink);min-width:0;overflow:hidden;text-overflow:ellipsis}
/* Theme-aware composer internals — only when the shell's dark glass preset is on */
#dna-frame[data-ws-theme=dark] .compose-main .compose-mic{color:var(--qai-muted,#b9b0a5)}
#dna-frame[data-ws-theme=dark] .compose-main .compose-send{background:var(--ink);border-color:var(--ink);color:var(--qai-bg)}
#dna-frame[data-ws-theme=dark] .compose-menu>button,
#dna-frame[data-ws-theme=dark] .compose-chip,
#dna-frame[data-ws-theme=dark] .compose-context{background:var(--qai-soft);border-color:var(--qai-line);color:var(--ink)}
#dna-frame[data-ws-theme=dark] .compose-note{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.16);color:#e8c9a4}
/* ADAPTIVE COMPOSER: โปร่งใสเล็กน้อยเมื่อไม่ใช้งาน · ชัดขึ้นเมื่อ hover/focus โดยไม่เพิ่มกรอบหนา */
#dna-frame .compose:hover{background:var(--qai-compose-hover);border-color:var(--qai-compose-border-strong,var(--qai-compose-border));box-shadow:0 6px 20px rgba(53,51,48,.07);opacity:1}
#dna-frame .compose:focus-within{background:var(--qai-compose-focus);border-color:var(--qai-compose-border-strong,var(--qai-compose-border));box-shadow:0 6px 20px rgba(53,51,48,.07);opacity:1}
/* COMPACT MODE: เมื่อ shell ย่อกล่องนี้เป็น Compact Floating Composer (พื้นที่เตี้ย) —
   ซ่อนเฉพาะส่วนที่ไม่จำเป็นต่อการพิมพ์ ให้กล่องพิมพ์กินพื้นที่ที่เหลือ · ไม่แตะข้อความที่พิมพ์ค้าง */
@media(max-height:150px){
  #dna-frame{border:0;border-radius:0;background:transparent}
  #dna-frame .stage{padding:5px 7px}
  #dna-frame .q-timeline,#dna-frame .blank,#dna-frame .corner,#dna-frame .edge,#dna-frame .q-events,#dna-frame .compose-context-row{display:none}
  #dna-frame .compose{opacity:.82;background:var(--qai-compose-bg);border-radius:calc(var(--qai-radius) - 2px);padding:4px 6px;box-shadow:0 2px 10px rgba(53,51,48,.1)}
  #dna-frame .compose:hover{opacity:1;background:var(--qai-compose-hover)}
  #dna-frame .compose:focus-within{opacity:1;background:var(--qai-compose-focus)}
}
/* ประวัติการสื่อสารในแผงเดิม — ลิสต์จากบทสนทนาจริงของเซสชันนี้เท่านั้น */
#dna-frame .history-list{margin:8px 0 0;padding-left:18px;font-size:14px}
#dna-frame .history-list>li{margin-bottom:10px}
#dna-frame .history-events{margin:4px 0 0;padding-left:16px;font-size:14px;color:var(--muted);list-style:disc}
/* ช่องพิมพ์: 1 บรรทัด = 38px · ขยายเองตามบรรทัด (JS clamp 96px) แล้วเลื่อนภายใน */
#dna-frame .compose-main textarea{flex:1 1 auto;width:auto;min-width:0;min-height:38px;max-height:96px;padding:8px 4px;line-height:20px;resize:none;overflow-y:auto;background:transparent;border:0;outline:none;display:block}
#dna-frame .note{font-size:14px;color:var(--muted)}
/* BUSINESS RESULT PRESENTATION — WORKSPACE DISPLAY STANDARD V1: ผลลัพธ์ทุกชนิด
   อ้างความกว้างจากคอลัมน์กลาง (.workspace-content-column) ไม่มี max-width bubble จำกัดซ้ำ */
#dna-frame .result-block{width:100%;max-width:100%;display:flex;flex-direction:column;gap:8px;min-width:0}
#dna-frame .document-result{width:100%;max-width:100%;min-width:0;overflow:hidden}
#dna-frame .document-result img,#dna-frame .document-result canvas{display:block;width:100%;max-width:100%;height:auto;object-fit:contain}
#dna-frame .document-result iframe{display:block;width:100%;height:min(80vh,1120px);border:0}
#dna-frame .result-title{font-weight:600;font-size:14px}
#dna-frame .result-notes{font-size:14px;color:var(--muted)}
#dna-frame .msg-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#dna-frame .msg-actions button{min-height:38px;font-size:14px;padding:6px 12px}
/* ลำโพงอ่านข้อความใต้คำตอบ — ไอคอนเล็ก ไม่กินพื้นที่แชต (owner 2026-10-18 ข้อ 9) */
#dna-frame .reply-tts{margin-top:2px}
#dna-frame .reply-tts button{min-height:0;min-width:0;padding:2px 4px;border:0;background:transparent;opacity:.5}
#dna-frame .reply-tts button:hover{opacity:.9;background:transparent}
#dna-frame .msg-attachment{max-width:min(420px,90%)}
#dna-frame .attachment-row{display:flex;gap:10px;align-items:center;background:#fff;border:1px solid var(--line);border-radius:12px;padding:8px 12px;flex-wrap:wrap}
#dna-frame .attachment-link{font-size:14px;color:#0f766e;text-decoration:underline}
#dna-frame .result-timeline{max-width:100%}
#dna-frame svg{width:18px;height:18px;vertical-align:middle}
@media(max-width:500px){  #dna-frame .stage{padding:52px 12px 8px}#dna-frame .blank{padding:24px 0}}
`;

export function WorkspaceFrame({
  children,
  messagePanel,
  panelOpen,
  onPanelOpenChange,
  composerContext,
  onComposerSent,
  selfRoute,
  itemBadges,
  orgContext: _orgContextProp,
  embedded,
}: {
  /** canvas หลัก = entity context ที่เลือก — ไม่ส่ง = หน้าโล่งตาม reference */
  children?: ReactNode;
  /** เนื้อหาแผง "ประวัติการสื่อสาร" (กดปุ่มมุมขวาบน) — ไม่ส่ง = ปุ่มไป /admin/event-inbox เดิม */
  messagePanel?: ReactNode;
  /** เปิด/ปิดแผง (controlled ก็ได้ ไม่ส่งก็ใช้ state ในตัว) */
  panelOpen?: boolean;
  onPanelOpenChange?: (open: boolean) => void;
  /** context ของ entity ที่เลือก — ไม่มีช่องทาง LINE → ยิง /api/chat ด้วย
   *  sessionKey/knownCustomerId/knownCustomerName (ชุดเดียวกับ runCommand/ask) +
   *  upload ลงโฟลเดอร์ documentId · มีช่องทาง LINE → communication action
   *  ใช้ LINE/send API เดิม (POST …/reply) */
  composerContext?: {
    /** channel จริงของ entity — มีค่า = ส่งข้อความผ่าน LINE reply API เดิม */
    lineUserId?: string | null;
    relationshipId?: string;
    sessionKey?: string;
    knownCustomerId?: string;
    knownCustomerName?: string | null;
    documentId?: string;
  };
  /** หลังส่งสำเร็จ (LINE) — ให้หน้าเจ้าของ canvas refresh timeline ตัวเอง */
  onComposerSent?: () => void;
  /** route ของหน้าปัจจุบัน — item นี้ใน drawer แค่ปิดเมนู ไม่ navigate ซ้ำ */
  selfRoute?: string;
  /** ตัวเลขจริงจากชั้นข้อมูลของหน้า (key = label ของ item ใน drawer) */
  itemBadges?: Record<string, number>;
  /** องค์กรปัจจุบันของ workspace (STEP 3) — ผู้เรียกส่งมาเป็นค่าตั้งต้น; ค่าจริงมาจาก context */
  orgContext?: { organizationId: string; name: string } | null;
  /**
   * EMBEDDED CHROME (owner fix 2026-10-18): true = หน้านี้ถูกฝังใน desktop shell
   * (material-workspace) ซึ่งมีแถบเครื่องมือของตัวเองอยู่แล้ว → ไม่วาดไอคอนที่ซ้ำกับ shell
   *   · .gear (ตั้งค่า)          → shell มีปุ่มการเชื่อมต่อ/ตั้งค่าอยู่แล้ว
   *   · .edge left (กล่องเครื่องมือ) → shell มีปุ่ม "เปิดเครื่องมือ" อยู่แล้ว
   * เก็บ .edge right (คำสั่งของรายการ) + .corner (ประวัติการสื่อสาร) ไว้ เพราะ shell ไม่มีคู่ซ้ำ
   * ไม่สร้าง navigation ใหม่ — ใช้ของเดิมทั้งสองชั้น
   */
  embedded?: boolean;
}) {
  const { current: _ctxOrg } = useWorkspaceOrg();
  const orgContext = _ctxOrg ?? _orgContextProp ?? null;
  const router = useRouter();
  const [drawer, setDrawer] = useState<null | "apps" | "actions">(null);
  /** บริบทของแท็บที่กำลังเปิดใน shell (รับผ่าน postMessage — ไม่ใช่ state ธุรกิจ) */
  const [activeScreen, setActiveScreen] = useState<{ label: string; route: string; kind: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [internalPanel, setInternalPanel] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  /** QAI COMPOSER tools (+) — เมนูเครื่องมือ/รายการที่เลือก/สถานะไมค์ (UI state เท่านั้น) */
  const [toolOpen, setToolOpen] = useState(false);
  const [selectedTool, setSelectedTool] = useState<ComposerToolId | null>(null);
  const [toolNote, setToolNote] = useState<string | null>(null);
  const [voiceReady] = useState(() => voiceInputAvailable());
  const selectedToolInfo = COMPOSER_TOOLS.find((tool) => tool.id === selectedTool) ?? null;
  // ── WORKSPACE DISPLAY STANDARD V1 (§Composer Focus / §Scroll) ──
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timelineRef = useRef<HTMLElement>(null);
  /** §07 — คลิกพื้นที่ว่างในกรอบ compose แล้ว focus textarea (ปุ่ม/ช่องอื่นไม่ถูกแย่งคลิก) */
  const focusComposer = (event: MouseEvent<HTMLFormElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest("button, input, textarea, a, [role='button']")) return;
    textareaRef.current?.focus();
  };
  /** §07.4 — textarea ขยายตามจำนวนบรรทัด (หลายบรรทัด · ภาษาไทย/IME ใช้งานปกติ) */
  const autoGrowComposer = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    // 38px = 1 บรรทัด · 96px = เพดานสูงสุด แล้วเลื่อนข้อความภายใน (owner ข้อ 01)
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 38), 96)}px`;
  };
  /** ขนาดตามจำนวนบรรทัดจริง และกลับกะทัดรัดทันทีเมื่อส่ง/ล้างข้อความ */
  useEffect(() => {
    autoGrowComposer();
  }, [draft]);
  /** แจ้ง shell ว่ากล่องพิมพ์ถูกใช้งาน — ฟังระดับ document เพื่อไม่ให้สถานะค้าง
      เมื่อโฟกัสย้ายออกจากปุ่มที่ถูกซ่อน/ถอด (เมนู +) */
  useEffect(() => {
    const sync = () => {
      const el = document.activeElement;
      postComposerActive(el instanceof Element && !!el.closest("form.compose"));
    };
    const syncNext = () => window.setTimeout(sync, 0);
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", syncNext);
    document.addEventListener("mousedown", syncNext);
    return () => {
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", syncNext);
      document.removeEventListener("mousedown", syncNext);
    };
  }, []);
  /** ปิดเมนู (+) ด้วย Esc หรือคลิกนอกเมนู (owner ข้อ 02) */
  useEffect(() => {
    if (!toolOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setToolOpen(false);
    };
    const onPointer = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".compose-tray, [data-compose-plus]")) return;
      setToolOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [toolOpen]);
  /** §09 — auto-scroll เฉพาะตอนผู้ใช้อยู่ท้ายรายการ · ย้อนอ่าน = หยุดจนกว่าจะกลับลงท้าย */
  const stickToBottom = useRef(true);
  const onTimelineScroll = () => {
    const el = timelineRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };
  const panelIsOpen = panelOpen ?? internalPanel;
  const setPanelOpen = (open: boolean) => {
    setInternalPanel(open);
    onPanelOpenChange?.(open);
  };
  // LOGIC WIRING (owner 2026-09-25) — เสียบ backend จริงเข้า element เดิมของ
  // frame นี้เท่านั้น (ไม่เปลี่ยนโครง DOM/ID/Class):
  //   textarea → POST /api/chat (cognitive pipeline จริง · session gate ของ route เดิม)
  //   แนบไฟล์  → POST /api/admin/upload (bucket attachments จริง · route เดิม)
  //   กลางจอ   → render message/response ที่ได้จาก API จริง
  const [messages, setMessages] = useState<{
    id: number;
    role: "user" | "ai" | "system";
    text: string;
    /** RESPONSE CONTRACT — render ตามชนิดข้อมูลจริง (spec §2) */
    result?: ChatResult;
    confirm?: { action: string; token: string; busy?: boolean };
    docHtml?: string;
    flexPreview?: unknown;
  }[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  // เสียงอ่านข้อความ (TTS) — ใช้ความสามารถเดิม (speak) แต่ย้ายไปอยู่ใต้ข้อความตอบกลับ
  // เป็นไอคอนเล็ก และ "ไม่อ่านอัตโนมัติ": พูดเมื่อผู้ใช้กดไอคอนนั้นเท่านั้น (owner 2026-10-18 ข้อ 9)
  const msgSeq = useRef(0);
  const pushMsg = (
    role: "user" | "ai" | "system",
    text: string,
    extra?: {
      result?: ChatResult;
      confirm?: { action: string; token: string };
      docHtml?: string;
      flexPreview?: unknown;
    },
  ) => {
    msgSeq.current += 1;
    setMessages((m) => [...m, { id: msgSeq.current, role, text, ...extra }]);
  };

  // ONE AI COMPOSER — บริบทแท็บ (owner 2026-10-18 ข้อ 5–7): shell แจ้งหน้าจอที่เปิดอยู่
  // ผ่าน postMessage เดิมของ workspace (same-origin เท่านั้น) · ใช้เพื่อ "แสดง" บริบท
  // ของกล่องกลางและส่งต่อให้ผู้ใช้เห็นว่าคำสั่งนี้ทำงานในหน้าไหน — ไม่ได้เปลี่ยน
  // สัญญา /api/chat, ไม่เพิ่ม engine/gateway และไม่ reload หน้า (ข้อความค้างอยู่)
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; label?: string; route?: string; kind?: string } | null;
      if (!data || data.type !== "dna-workspace-active-screen") return;
      setActiveScreen({
        label: typeof data.label === "string" ? data.label : "Workspace",
        route: typeof data.route === "string" ? data.route : "",
        kind: typeof data.kind === "string" ? data.kind : "chat",
      });
      // เปลี่ยนแท็บ = หุบเมนูเครื่องมือ (ไม่ให้ค้างข้ามหน้าจอ)
      setToolOpen(false);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  // WORKSPACE THEME (owner 2026-10-18 ข้อ 03) — the shell's existing settings point
  // sends the same CSS custom properties it applies to its own chrome. This is the
  // SAME composer, not a second chat engine: it only colors the existing #dna-frame
  // and keeps the draft/state untouched. No business/API/AI contract changes.
  useEffect(() => {
    const frame = document.getElementById("dna-frame");
    if (!frame) return;
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        type?: string;
        theme?: { preset?: string };
        vars?: Record<string, string>;
        mode?: "light" | "dark" | "auto";
      } | null;
      if (!data || data.type !== "dna-workspace-theme") return;
      if (data.vars && typeof data.vars === "object") {
        // The frame's existing structure reads --paper/--ink/--line/--soft; map the
        // shell tokens onto those same variables so every existing element follows
        // the theme without restyling the component or duplicating tokens.
        const aliases: Record<string, string> = {
          "--qai-bg": "--paper",
          "--qai-ink": "--ink",
          "--qai-line": "--line",
          "--qai-soft": "--soft",
        };
        for (const [name, value] of Object.entries(data.vars)) {
          if (!name.startsWith("--") || typeof value !== "string") continue;
          frame.style.setProperty(name, value);
          if (aliases[name]) frame.style.setProperty(aliases[name], value);
        }
      }
      // Auto resolves to Dark Glass when the OS is dark. The shell sends the
      // already-resolved mode, so no second OS detector is created here.
      const resolvedMode =
        data.mode === "dark" || data.mode === "light"
          ? data.mode
          : data.theme?.preset === "dark"
            ? "dark"
            : "light";
      frame.dataset.wsTheme = resolvedMode;
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  // reference: Escape ปิด drawer
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawer(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ข้อความเปิดแชต (ยุบมาจากหน้าเลขาเดิม): pulse + LINE drafts — โชว์เฉพาะ
  // ตอนมีของค้างจริง เงียบเมื่อไม่มี = blank "วันนี้จะทำอะไร?" ตาม reference คงเดิม
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [pulseRes, draftsRes] = await Promise.all([
          fetch("/api/admin/pulse"),
          fetch("/api/admin/outbound-drafts").catch(() => null),
        ]);
        if (!pulseRes.ok) return;
        const pulse = await pulseRes.json().catch(() => null);
        let pendingDrafts = 0;
        if (draftsRes?.ok) {
          const d = await draftsRes.json().catch(() => null);
          pendingDrafts = ((d?.drafts ?? []) as { status: string }[]).filter((x) => x.status === "pending_review").length;
        }
        const lines: string[] = [];
        if (Array.isArray(pulse?.pendingDocs) && pulse.pendingDocs.length > 0)
          lines.push(`เอกสารรอยืนยัน ${pulse.pendingDocs.length} ใบ`);
        if (Array.isArray(pulse?.activeJobs) && pulse.activeJobs.length > 0)
          lines.push(`งานที่กำลังเดิน ${pulse.activeJobs.length} งาน`);
        if (pendingDrafts > 0) lines.push(`ข้อความ LINE รอเฮียอนุมัติก่อนส่งลูกค้า ${pendingDrafts} รายการ`);
        if (!alive || lines.length === 0) return;
        const text = `วันนี้เฮียมี:\n${lines.map((l) => `• ${l}`).join("\n")}`;
        pushMsg("ai", text, { result: { type: "text", text } });
      } catch {
        // เงียบ — ไม่บังคับข้อมูลเปิดแชต
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live push จาก LINE (ยุบมาจากเลขาเดิม): คำสั่งที่พิมพ์ใน LINE วิ่ง pipeline
  // เดียวกัน (app/api/internal/line/command) แล้ว insert live_commands — จอนี้ react
  // เหมือนพิมพ์เอง (ตอบ/พูด/พาไปหน้า)
  useEffect(() => {
    const supabase = createBrowserSupabase();
    const channel = supabase
      .channel("live_commands_frame")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "live_commands" },
        (payload) => {
          const row = payload.new as {
            reply_text: string | null;
            navigate_url: string | null;
            workspace: { sections?: ResultSectionLike[] } | null;
          };
          const blocks = row.workspace?.sections?.length ? sectionsToBlocks(row.workspace.sections) : [];
          pushMsg(
            "ai",
            row.reply_text ?? "รับคำสั่งจาก LINE แล้วครับ",
            blocks.length ? { result: { type: "sections", blocks } } : undefined,
          );
          if (row.navigate_url) {
            setTimeout(() => {
              if (!openWorkspaceRouteInShell(row.navigate_url as string)) router.push(row.navigate_url as string);
            }, 600);
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (kind: "apps" | "actions") => setDrawer((p) => (p === kind ? null : kind));
  const go = (item: FrameItem) => {
    if (item.disabledNote) return;
    if (item.external) {
      setDrawer(null);
      void openExternal(item.external);
      return;
    }
    if (!item.route) return;
    setDrawer(null);
    if (selfRoute && item.route === selfRoute) return;
    // เปิดในพื้นที่กลางของ shell เดิม (ถ้าถูกฝัง) — ไม่ navigate ตัวหน้าแชต ⇒ Composer/ข้อความคงอยู่
    if (!openWorkspaceRouteInShell(item.route, item.label)) router.push(item.route);
  };

  // textarea → /api/chat จริง (route เดิม = runCognitivePipeline · เดียวกับที่
  // relationships runCommand เรียก). sessionKey คงที่ของ shell ตัวนี้เพื่อให้
  // memory แยกจาก relationship อื่น (อุบัติการณ์ singleton 2026-07-31 ที่
  // cognitive/memory/session.ts) · ไม่มี knownCustomerId — shell ไม่รู้ลูกค้า
  const sendDraft = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    // ยังไม่เลือกองค์กร: พิมพ์ได้ปกติ (ไม่ disabled) แต่ยังไม่ยิง /api/chat —
    // บอกเหตุผลด้วยข้อความจริงในแชท + เก็บ draft ค้างไว้ ไม่ให้ข้อความหาย
    if (!orgContext) {
      pushMsg("system", "ยังไม่ได้เลือกองค์กร — เลือกองค์กรจากมุมขวาบนก่อน แล้วส่งคำสั่งเดิมซ้ำได้ (ข้อความที่พิมพ์ยังคงอยู่)");
      return;
    }
    setDraft("");
    // ส่งแล้วกลับสู่กล่องกะทัดรัด (autoGrow ทำงานตาม draft ที่ว่าง)
    setToolOpen(false);
    setSelectedTool(null);
    setToolNote(null);
    setSending(true);
    pushMsg("user", text);
    // (E) มี entity + ช่องทาง LINE → communication action ใช้ LINE/send API เดิม
    // (POST …/reply body {text} — สัญญาเดียวกับ sendReply ของ relationships ทุกตัวอักษร)
    if (composerContext?.lineUserId && composerContext.relationshipId) {
      try {
        const res = await fetch(`/api/admin/line-customers/${composerContext.lineUserId}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const d = await res.json().catch(() => null);
        if (res.ok) {
          pushMsg("system", "ส่งข้อความแล้ว");
          onComposerSent?.();
        } else {
          pushMsg("system", (d && typeof d.error === "string" && d.error) || "ส่งไม่สำเร็จ");
        }
      } catch {
        pushMsg("system", "เชื่อมต่อไม่สำเร็จ");
      } finally {
        setSending(false);
      }
      return;
    }
    try {
      // ไม่มี entity (คำสั่ง DNA OS) หรือ entity ไม่มีช่องทาง LINE (คำสั่ง/ถามกับ
      // context ของ entity) → /api/chat เดิม
      const body: Record<string, unknown> = {
        message: text,
        sessionKey: composerContext?.sessionKey || "workspace-shell",
      };
      if (composerContext?.knownCustomerId) body.knownCustomerId = composerContext.knownCustomerId;
      if (composerContext?.knownCustomerName) body.knownCustomerName = composerContext.knownCustomerName;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        // ── client-only side effects (thin executor — central dispatcher ใน
        //    cognitive/pipeline ตัดสินใจเองว่าคำสั่งไหนใช้แบบไหน · ยุบมาจาก
        //    เลขาส่วนตัวเดิมตัวเดียว ไม่มี matcher ซ้ำในหน้าจอ) ──
        if (data.back) {
          pushMsg("ai", String(data.text ?? "ย้อนกลับให้แล้วครับ"));
          router.back();
          return;
        }
        if (data.window_action) {
          await performWindowAction(data.window_action as "minimize" | "maximize" | "close");
          pushMsg("ai", String(data.text ?? "รับทราบครับ"));
          return;
        }
        if (data.external_url) {
          window.open(String(data.external_url), "_blank");
          pushMsg("ai", String(data.text ?? "เปิดให้แล้วครับ"));
          return;
        }
        if (data.screen_vision) {
          pushMsg("ai", String(data.text ?? "กำลังอ่านหน้าจอให้ครับ..."));
          const vision = await performScreenVision(
            typeof data.screen_vision_goal === "string" ? data.screen_vision_goal : undefined,
          );
          pushMsg("ai", vision);
          return;
        }
        if (data.open_app) {
          pushMsg("ai", await performOpenApp(String(data.open_app)));
          return;
        }
        if (data.line_copilot) {
          pushMsg("ai", String(data.text ?? "กำลังเปิด LINE และอ่านแชทให้ครับ..."));
          const copilot = await performLineCopilot();
          if (copilot) {
            const blocks = copilot.sections?.length ? sectionsToBlocks(copilot.sections) : [];
            pushMsg("ai", copilot.text, {
              ...(copilot.confirmToken
                ? { confirm: { action: copilot.confirmAction ?? "", token: copilot.confirmToken } }
                : {}),
              ...(blocks.length ? { result: { type: "sections", blocks } as ChatResult } : {}),
            });
          }
          return;
        }

        const result: ChatResult | undefined = data.result;
        const structured = !!result && !["text", "confirmation", "sections"].includes(result.type);
        const text = structured
          ? ""
          : typeof data.text === "string" && data.text
            ? data.text
            : result && result.type === "text"
              ? result.text
              : JSON.stringify(data);
        pushMsg("ai", text, {
          ...(result ? { result } : {}),
          ...(data.confirm_token
            ? { confirm: { action: String(data.confirm_action ?? ""), token: String(data.confirm_token) } }
            : {}),
          ...(data.doc_html ? { docHtml: String(data.doc_html) } : {}),
          ...(data.flex_preview ? { flexPreview: data.flex_preview } : {}),
        });
        // เสียงอ่านข้อความ: ไม่พูดอัตโนมัติ — ผู้ใช้กดไอคอนลำโพงใต้ข้อความตอบกลับนั้นเอง
        // navigate_url = contract ของ pipeline ที่ตอบ "เปิดหน้าให้แล้วครับ"
        // — route ที่ server รู้จักเท่านั้น (ตัวเดียวกับ navigation intercept)
        if (data.navigate_url) {
          const route = String(data.navigate_url);
          if (!openWorkspaceRouteInShell(route)) router.push(route);
        }
      } else {
        const message = `ส่งคำสั่งไม่สำเร็จ: ${data?.error ?? data?.text ?? `HTTP ${res.status}`}`;
        pushMsg("system", message, { result: { type: "error", message } });
      }
    } catch {
      const message = "ติดต่อ /api/chat ไม่สำเร็จ ลองใหม่อีกครั้งครับ";
      pushMsg("system", message, { result: { type: "error", message } });
    } finally {
      setSending(false);
    }
  };

  // แนบไฟล์ → /api/admin/upload จริง (route เดิม = bucket attachments · ไม่ส่ง
  // documentId → ลงโฟลเดอร์ unfiled — หน้าจอเดียวกับที่ relationships เรียก)
  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || uploading) return;
    for (const file of Array.from(files)) {
      pushMsg("user", `📎 แนบไฟล์ ${file.name}`);
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        // มี entity → ลงโฟลเดอร์ของ entity (documentId เดิมของ route upload) · ไม่มี → unfiled
        if (composerContext?.documentId) formData.append("documentId", composerContext.documentId);
        const res = await fetch("/api/admin/upload", { method: "POST", body: formData });
        const data = await res.json().catch(() => null);
        if (res.ok && data && data.path) {
          // FILE/IMAGE RESULT (spec §5) — ชนิดไฟล์จริงจาก upload response
          const isImage = String(data.type ?? "").startsWith("image/");
          pushMsg("ai", `📎 อัปโหลด ${data.name} แล้ว`, {
            result: {
              type: isImage ? "image" : "file",
              name: String(data.name ?? file.name),
              path: String(data.path),
              mime: String(data.type ?? ""),
              size: Number(data.size ?? file.size),
            },
          });
        } else {
          const message = `แนบไฟล์ไม่สำเร็จ: ${data?.error ?? `HTTP ${res.status}`}`;
          pushMsg("system", message, { result: { type: "error", message } });
        }
      } catch {
        const message = "แนบไฟล์ไม่สำเร็จ ลองใหม่อีกครั้งครับ";
        pushMsg("system", message, { result: { type: "error", message } });
      } finally {
        setUploading(false);
      }
    }
    if (fileRef.current) fileRef.current.value = "";
    setSelectedTool(null);
  };

  /** เลือกเครื่องมือจากเมนู (+) → เปิด file picker เดิมด้วย accept ของชนิดนั้น */
  const chooseComposerTool = (tool: (typeof COMPOSER_TOOLS)[number]) => {
    setToolOpen(false);
    setSelectedTool(tool.id);
    setToolNote(null);
    const input = fileRef.current;
    if (!input) return;
    input.value = "";
    input.accept = tool.accept;
    input.click();
  };

  /** ไมค์: ยังไม่มีระบบรับเสียงจริง → แสดงสถานะไม่พร้อมใช้งาน (ไม่เปิดอุปกรณ์/ไม่สร้าง engine) */
  const announceVoiceStatus = () => {
    if (voiceReady) return;
    setToolOpen(false);
    setSelectedTool(null);
    setToolNote("ไมโครโฟนยังไม่พร้อมใช้งาน — ยังไม่มีระบบรับเสียงใน DNA OS");
  };

  // §09 — เลื่อนตามข้อความใหม่ก็ต่อเมื่อผู้ใช้อยู่ท้ายรายการ (ไม่แย่งตอนย้อนอ่าน)
  useEffect(() => {
    if (!stickToBottom.current) return;
    const el = timelineRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending, uploading]);

  // pattern เดิมจาก relationships (openHtmlDocument) — เปิด doc_html จริง
  // จาก cognitive/executor ในแท็บใหม่ด้วย blob URL (revoke ตอนโหลดเสร็จ)
  // openHtmlDocument = module scope ด้านล่าง (pure — เปิด blob แท็บใหม่)

  // เส้น "ยืนยันงาน/เอกสาร" → POST /api/chat/confirm (route เดิม: Rule-72
  // preview_token → dispatchAction mode=execute → ผล {ok,error,line_send_error})
  const confirmMsg = async (id: number, action: string, token: string) => {
    setMessages((m) => m.map((x) => (x.id === id && x.confirm ? { ...x, confirm: { ...x.confirm, busy: true } } : x)));
    try {
      const res = await fetch("/api/chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, preview_token: token }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        pushMsg("system", data.line_send_error ? `ยืนยันแล้ว แต่ส่ง LINE ไม่สำเร็จ: ${data.line_send_error}` : "✅ ยืนยันสำเร็จ");
      } else {
        pushMsg("system", `ยืนยันไม่สำเร็จ: ${data?.error ?? data?.line_send_error ?? `HTTP ${res.status}`}`);
      }
    } catch {
      pushMsg("system", "เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้งครับ");
    } finally {
      setMessages((m) => m.map((x) => (x.id === id ? { ...x, confirm: undefined } : x)));
    }
  };

  // §02 — หนึ่งคำถาม = หนึ่ง q-entry · คำตอบ/เหตุการณ์จริงใต้ Q เดิม (ไม่มีข้อมูลปลอม)
  const qEntries = groupMessages(messages);

  return (
    <div id="dna-frame" aria-label="โครงหน้าจอ DNA OS">
      <style>{FRAME_CSS}</style>

      {/* ONE SURFACE (B): permanent header "DNA OS · พื้นที่ทำงาน" + note ถูกถอด —
          หน้าเริ่มต้น = canvas โล่งตาม Owner reference · ปุ่มควบคุมทั้งหมดอยู่ที่ขอบจอ */}

      {/* ONE SURFACE: ปุ่มประวัติด้านบน (ตำแหน่งเดิม) = เปิดแผงรายการหัวข้อสนทนา + ลำดับเหตุการณ์
          ที่มีข้อมูลรองรับจริง — บทสนทนาของเซสชันนี้ (state เดิม) หรือ messagePanel ที่หน้าอื่นส่งมา

          NAVIGATION CLEANUP (owner 2026-10-18): ใน Workspace (embedded) ไม่มีปุ่มรูปข้อความมุมขวา
          ของพื้นที่กลางอีก — Workspace ใช้กล่อง AI ด้านล่างชุดเดิมเท่านั้น
          หน้าจออื่นที่ใช้ frame นี้ (เช่น /admin/relationships ที่ส่ง messagePanel มาเอง) ยังมีปุ่มเดิมครบ */}
      {!embedded && (
        <button
          className="corner"
          data-testid="history-button"
          onClick={() => {
            setDrawer(null);
            setPanelOpen(!panelIsOpen);
          }}
          aria-expanded={panelIsOpen}
          aria-label="เปิดประวัติการสื่อสาร"
        >
          <MessageSquare />
        </button>
      )}
      {!embedded && (
        <button className="gear" onClick={() => router.push("/admin/settings")} aria-label="Settings">
          <Settings />
        </button>
      )}

      {/* แผง "ประวัติการสื่อสาร" — รูปแบบตาม reference .inbox: เปิดทับ canvas (stage ซ่อน) */}
      {panelIsOpen && (
        <aside className="msg-panel" aria-label="ประวัติการสื่อสาร">
          <div className="row">
            <strong>ประวัติการสื่อสาร</strong>
            <button type="button" onClick={() => setPanelOpen(false)} aria-label="ปิดแผง">
              <X />
            </button>
          </div>
          <div className="panel-body">
            {messagePanel ?? (
              <div data-testid="history-panel">
                <strong>หัวข้อสนทนาและลำดับเหตุการณ์</strong>
                {qEntries.length === 0 ? (
                  <p className="note" data-testid="history-empty">
                    ยังไม่มีหัวข้อสนทนาในเซสชันนี้ — ระบบไม่สร้างข้อมูลจำลอง และไม่บันทึกเป็น business
                    event เพราะยังไม่มีเหตุการณ์ธุรกิจเกิดขึ้น
                  </p>
                ) : (
                  <ol className="history-list">
                    {qEntries.map((entry, idx) => (
                      <li key={entry.key}>
                        <strong>
                          {idx + 1}. {entry.question ?? "(เหตุการณ์)"}
                        </strong>
                        {entry.events.length > 0 && (
                          <ul className="history-events">
                            {entry.events.map((m) => (
                              <li key={m.id}>{m.text}</li>
                            ))}
                          </ul>
                        )}
                        {entry.answers.length > 0 && (
                          <ul className="history-events">
                            {entry.answers.map((m) => (
                              <li key={m.id}>{m.text}</li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </div>
        </aside>
      )}

      {!panelIsOpen && (
      <section className={children ? "stage stage--bleed" : "stage"} data-screen="work">
        {!embedded && (
          <button className="edge left" data-drawer="apps" aria-expanded={drawer === "apps"} onClick={() => toggle("apps")} aria-label="เปิดกล่องเครื่องมือ">
            <Grid2X2 />
          </button>
        )}
        {/* ปุ่มจุดสามจุด (⋯) ของพื้นที่กลางย้ายขึ้น Tab Bar ของ shell แล้ว (owner 2026-10-18)
            — ใน embedded ไม่มีปุ่มซ้ำ · หน้าจออื่นที่ใช้ frame นี้ยังคงปุ่มคำสั่งเดิม */}
        {!embedded && (
          <button className="edge right" data-drawer="actions" aria-expanded={drawer === "actions"} onClick={() => toggle("actions")} aria-label="เปิดคำสั่งของรายการ">
            <Ellipsis />
          </button>
        )}

        {drawer && (
          <aside className="drawer">
            <div className="row">
              <strong>{drawer === "apps" ? "เครื่องมือ" : "คำสั่ง"}</strong>
              <button style={{ marginLeft: "auto" }} onClick={() => setDrawer(null)} aria-label="ปิด">
                <X />
              </button>
            </div>
            {!orgContext && (
              <p className="note" data-testid="org-required-note">
                เลือกองค์กรก่อน — รายการเครื่องมือผูกกับองค์กรที่กำลังทำงาน
              </p>
            )}
            {orgContext && (
            <div className="tools">
              {(drawer === "apps" ? APPS : ACTIONS).map((item) => (
                <button
                  key={item.label}
                  type="button"
                  aria-disabled={!!item.disabledNote}
                  title={item.disabledNote ?? item.route ?? item.external}
                  onClick={() => go(item)}
                >
                  <item.icon /> {item.label}
                  {(itemBadges?.[item.label] ?? 0) > 0 && (
                    <span className="count">{itemBadges![item.label]}</span>
                  )}
                </button>
              ))}
            </div>
            )}
            {drawer === "actions" && (
              <p className="note" style={{ marginTop: 10 }}>
                ปุ่มที่disabled = ยังไม่มี backend จริง — ไม่เปิดใช้เพื่อไม่ให้เข้าใจผิด
              </p>
            )}
          </aside>
        )}

        <div className={children ? "content content--fill" : "content"} aria-live="polite">
          {qEntries.length > 0 && (
            <section
              className="q-timeline workspace-content-column"
              ref={timelineRef}
              onScroll={onTimelineScroll}
            >
              {qEntries.map((entry, entryIdx, list) => {
                const isLast = entryIdx === list.length - 1;
                return (
                  <article className="q-entry" key={entry.key}>
                    {entry.question != null && (
                      <header className="q-heading">
                        <span className="q-label">Q</span>
                        <div className="q-question">{entry.question}</div>
                      </header>
                    )}
                    <div className="q-content">
                      {(entry.events.length > 0 || (isLast && (sending || uploading))) && (
                        <div className="q-events">
                          {entry.events.map((m) => (
                            <div key={m.id}>{m.text}</div>
                          ))}
                          {/* สถานะจริงระหว่าง request ยังเดิน — ไม่จำลองข้อความ "กำลังคิด" */}
                          {isLast && uploading && <div>กำลังอัปโหลดไฟล์...</div>}
                          {isLast && sending && <div>DNA OS กำลังประมวลผล...</div>}
                        </div>
                      )}
                      {entry.answers.length > 0 && (
                        <div className="q-answer">
                          {entry.answers.map((m) => (
                            <div key={m.id}>
                              {m.result ? (
                                <ChatResultView result={m.result} fallbackText={m.text} />
                              ) : m.text ? (
                                <RichText text={m.text} />
                              ) : null}
                              {!m.result && m.docHtml && (
                                <div className="msg-actions">
                                  <button type="button" onClick={() => openHtmlDocument(m.docHtml!)}>
                                    เปิดเอกสาร (HTML เต็ม)
                                  </button>
                                </div>
                              )}
                              {/* ลำโพงอ่านข้อความ — ไอคอนเล็กใต้ข้อความตอบกลับ · ใช้ speak() เดิม
                                  · ไม่อ่านอัตโนมัติ (พูดเมื่อกดเท่านั้น) · ไม่เปิดไมโครโฟน */}
                              {m.text ? (
                                <div className="row msg-actions reply-tts">
                                  <button
                                    type="button"
                                    data-testid="reply-tts"
                                    aria-label="อ่านข้อความตอบกลับนี้"
                                    title="อ่านข้อความนี้"
                                    onClick={() => speak(m.text)}
                                  >
                                    <Volume2 />
                                  </button>
                                </div>
                              ) : null}
                              {m.flexPreview != null && (
                                <div className="msg-attachment">
                                  <FlexPreview flex={m.flexPreview} />
                                </div>
                              )}
                              {m.confirm && (
                                <div className="row msg-actions">
                                  <button
                                    type="button"
                                    disabled={m.confirm.busy}
                                    onClick={() => void confirmMsg(m.id, m.confirm!.action, m.confirm!.token)}
                                  >
                                    {m.confirm.busy ? "กำลังยืนยัน..." : "ยืนยัน"}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={m.confirm.busy}
                                    onClick={() =>
                                      setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, confirm: undefined } : x)))
                                    }
                                  >
                                    ยกเลิก
                                  </button>
                                  <span className="note">รอการยืนยัน (preview token ใช้ได้ครั้งเดียว)</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </section>
          )}
          {children ? (
            <div className="canvas">{children}</div>
          ) : messages.length === 0 ? (
            <div className="blank">
              วันนี้จะทำอะไร?
              <div className="note">พิมพ์คำสั่ง แนบไฟล์ หรือเปิดเครื่องมือด้านข้าง</div>
            </div>
          ) : null}
        </div>

        {/* ONE COMPOSER — ตำแหน่งเดิมด้านล่างเสมอ ทั้งตอนไม่มี entity และมี entity */}
        <form
          className="compose workspace-content-column"
          data-active-screen={activeScreen?.route ?? "/workspace"}
          onClick={focusComposer}
          onSubmit={(e) => {
            e.preventDefault();
            void sendDraft();
          }}
        >
          {/* แท็บที่เปิดอยู่ (จาก shell) — กล่องนี้คือกล่องกลางตัวเดียวที่ใช้ร่วมทุกแท็บ
              แสดงเป็นแถวบางเหนือช่องพิมพ์ และซ่อนใน compact ของ shell (ไม่กินพื้นที่) */}
          {activeScreen && activeScreen.kind !== "chat" && (
            <div className="compose-context-row">
              <span
                className="compose-context"
                data-testid="compose-context"
                title={`แท็บที่กำลังเปิดอยู่: ${activeScreen.label}${activeScreen.route ? ` (${activeScreen.route})` : ""}`}
              >
                บริบท: <strong>{activeScreen.label}</strong>
              </span>
            </div>
          )}
          {/* (+) เมนูเครื่องมือ QAI — เฉพาะเครื่องมือที่ระบบมีจริง · เปิด/ปิดด้วย (+) · × · Esc · คลิกนอก */}
          <div className="compose-tray" hidden={!toolOpen && !selectedTool && !toolNote}>
            <div className="compose-menu" id="compose-tool-menu" role="menu" aria-label="เครื่องมือ QAI" hidden={!toolOpen}>
              {COMPOSER_TOOLS.map((tool) => (
                <button key={tool.id} type="button" role="menuitem" onClick={() => chooseComposerTool(tool)}>
                  <tool.icon /> {tool.label}
                </button>
              ))}
              <button
                type="button"
                className="compose-menu-close"
                aria-label="ปิดเมนูเครื่องมือ"
                title="ปิดเมนู"
                onClick={() => setToolOpen(false)}
              >
                ×
              </button>
            </div>
            {!toolOpen && selectedToolInfo && (
              <span className="compose-chip" data-testid="compose-selected-tool">
                {selectedToolInfo.label}
                <button
                  type="button"
                  aria-label="ยกเลิกเครื่องมือที่เลือก"
                  title="ยกเลิก"
                  onClick={() => setSelectedTool(null)}
                >
                  ×
                </button>
              </span>
            )}
            {toolNote && (
              <span className="compose-note" role="status" data-testid="compose-voice-status">
                {toolNote}
                <button type="button" aria-label="ปิดสถานะ" title="ปิด" onClick={() => setToolNote(null)}>
                  ×
                </button>
              </span>
            )}
          </div>
          {/* ซ้าย (+) · กลางช่องพิมพ์ · ขวาไมค์ + ส่ง — ไอคอนเล็กสม่ำเสมอ */}
          <div className="compose-main">
            <button
              type="button"
              data-compose-plus
              aria-label="เปิดเครื่องมือ QAI"
              title="เครื่องมือ QAI"
              aria-haspopup="menu"
              aria-expanded={toolOpen}
              aria-controls="compose-tool-menu"
              onClick={() => setToolOpen((open) => !open)}
              disabled={uploading}
            >
              <Plus />
            </button>
            <textarea
              ref={textareaRef}
              rows={1}
              aria-label="คำสั่ง"
              placeholder={orgContext ? `ถาม ${orgContext.name}...` : "พิมพ์คำสั่งได้ทันที — เลือกองค์กรก่อนจึงจะส่งได้"}
              data-org-context={orgContext ? orgContext.organizationId : ""}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (toolNote) setToolNote(null);
              }}
              onKeyDown={(e) => {
                // พิมพ์ภาษาไทย/IME ปกติทุกตัวอักษร · IME ยังแต่งคำ (isComposing) = ห้ามส่ง
                if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
                if (e.key !== "Enter") return;
                if (e.shiftKey) return; // Shift+Enter = ขึ้นบรรทัดใหม่ตามค่า default ของ textarea
                e.preventDefault(); // Enter = ส่งคำสั่ง (ไม่เพิ่มบรรทัดค้างในช่อง)
                void sendDraft();
              }}
              disabled={sending}
            />
            <button
              type="button"
              className="compose-mic"
              data-testid="compose-mic"
              aria-label={voiceReady ? "สั่งงานด้วยเสียง" : "สั่งงานด้วยเสียง — ยังไม่พร้อมใช้งาน"}
              title={voiceReady ? "สั่งงานด้วยเสียง" : "ยังไม่มีระบบรับเสียงที่ใช้งานได้ในระบบนี้"}
              aria-disabled={!voiceReady}
              onClick={announceVoiceStatus}
            >
              <Mic />
            </button>
            <button className="compose-send" type="submit" aria-label="ส่งคำสั่ง" disabled={sending}>
              <ArrowUp />
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            hidden
            multiple
            onChange={(e) => {
              void uploadFiles(e.target.files);
            }}
          />
        </form>
      </section>
      )}
    </div>
  );
}

// ── BUSINESS RESULT RENDERING (owner spec 2026-09-25) ───────────────────────
// render ตามชนิดข้อมูลจริง — ใช้ renderer ของระบบเดิม (§8): BusinessDisplayRenderer
// (→ DataTable สำหรับ table/finance · Viewer kind=document สำหรับเอกสาร) ·
// RichText (wrap/ย่อหน้า/list/markdown table) · PartnerTimelineList (timeline
// สกัดจากหน้าคู่ค้า ONE implementation) · Viewer kind=image (รูป)

// ── CLIENT-ONLY SIDE EFFECTS (thin executor — ยุบมาจาก components/admin/
//    SecretaryChat.tsx ที่ถูกตัดออกตามคำสั่ง Owner2026-09-25 "ยุบความสามารถ
//    ทั้งหมดมาไว้ที่แชตบอร์ดหลักตัวเดียว") — central dispatcher
//    (cognitive/pipeline classifyClientCommand) เป็นคนสั่งว่าใช้อันไหน
//    หน้านี้แค่ execute ไม่มี matcher ซ้ำ

/**
 * เปิดเส้นทาง (เครื่องมือ/หน้าจอธุรกิจ) ใน "พื้นที่กลางเดิม" ของ shell ที่ฝังหน้านี้อยู่
 * (shell มี #toolFrame + openToolRoute อยู่แล้ว) ⇒ หน้าแชตไม่ถูก navigate ทิ้ง
 * ข้อความที่พิมพ์ค้างและ Composer ตัวเดิมจึงคงอยู่ (owner 2026-10-18 ข้อ 8)
 * ถ้าไม่ได้ถูกฝัง (หน้าแชตเต็มจอ) → คืน false ให้ผู้เรียกใช้ router.push ตามเดิม
 */
function openWorkspaceRouteInShell(route: string, label?: string): boolean {
  if (typeof window === "undefined" || window.parent === window) return false;
  try {
    window.parent.postMessage({ type: "dna-workspace-open-route", route, label }, window.location.origin);
    return true;
  } catch {
    return false;
  }
}

/**
 * แจ้ง shell ที่ฝังหน้านี้อยู่ (public/material-workspace) ว่ากล่องพิมพ์กำลังถูกใช้งาน
 * → shell คงความชัด/ขยายกล่องลอยเท่าที่จำเป็นต่อการพิมพ์ (owner 2026-10-18 ข้อ 5–6)
 * ใช้ postMessage กลไกเดิมของ workspace (same-origin เท่านั้น) · ไม่มี state/ที่จัดเก็บใหม่
 */
function postComposerActive(active: boolean) {
  if (typeof window === "undefined" || window.parent === window) return;
  try {
    window.parent.postMessage({ type: "dna-chat-composer-active", active }, window.location.origin);
  } catch {
    // เข้าถึง parent ไม่ได้ = หน้านี้ไม่ได้ถูกฝัง — ไม่มีอะไรต้องทำ
  }
}

async function performWindowAction(action: "minimize" | "maximize" | "close") {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    if (action === "minimize") await win.minimize();
    else if (action === "maximize") {
      const isMax = await win.isMaximized();
      if (isMax) await win.unmaximize();
      else await win.maximize();
    } else if (action === "close") await win.close();
  } catch {
    // honest failure — ไม่ได้รันเป็นแอป Tauri จริง
  }
}

async function performOpenApp(appName: string): Promise<string> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return "เปิดแอปได้เฉพาะตอนรันเป็นแอปเดสก์ท็อปเท่านั้นครับ";
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("open_app", { appName });
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

async function performScreenVision(goal?: string): Promise<string> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return "อ่านหน้าจอได้เฉพาะตอนรันเป็นแอปเดสก์ท็อปเท่านั้นครับ";
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("capture_screen");
    const res = await fetch("/api/admin/screen-vision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal }),
    });
    const data = await res.json();
    return data.text ?? data.error ?? "อ่านหน้าจอไม่สำเร็จครับ";
  } catch (err) {
    return `ถ่ายภาพหน้าจอไม่สำเร็จครับ (${err instanceof Error ? err.message : String(err)}) — เช็คว่าให้สิทธิ์ Screen Recording กับแอปนี้แล้วหรือยัง (System Settings → Privacy & Security → Screen Recording)`;
  }
}

// Chain Action / "line.copilot" — open_app (LINE) → screen vision (OCR อ่านแชท)
// → feed กลับ /api/chat pipeline ตัวเดียวกัน (read-only ทั้ง链 · confirm จริงยัง
// ต้องกดยืนยันเอง)
async function performLineCopilot(): Promise<{
  text: string;
  sections?: ResultSectionLike[];
  confirmToken?: string;
  confirmAction?: string;
} | null> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return { text: "อ่านแชท LINE ให้ได้เฉพาะตอนรันเป็นแอปเดสก์ท็อปเท่านั้นครับ" };
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const openResult = await invoke<string>("open_app", { appName: "LINE" });
    if (/ไม่พบแอปพลิเคชัน/.test(openResult)) return { text: openResult };
    await new Promise((r) => setTimeout(r, 1800)); // delay เปิด LINE จริง
    await invoke("capture_screen");
    const visionRes = await fetch("/api/admin/screen-vision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        goal: "หาชื่อผู้ติดต่อที่กำลังคุยด้วย และสิ่งที่เขาขอราคาหรือขอสั่งซื้อจากข้อความล่าสุดในแชทนี้ ตอบสั้นๆ เฉพาะชื่อคนและสิ่งที่ขอเท่านั้น",
      }),
    });
    const visionData = await visionRes.json();
    const ocrText: string | undefined = visionData.text;
    if (!ocrText) return { text: visionData.error ?? "อ่านแชท LINE ไม่ได้ผลลัพธ์ครับ" };

    const chatRes = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: ocrText }),
    });
    const chatData = await chatRes.json();
    return {
      text: `อ่านแชทได้ว่า: "${ocrText}"\n\n${chatData.text ?? "รับทราบครับ"}`,
      sections: chatData.workspace?.sections,
      confirmToken: chatData.confirm_token,
      confirmAction: chatData.confirm_action,
    };
  } catch (err) {
    return { text: `เปิดอ่านแชท LINE ไม่สำเร็จครับ (${err instanceof Error ? err.message : String(err)})` };
  }
}

function openHtmlDocument(html: string) {
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (!win) {
    URL.revokeObjectURL(url);
    return;
  }
  win.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
}

/** พิมพ์/PDF จาก html ต้นฉบับตัวเดียวกัน (browser print — ไม่มี PDF engine ใหม่) */
function printHtml(html: string) {
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (!win) {
    URL.revokeObjectURL(url);
    return;
  }
  win.addEventListener(
    "load",
    () => {
      win.focus();
      win.print();
      URL.revokeObjectURL(url);
    },
    { once: true },
  );
}

/**
 * WORKSPACE DISPLAY STANDARD V1 §02 — หนึ่งคำถาม = หนึ่ง q-entry · คำตอบและ
 * เหตุการณ์จริง (system push/status) อยู่ใต้ Q เดียวกัน · ไม่มีการสร้างข้อมูลปลอม
 * — จัดกลุ่มอย่างเดียว ไม่เปลี่ยน state/message id/session ใด ๆ ของระบบเดิม
 */
function groupMessages<T extends { id: number; role: "user" | "ai" | "system"; text: string }>(
  messages: T[],
): { key: number; question: string | null; events: T[]; answers: T[] }[] {
  const hasResult = (m: T) =>
    "result" in m && Boolean((m as { result?: unknown }).result);
  const entries: { key: number; question: string | null; events: T[]; answers: T[] }[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      entries.push({ key: m.id, question: m.text, events: [], answers: [] });
      continue;
    }
    // ข้อความที่ไม่ใช่คำถาม (LINE push / ระบบ) — ถ้ามาก่อนคำถามแรก = entry ของเหตุการณ์จริงเอง
    let current = entries[entries.length - 1];
    if (!current || current.question == null) {
      if (!current) {
        current = { key: m.id, question: null, events: [], answers: [] };
        entries.push(current);
      }
    }
    if (m.role === "ai" || hasResult(m)) current.answers.push(m);
    else current.events.push(m);
  }
  return entries;
}

function DocumentResultView({ title, html }: { title: string; html: string }) {
  const model: BusinessDisplayModel = {
    id: "chat-document",
    title,
    domain: "เอกสาร",
    blocks: [{ kind: "document", id: "doc", title, html }],
  };
  return (
    <div className="result-block document-result">
      <BusinessDisplayRenderer model={model} />
      <div className="msg-actions">
        <button type="button" onClick={() => openHtmlDocument(html)}>
          เปิดเต็ม
        </button>
        <button type="button" onClick={() => printHtml(html)}>
          พิมพ์ / PDF
        </button>
      </div>
    </div>
  );
}

function AttachmentResult({ result }: { result: Extract<ChatResult, { type: "file" | "image" }> }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/upload?path=${encodeURIComponent(result.path)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.url) setUrl(String(d.url));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [result.path]);

  const kb = Math.max(1, Math.round(result.size / 1024));
  if (result.type === "image") {
    return (
      <div className="result-block">
        <div className="result-title">🖼 {result.name}</div>
        {url ? (
          <Viewer kind="image" src={url} alt={result.name} />
        ) : (
          <div className="note">กำลังโหลดรูป...</div>
        )}
      </div>
    );
  }
  return (
    <div className="result-block">
      <div className="attachment-row">
        <span className="attachment-name">
          📄 {result.name} <span className="note">({kb} KB · {result.mime || "ไฟล์"})</span>
        </span>
        {url ? (
          <a className="attachment-link" href={url} target="_blank" rel="noreferrer">
            เปิด / ดาวน์โหลด
          </a>
        ) : (
          <span className="note">กำลังเตรียมลิงก์...</span>
        )}
      </div>
    </div>
  );
}

function ChatResultView({ result, fallbackText }: { result: ChatResult; fallbackText: string }) {
  switch (result.type) {
    case "text":
      return <RichText text={result.text || fallbackText} />;
    case "error":
      // §03 — ข้อความ error เป็นตัวหนังสือบนพื้น Workspace เดิม (ไม่มีกล่อง/ขอบ)
      return (
        <div className="q-error">
          <RichText text={result.message} />
        </div>
      );
    case "table":
      return (
        <div className="result-block">
          <BusinessDisplayRenderer
            model={{
              id: "chat-table",
              title: result.title ?? "ตารางข้อมูล",
              domain: "ตาราง",
              blocks: [
                {
                  kind: "table",
                  id: "t",
                  title: result.title,
                  columns: result.table.columns,
                  rows: result.table.rows,
                },
              ],
            }}
          />
        </div>
      );
    case "finance_summary": {
      // summary = field จาก canonical finance source · rows = canonical rows —
      // BusinessDisplayRenderer = BusinessDisplayRenderer → DataTable ของระบบ (ไม่มี table ใหม่)
      const model: BusinessDisplayModel = {
        id: "chat-finance",
        title: result.title,
        domain: "การเงิน",
        blocks: [
          {
            kind: "fields",
            id: "sum",
            title: "สรุป (canonical finance source)",
            fields: result.summary.map((s) => ({ kind: "field" as const, id: s.id, label: s.label, value: s.value })),
          },
          {
            kind: "table",
            id: "rows",
            title: "เอกสารในเดือนนี้ (แถวจริงจาก canonical)",
            columns: result.table.columns,
            rows: result.table.rows,
          },
        ],
      };
      return (
        <div className="result-block">
          <BusinessDisplayRenderer model={model} />
          {result.notes.length > 0 && (
            <div className="result-notes">
              <RichText text={result.notes.join("\n\n")} />
            </div>
          )}
        </div>
      );
    }
    case "document":
      return <DocumentResultView title={result.title} html={result.html} />;
    case "sections":
      // board workspace.sections (ยุบมาจากเลขาเดิม) — caption + blocks ของระบบ
      return (
        <>
          {fallbackText && <RichText text={fallbackText} />}
          <div className="result-block">
            <BusinessDisplayRenderer
              model={{
                id: "chat-board",
                title: "ผลลัพธ์",
                domain: "คำสั่ง",
                blocks: result.blocks,
              }}
            />
          </div>
        </>
      );
    case "confirmation":
      return (
        <>
          {fallbackText && <RichText text={fallbackText} />}
          {result.html && <DocumentResultView title="ตัวอย่างเอกสาร" html={result.html} />}
        </>
      );
    case "file":
    case "image":
      return <AttachmentResult result={result} />;
    case "timeline":
      return (
        <div className="result-block result-timeline">
          <div className="result-title">{result.title}</div>
          {result.summary && <PartnerSummaryCard summary={result.summary} />}
          <PartnerTimelineList items={result.items} />
        </div>
      );
    default:
      return null;
  }
}

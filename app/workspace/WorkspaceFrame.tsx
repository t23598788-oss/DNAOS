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
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Grid2X2, Ellipsis, MessageSquare, FileText, MessageCircle,
  Wallet, MapPin, Briefcase, Users, ScanLine, Files, FileOutput, Printer,
  Download, Share2, History, Paperclip, ArrowUp, Mic, X,
  FileSignature, Banknote, Mountain,
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

/** apps ตาม reference: ไฟล์·เอกสาร·LINE·การเงิน·GPS·งาน·รายชื่อ·สแกน/AI (+ความสัมพันธ์ ตามคำสั่ง map ของ Owner) */
/** รายการถัดไป = จุดหมาย rail เดิมของ relationships ที่ย้ายมา shell (คงทางเข้าไว้ครบทุกตัว) */
/**
 * OWNER DIRECTIVE 2026-10-15 — BUSINESS USER SURFACE ONLY.
 * เมนูนี้คือหน้าจอ "ผู้ใช้ธุรกิจ" จึงต้องมีแต่เครื่องมือธุรกิจเท่านั้น:
 *  - ตัด `/admin/infrastructure` (Infrastructure) ออก — และห้ามนำหน้านั้นมาใช้เป็น
 *    หน้าค่าบริการของผู้ใช้ (owner directive ข้อ 7); การอ่านข้อมูล infrastructure
 *    ถูกปิดที่ middleware ทุก HTTP method สำหรับ surface นี้อยู่แล้ว
 *  - ตัด external RunPod console (Cloud GPU) ออก — ห้ามเปิด console ของผู้ให้บริการ
 *    ภายนอก (Railway/Vercel/RunPod) จากหน้าจอผู้ใช้ธุรกิจ
 * ทั้งสองรายการยังอยู่ที่เดิมในระบบ (backend ไม่ได้ถูกลบ) — เข้าถึงได้จาก
 * Developer Workspace (/developer) ซึ่งต้องมีสิทธิ์ developer_tier
 */
const APPS: FrameItem[] = [
  { icon: Files, label: "ไฟล์", route: "/admin/storage" },
  { icon: FileText, label: "เอกสาร", route: "/admin/create-document" },
  { icon: MessageCircle, label: "LINE", route: "/admin/line-customers" },
  { icon: Wallet, label: "การเงิน", route: "/admin/finance" },
  { icon: MapPin, label: "เครื่องจักรและซ่อมบำรุง", route: "/admin/equipment" },
  { icon: Briefcase, label: "งาน", route: "/admin/jobs" },
  { icon: Users, label: "รายชื่อ", route: "/admin/partners" },
  { icon: ScanLine, label: "สแกน / AI", route: "/admin/receipts" },
  { icon: MessageSquare, label: "ความสัมพันธ์", route: "/admin/relationships" },
  { icon: FileSignature, label: "รายการเอกสาร", route: "/admin/transactions" },
  { icon: Banknote, label: "ลูกหนี้", route: "/admin/debt-tracking" },
  { icon: Mountain, label: "บ่อวัสดุ", route: "/admin/pits" },
];

/** actions ตาม reference — เหลือแค่ตัวที่มี backend จริง (ประวัติ→event-inbox) ที่เหลือ disabled */
const ACTIONS: FrameItem[] = [
  { icon: History, label: "ประวัติ / หลักฐาน", route: "/admin/event-inbox" },
  { icon: FileOutput, label: "แปลงไฟล์", disabledNote: "ยังไม่มี backend แปลงไฟล์" },
  { icon: Printer, label: "พิมพ์", disabledNote: "ใช้ในหน้าเอกสาร (ปุ่ม พิมพ์ / ส่งออก PDF)" },
  { icon: Download, label: "ดาวน์โหลด", disabledNote: "ยังไม่มี backend ดาวน์โหลดรวม" },
  { icon: Share2, label: "แชร์ / ส่งต่อ", disabledNote: "ยังไม่มี backend แชร์/ส่ง" },
];

/** CSS ยึด tokens + โครงสร้างของ reference (paper/ink/line/soft · edge drawer · stage โล่ง) */
const FRAME_CSS = `
#dna-frame{--paper:#fdfbf8;--ink:#36332f;--line:#e9e1d6;--soft:#f0ebe5;position:relative;background:var(--paper);color:var(--ink);font:14px/1.6 system-ui,sans-serif;border:1px solid var(--line);border-radius:16px;overflow:hidden;height:100dvh;display:flex;flex-direction:column}
#dna-frame *{box-sizing:border-box}
#dna-frame,#dna-frame *{scrollbar-width:none}
#dna-frame::-webkit-scrollbar,#dna-frame *::-webkit-scrollbar{display:none;width:0;height:0}
#dna-frame button,#dna-frame textarea{font:inherit;color:inherit}
#dna-frame button{background:transparent;border:1px solid var(--line);border-radius:9px;padding:8px 12px;min-height:44px;cursor:pointer}
#dna-frame button:hover,#dna-frame button[aria-pressed=true]{background:var(--soft)}
#dna-frame button[aria-disabled=true]{opacity:.45;cursor:not-allowed}
#dna-frame button[aria-disabled=true]:hover{background:transparent}
#dna-frame .corner{position:absolute;z-index:4;right:14px;top:16px;background:var(--paper)}
#dna-frame .gear{position:absolute;left:12px;bottom:16px;z-index:3;background:var(--paper)}
#dna-frame .stage{position:relative;flex:1 1 auto;min-height:0;padding:12px 64px 16px;display:flex;flex-direction:column}
#dna-frame .stage--bleed{padding:76px 12px 12px}
#dna-frame .edge{position:absolute;top:20px;padding:8px;z-index:6}
#dna-frame .edge.left{left:8px}
/* top:82px = ตำแหน่ง reference (sites/workspace-frame) — ตอนนี้ stage เริ่มที่ y=0
   หลังถอด header จึงต้องเว้นมุมขวาบนให้ปุ่ม .corner (ข้อความ) ไม่ซ้อน Ellipsis */
#dna-frame .edge.right{right:8px;top:82px}
#dna-frame .drawer{position:absolute;top:144px;max-height:calc(100dvh - 160px);overflow-y:auto;overscroll-behavior:contain;left:12px;right:12px;z-index:2;background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:16px;box-shadow:0 12px 24px #0002}
#dna-frame .drawer .row,#dna-frame .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#dna-frame .tools{display:grid;grid-template-columns:repeat(auto-fit,minmax(115px,1fr));gap:8px;margin-top:12px}
#dna-frame .tools button{display:flex;align-items:center;gap:8px;justify-content:flex-start;text-align:left}
#dna-frame .canvas{flex:1;min-height:0;min-width:0;display:flex;flex-direction:column}
#dna-frame .msg-panel{position:absolute;top:76px;right:12px;bottom:76px;width:min(420px,calc(100% - 24px));z-index:5;background:var(--paper);border:1px solid var(--line);border-radius:14px;box-shadow:0 12px 24px #0002;display:flex;flex-direction:column;padding:14px;gap:10px;overflow:hidden}
#dna-frame .msg-panel .row strong{margin-right:auto;font-weight:500}
#dna-frame .msg-panel .panel-body{flex:1;min-height:0;overflow:auto}
#dna-frame .content{flex:1;padding:0 0 12px;min-height:0;overflow:hidden;display:flex;flex-direction:column}
#dna-frame .content--fill{padding:0;min-height:0;overflow:hidden}
#dna-frame .content--fill>div{flex:1 1 0%;min-height:0}
#dna-frame .count{background:#c93232;color:#fff;min-width:18px;border-radius:10px;font-size:11px;padding:0 5px;margin-left:auto}
#dna-frame .msg-list{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:14px;overscroll-behavior:contain;padding-bottom:12px;width:min(100%,860px);margin-inline:auto}
#dna-frame .content:not(.content--fill) .msg-list{max-height:none}
#dna-frame .content--fill .msg-list{flex:0 1 auto;max-height:42vh}
#dna-frame button[disabled]{opacity:.5;cursor:not-allowed}
#dna-frame button[disabled]:hover{background:transparent}
#dna-frame .blank{text-align:center;padding:42px 0}
#dna-frame .compose{border:1px solid var(--line);border-radius:16px;padding:8px 10px;margin-top:auto;width:min(100%,860px);margin-inline:auto}
#dna-frame textarea{width:100%;resize:none;height:36px;min-height:36px;max-height:36px;background:transparent;border:0;outline:none}
#dna-frame .compose .compose-tools{display:flex;align-items:center;gap:6px}
#dna-frame .compose button{min-height:32px;width:32px;height:32px;padding:6px;display:inline-flex;align-items:center;justify-content:center}
#dna-frame .compose button svg{width:16px;height:16px}
#dna-frame .compose .voice{margin-left:auto}
#dna-frame .compose .send{margin-left:0}
#dna-frame .stage:not(.stage--bleed) .content{padding-inline:0}
#dna-frame .stage:not(.stage--bleed) .msg-list{padding:0 0 12px}
#dna-frame .stage:not(.stage--bleed) .msg-col{width:100%}
#dna-frame .note{font-size:12px;opacity:.75}
/* BUSINESS RESULT PRESENTATION (spec §1): user ขวา/ตามเนื้อหา · DNA OS ซ้าย/พื้นที่ผลลัพธ์ */
#dna-frame .msg-row{display:flex;flex-direction:column}
#dna-frame .msg-row-user{align-items:flex-end}
#dna-frame .msg-row-dna{align-items:flex-start;width:100%}
#dna-frame .msg-col{display:flex;flex-direction:column;gap:6px;min-width:0;max-width:100%}
#dna-frame .msg-sender{font-size:11px;color:#a8a29e;letter-spacing:.02em}
#dna-frame .bubble-user{background:#36332f;color:#fdfbf8;border-radius:16px 16px 4px 16px;padding:8px 14px;max-width:min(560px,78%);white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.55}
#dna-frame .bubble-dna{background:#fff;border:1px solid var(--line);border-radius:16px 16px 16px 4px;padding:10px 14px;max-width:min(760px,94%)}
#dna-frame .bubble-error{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:14px;padding:10px 14px;max-width:min(760px,94%)}
#dna-frame .result-block{width:100%;max-width:760px;display:flex;flex-direction:column;gap:8px;min-width:0}
#dna-frame .result-title{font-weight:600;font-size:13px}
#dna-frame .result-notes{font-size:12px;color:#78716c}
#dna-frame .msg-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#dna-frame .msg-actions button{min-height:36px;font-size:12px;padding:6px 12px}
#dna-frame .msg-attachment{max-width:min(420px,90%)}
#dna-frame .attachment-row{display:flex;gap:10px;align-items:center;background:#fff;border:1px solid var(--line);border-radius:12px;padding:8px 12px;flex-wrap:wrap}
#dna-frame .attachment-link{font-size:12px;color:#0f766e;text-decoration:underline}
#dna-frame .result-timeline{max-width:820px}
#dna-frame svg{width:18px;height:18px;vertical-align:middle}
@media(max-width:500px){#dna-frame .stage{padding:12px 64px 12px}#dna-frame .blank{padding:24px 0}}
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
    /** current document/entity context for the owner runtime read path
     *  (BATCH 12) — UI context ONLY, never identity. Sent only when the page
     *  actually has a document open; absent = the runtime gets the raw text. */
    documentContext?: {
      document_no?: string | null;
      document_id?: string | null;
      title?: string | null;
    };
  };
  /** หลังส่งสำเร็จ (LINE) — ให้หน้าเจ้าของ canvas refresh timeline ตัวเอง */
  onComposerSent?: () => void;
  /** route ของหน้าปัจจุบัน — item นี้ใน drawer แค่ปิดเมนู ไม่ navigate ซ้ำ */
  selfRoute?: string;
  /** ตัวเลขจริงจากชั้นข้อมูลของหน้า (key = label ของ item ใน drawer) */
  itemBadges?: Record<string, number>;
}) {
  const router = useRouter();
  const [drawer, setDrawer] = useState<null | "apps" | "actions">(null);
  const [draft, setDraft] = useState("");
  const [internalPanel, setInternalPanel] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
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
  // เสียงตอบ (ยุบมาจากเลขาส่วนตัวเดิม) — voiceRef ใช้ใน realtime effect ที่ mount ครั้งเดียว
  const [voiceOn, setVoiceOn] = useState(false);
  const voiceRef = useRef(false);
  voiceRef.current = voiceOn;
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
          if (voiceRef.current && row.reply_text) speak(row.reply_text);
          if (row.navigate_url) {
            setTimeout(() => router.push(row.navigate_url as string), 600);
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (kind: "apps" | "actions") => {
    setPanelOpen(false);
    setDrawer((p) => (p === kind ? null : kind));
  };
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
    router.push(item.route);
  };

  // textarea → /api/chat จริง (route เดิม = runCognitivePipeline · เดียวกับที่
  // relationships runCommand เรียก). sessionKey คงที่ของ shell ตัวนี้เพื่อให้
  // memory แยกจาก relationship อื่น (อุบัติการณ์ singleton 2026-07-31 ที่
  // cognitive/memory/session.ts) · ไม่มี knownCustomerId — shell ไม่รู้ลูกค้า
  const sendDraft = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
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
      // BATCH 12 — owner runtime context: current relationship + open
      // document travel as their own fields (UI context, never identity).
      if (composerContext?.relationshipId) body.relationshipId = composerContext.relationshipId;
      if (composerContext?.documentContext) body.documentContext = composerContext.documentContext;
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
          if (voiceOn) speak(vision);
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
            if (voiceOn) speak(copilot.text);
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
        // เสียงตอบ (voiceOn) — พูดข้อความตอบจริง ไม่พูด structured ที่ไม่มี text
        if (voiceOn && typeof data.text === "string" && data.text) speak(String(data.text));
        // navigate_url = contract ของ pipeline ที่ตอบ "เปิดหน้าให้แล้วครับ"
        // — route ที่ server รู้จักเท่านั้น (ตัวเดียวกับ navigation intercept)
        if (data.navigate_url) router.push(String(data.navigate_url));
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
  };

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

  return (
    <div id="dna-frame" aria-label="โครงหน้าจอ DNA OS">
      <style>{FRAME_CSS}</style>

      {/* ONE SURFACE (B): permanent header "DNA OS · พื้นที่ทำงาน" + note ถูกถอด —
          หน้าเริ่มต้น = canvas โล่งตาม Owner reference · ปุ่มควบคุมทั้งหมดอยู่ที่ขอบจอ */}

      {/* ONE SURFACE: ปุ่มมุมขวาบน = ทางเข้าแผง "ประวัติการสื่อสาร" (ถ้าหน้าส่ง
          messagePanel มา) — หน้าที่ไม่มีแผงยังไป /admin/event-inbox เหมือนเดิม */}
      <button
        className="corner"
        onClick={() => {
          setDrawer(null);
          if (messagePanel) setPanelOpen(!panelIsOpen);
          else router.push("/admin/event-inbox");
        }}
        aria-expanded={messagePanel ? panelIsOpen : undefined}
        aria-label="เปิดประวัติการสื่อสาร"
      >
        <MessageSquare />
      </button>
      {/* OWNER DIRECTIVE 2026-10-15: ปุ่ม Settings (เดิม → /admin/settings) ถูกถอดออก
          จากหน้าจอผู้ใช้ธุรกิจ — หน้านั้นแสดง Connections & Credentials, Supabase SQL
          Editor/API Keys, Railway/Vercel/GitHub links ซึ่งเป็น Internal System Links
          ที่เจ้าของสั่งห้ามไว้ในหน้าจอผู้ใช้. ตัวหน้า /admin/settings ยังอยู่และยัง
          ถูกปิดที่ server สำหรับ operational surface (ดู deny_pages) — เข้าจาก
          Developer Workspace (/developer) เท่านั้น */}

      {/* แผง "ประวัติการสื่อสาร" — รูปแบบตาม reference .inbox: เปิดทับ canvas (stage ซ่อน) */}
      {panelIsOpen && messagePanel && (
        <aside className="msg-panel" aria-label="ประวัติการสื่อสาร">
          <div className="row">
            <strong>ประวัติการสื่อสาร</strong>
            <button type="button" onClick={() => setPanelOpen(false)} aria-label="ปิดแผง">
              <X />
            </button>
          </div>
          <div className="panel-body">{messagePanel}</div>
        </aside>
      )}

        <button className="edge left" data-drawer="apps" aria-expanded={drawer === "apps"} onClick={() => toggle("apps")} aria-label="เปิดกล่องเครื่องมือ">
          <Grid2X2 />
        </button>

      {!panelIsOpen && (
      <section className={children ? "stage stage--bleed" : "stage"} data-screen="work">
        <button className="edge right" data-drawer="actions" aria-expanded={drawer === "actions"} onClick={() => toggle("actions")} aria-label="เปิดคำสั่งของรายการ">
          <Ellipsis />
        </button>

        {drawer && (
          <aside className="drawer">
            <div className="row">
              <strong>{drawer === "apps" ? "เครื่องมือ" : "คำสั่ง"}</strong>
              <button style={{ marginLeft: "auto" }} onClick={() => setDrawer(null)} aria-label="ปิด">
                <X />
              </button>
            </div>
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
            {drawer === "actions" && (
              <p className="note" style={{ marginTop: 10 }}>
                ปุ่มที่disabled = ยังไม่มี backend จริง — ไม่เปิดใช้เพื่อไม่ให้เข้าใจผิด
              </p>
            )}
          </aside>
        )}

        <div className={children ? "content content--fill" : "content"} aria-live="polite">
          {messages.length > 0 && (
            <div className="msg-list">
              {messages.map((m, idx) => {
                if (m.role === "user") {
                  // spec §1 USER: ฝั่งขวา · ความกว้างตามเนื้อหา · ไม่มี label ซ้ำ
                  return (
                    <div className="msg-row msg-row-user" key={m.id}>
                      <div className="bubble-user">{m.text}</div>
                    </div>
                  );
                }
                const firstDna = !messages.slice(0, idx).some((x) => x.role !== "user");
                return (
                  <div className="msg-row msg-row-dna" key={m.id}>
                    <div className="msg-col">
                      {firstDna && <div className="msg-sender">{m.role === "ai" ? "DNA OS" : "ระบบ"}</div>}
                      {m.result ? (
                        <ChatResultView result={m.result} fallbackText={m.text} />
                      ) : m.text ? (
                        <div className="bubble-dna">
                          <RichText text={m.text} />
                        </div>
                      ) : null}
                      {!m.result && m.docHtml && (
                        <div className="msg-actions">
                          <button type="button" onClick={() => openHtmlDocument(m.docHtml!)}>
                            เปิดเอกสาร (HTML เต็ม)
                          </button>
                        </div>
                      )}
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
                  </div>
                );
              })}
              {sending && <div className="note">DNA OS กำลังประมวลผล...</div>}
              {uploading && <div className="note">กำลังอัปโหลดไฟล์...</div>}
            </div>
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
          className="compose"
          onSubmit={(e) => {
            e.preventDefault();
            void sendDraft();
          }}
        >
          <textarea
            aria-label="คำสั่ง"
            placeholder="พิมพ์คำสั่งกับ DNA OS…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
                e.preventDefault();
                if (!sending && !uploading && draft.trim()) e.currentTarget.form?.requestSubmit();
              }
            }}
            disabled={sending}
          />
          <div className="row compose-tools">
            <button type="button" aria-label="แนบไฟล์" title="แนบไฟล์" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Paperclip />
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              multiple
              onChange={(e) => {
                void uploadFiles(e.target.files);
              }}
            />
            <button
              type="button"
              className="voice"
              aria-pressed={voiceOn}
              aria-label="เปิดหรือปิดเสียงตอบ"
              title={voiceOn ? "ปิดเสียงพูด" : "เปิดให้พูดคำตอบ"}
              onClick={() => {
                const next = !voiceOn;
                setVoiceOn(next);
                voiceRef.current = next;
                if (!next && typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
              }}
            >
              <Mic />
            </button>
            <button className="send" type="submit" aria-label="ส่งคำสั่ง" disabled={sending}>
              <ArrowUp />
            </button>
          </div>
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

function DocumentResultView({ title, html }: { title: string; html: string }) {
  const model: BusinessDisplayModel = {
    id: "chat-document",
    title,
    domain: "เอกสาร",
    blocks: [{ kind: "document", id: "doc", title, html }],
  };
  return (
    <div className="result-block">
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
      return (
        <div className="bubble-dna">
          <RichText text={result.text || fallbackText} />
        </div>
      );
    case "error":
      return (
        <div className="bubble-error">
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
          {fallbackText && (
            <div className="bubble-dna">
              <RichText text={fallbackText} />
            </div>
          )}
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
          {fallbackText && (
            <div className="bubble-dna">
              <RichText text={fallbackText} />
            </div>
          )}
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

/** Shared tool access for admin destinations that do not render WorkspaceFrame. */
export function WorkspaceToolNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <nav className="dna-tool-access" aria-label="เครื่องมือ DNA OS">
      <style>{`
        .dna-tool-access{position:relative;grid-row:1;align-self:stretch;padding:16px 8px;z-index:40;color:#36332f;font:14px/1.6 system-ui,sans-serif}
        body:has(#dna-frame) .dna-tool-access{display:none}
        .dna-tool-access button{background:#fdfbf8;border:1px solid #e9e1d6;border-radius:9px;min-height:44px;padding:8px;cursor:pointer;color:inherit;font:inherit}
        .dna-tool-access button:hover{background:#f0ebe5}
        .dna-tool-access svg{width:18px;height:18px}
        .dna-tool-menu{position:fixed;top:76px;left:12px;right:12px;max-height:calc(100dvh - 92px);overflow:auto;padding:16px;border:1px solid #e9e1d6;border-radius:12px;background:#fdfbf8;box-shadow:0 12px 24px #0002}
        .dna-tool-menu .menu-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
        .dna-tool-menu section{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}
        .dna-tool-menu section button{display:flex;gap:8px;align-items:center;text-align:left}
      `}</style>
      <button type="button" aria-label="เปิดกล่องเครื่องมือ" aria-expanded={open} onClick={() => setOpen(!open)}><Grid2X2 /></button>
      {open && (
        <div className="dna-tool-menu">
          <div className="menu-heading"><strong>เครื่องมือ</strong><button type="button" aria-label="ปิดกล่องเครื่องมือ" onClick={() => setOpen(false)}><X /></button></div>
          <section>
            <button type="button" onClick={() => { setOpen(false); router.push("/workspace"); }}><MessageSquare />พื้นที่ทำงาน</button>
            {APPS.map((item) => (
              <button key={item.label} type="button" onClick={() => {
                setOpen(false);
                if (item.external) void openExternal(item.external);
                else if (item.route && item.route !== pathname) router.push(item.route);
              }}><item.icon />{item.label}</button>
            ))}
          </section>
        </div>
      )}
    </nav>
  );
}

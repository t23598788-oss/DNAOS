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
import { useRouter } from "next/navigation";
import {
  Grid2X2, Ellipsis, MessageSquare, Settings, FileText, MessageCircle,
  Wallet, MapPin, Briefcase, Users, ScanLine, Files, FileOutput, Printer,
  Download, Share2, History, Paperclip, ArrowUp, X,
  LayoutGrid, FileSignature, Banknote, Mountain, Server, Cloud,
} from "lucide-react";
import { openExternal } from "@/components/admin/openExternal";
import FlexPreview from "@/presentation/viewer/FlexPreview";
import Viewer from "@/presentation/viewer/Viewer";
import { RichText } from "@/presentation/ai/RichText";
import { PartnerTimelineList, PartnerSummaryCard } from "@/presentation/panels/PartnerTimeline";
import { BusinessDisplayRenderer } from "@/app/admin/ui-gallery/_lib/BusinessDisplayRenderer";
import type { BusinessDisplayModel } from "@/app/admin/ui-gallery/_lib/businessDisplayModel";
import type { ChatResult } from "@/app/api/chat/_lib/chatResultTypes";

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
  { icon: LayoutGrid, label: "เลขา", route: "/admin/dashboard" },
  { icon: FileSignature, label: "รายการเอกสาร", route: "/admin/transactions" },
  { icon: Banknote, label: "ลูกหนี้", route: "/admin/debt-tracking" },
  { icon: Mountain, label: "บ่อวัสดุ", route: "/admin/pits" },
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

/** CSS ยึด tokens + โครงสร้างของ reference (paper/ink/line/soft · edge drawer · stage โล่ง) */
const FRAME_CSS = `
#dna-frame{--paper:#fdfbf8;--ink:#36332f;--line:#e9e1d6;--soft:#f0ebe5;position:relative;background:var(--paper);color:var(--ink);font:14px/1.6 system-ui,sans-serif;border:1px solid var(--line);border-radius:16px;overflow:hidden;height:100dvh;display:flex;flex-direction:column}
#dna-frame *{box-sizing:border-box}
#dna-frame button,#dna-frame textarea{font:inherit;color:inherit}
#dna-frame button{background:transparent;border:1px solid var(--line);border-radius:9px;padding:8px 12px;min-height:44px;cursor:pointer}
#dna-frame button:hover,#dna-frame button[aria-pressed=true]{background:var(--soft)}
#dna-frame button[aria-disabled=true]{opacity:.45;cursor:not-allowed}
#dna-frame button[aria-disabled=true]:hover{background:transparent}
#dna-frame .corner{position:absolute;z-index:4;right:14px;top:16px;background:var(--paper)}
#dna-frame .gear{position:absolute;left:12px;bottom:16px;z-index:3;background:var(--paper)}
#dna-frame .stage{position:relative;flex:1 1 auto;min-height:0;padding:84px 64px 78px;display:flex;flex-direction:column}
#dna-frame .stage--bleed{padding:76px 12px 12px}
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
#dna-frame .content--fill>div{flex:1 1 0%;min-height:0}
#dna-frame .count{background:#c93232;color:#fff;min-width:18px;border-radius:10px;font-size:11px;padding:0 5px;margin-left:auto}
#dna-frame .msg-list{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:14px;padding-bottom:12px}
#dna-frame .content:not(.content--fill) .msg-list{max-height:none}
#dna-frame .content--fill .msg-list{flex:0 1 auto;max-height:42vh}
#dna-frame button[disabled]{opacity:.5;cursor:not-allowed}
#dna-frame button[disabled]:hover{background:transparent}
#dna-frame .blank{text-align:center;padding:42px 0}
#dna-frame .compose{border:1px solid var(--line);border-radius:16px;padding:12px;margin-top:auto}
#dna-frame textarea{width:100%;resize:vertical;min-height:54px;background:transparent;border:0;outline:none}
#dna-frame .row .send{margin-left:auto}
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
#dna-frame .result-block{width:100%;max-width:920px;display:flex;flex-direction:column;gap:8px;min-width:0}
#dna-frame .result-title{font-weight:600;font-size:13px}
#dna-frame .result-notes{font-size:12px;color:#78716c}
#dna-frame .msg-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#dna-frame .msg-actions button{min-height:36px;font-size:12px;padding:6px 12px}
#dna-frame .msg-attachment{max-width:min(420px,90%)}
#dna-frame .attachment-row{display:flex;gap:10px;align-items:center;background:#fff;border:1px solid var(--line);border-radius:12px;padding:8px 12px;flex-wrap:wrap}
#dna-frame .attachment-link{font-size:12px;color:#0f766e;text-decoration:underline}
#dna-frame .result-timeline{max-width:820px}
#dna-frame svg{width:18px;height:18px;vertical-align:middle}
@media(max-width:500px){#dna-frame .stage{padding:72px 14px 16px}#dna-frame .blank{padding:24px 0}}
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
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        const result: ChatResult | undefined = data.result;
        const structured = !!result && !["text", "confirmation"].includes(result.type);
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
      <button className="gear" onClick={() => router.push("/admin/settings")} aria-label="Settings">
        <Settings />
      </button>

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

      {!panelIsOpen && (
      <section className={children ? "stage stage--bleed" : "stage"} data-screen="work">
        <button className="edge left" data-drawer="apps" aria-expanded={drawer === "apps"} onClick={() => toggle("apps")} aria-label="เปิดกล่องเครื่องมือ">
          <Grid2X2 />
        </button>
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
            disabled={sending}
          />
          <div className="row">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Paperclip /> แนบไฟล์
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

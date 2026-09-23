"use client";

// presentation/viewer — Viewer (canonical VIEWER primitive, Phase 3)
//
// Built only from what UI_PRESENTATION_BOUNDARY_PLAN.md §8 proved exists:
//
//   image     → <img> hand-written in ListColumn (avatar) and login (logo) → kind="image"
//   document  → components/documents/DocumentPreview.tsx renders `iframe.srcdoc = html`
//               where the HTML was produced by engines/documents/engine. This primitive
//               renders the SAME way (srcdoc, ความสูงเริ่มต้น 1100px เท่ากัน, ไม่มี sandbox
//               เหมือนกัน) แต่รับ HTML ที่ generate เสร็จแล้วเป็น data — ไม่ import engine
//               จึงไม่ทำให้ engine boundary หลุดเข้ามาใน presentation/
//               ต่างจากต้นทางจุดเดียว: กรอบมาจาก container ของ primitive ไม่ได้อยู่บน iframe
//   text      → hand-written <pre> in api-explorer / workspace / traces → kind="text"
//   loading   → DocumentPreview's own "กำลังโหลด…" string → `loading`
//   error     → DocumentPreview has none today; the requirement is recorded as a
//               real gap in §8 → `error` (rendered here, nothing else invented)
//   zoom      → Canvas owns `viewport.zoom` + `%` display (Canvas.tsx:76,173,255) and
//               core/workspace/types.ts exports `Viewport`; the same idea arrives here
//               as an optional numeric `zoom` the caller owns.
//   empty     → presentation/feedback/EmptyState (reused)
//
// NOT implemented on purpose: a PDF viewer does not exist anywhere in this repository
// (§8: "PDF VIEWER ไม่มี ถ้าต้องการ = งานใหม่ ห้ามสร้างรอบนี้"). kind="pdf" therefore
// renders an explicit "not implemented" notice instead of pretending to work.

import type { ReactNode } from "react";
import { AlertTriangle, FileQuestion } from "lucide-react";
import EmptyState from "@/presentation/feedback/EmptyState";

export type ViewerKind = "image" | "text" | "document" | "pdf";

export interface ViewerProps {
  kind: ViewerKind;
  /** kind="image" — URL ที่ผู้เรียก resolve มาแล้ว */
  src?: string;
  alt?: string;
  /** kind="text" */
  text?: string;
  /** kind="document" — HTML ที่ engine สร้างเสร็จแล้ว (primitive ไม่รู้จัก engine) */
  html?: string;
  /** kind="pdf" — URL ของไฟล์ (ยังไม่มี implementation) */
  pdfUrl?: string;
  /** ความสูงของ iframe เมื่อ kind="document" — ค่าเริ่มต้น 1100 ตรงกับ DocumentPreview ต้นทาง */
  documentHeight?: number;
  /** ตัวคูณขนาดที่ผู้เรียกเป็นเจ้าของ (หลักฐาน: Canvas viewport.zoom) */
  zoom?: number;
  loading?: boolean;
  loadingMessage?: string;
  error?: string | null;
  emptyMessage?: string;
  /** แถบเครื่องมือด้านบน (zoom control / ปุ่มดาวน์โหลด ฯลฯ) — ผู้เรียกเป็นเจ้าของ */
  toolbar?: ReactNode;
  className?: string;
}

function Missing({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4">
      <FileQuestion className="w-6 h-6 text-stone-300 mb-3" />
      <p className="text-xs text-stone-400">{message}</p>
    </div>
  );
}

export default function Viewer({
  kind,
  src,
  alt = "",
  text,
  html,
  pdfUrl,
  documentHeight = 1100,
  zoom,
  loading = false,
  loadingMessage = "กำลังโหลด…",
  error = null,
  emptyMessage = "ยังไม่มีข้อมูลที่จะแสดง",
  toolbar,
  className = "",
}: ViewerProps) {
  const scale = zoom && zoom > 0 ? { transform: `scale(${zoom})`, transformOrigin: "top left" } : undefined;

  let body: ReactNode;

  if (loading) {
    body = <div className="py-10 px-4 text-center text-xs text-stone-400">{loadingMessage}</div>;
  } else if (error) {
    body = (
      <div className="flex flex-col items-center justify-center text-center gap-2 py-10 px-4">
        <AlertTriangle className="w-5 h-5 text-amber-500" />
        <p className="text-xs text-stone-500">{error}</p>
      </div>
    );
  } else if (kind === "pdf") {
    body = (
      <Missing
        message={
          pdfUrl
            ? "ยังไม่มี PDF viewer ในระบบ — ไฟล์: " + pdfUrl
            : "ยังไม่มี PDF viewer ในระบบ (ยังไม่ได้รับ URL ของไฟล์)"
        }
      />
    );
  } else if (kind === "image") {
    body = src ? (
      // eslint-disable-next-line @next/next/no-img-element -- รูปแบบเดียวกับ ListColumn/login ที่ใช้ <img> อยู่แล้ว
      <img src={src} alt={alt} style={scale} className="max-w-none" />
    ) : (
      <EmptyState message={emptyMessage} />
    );
  } else if (kind === "text") {
    body = text ? (
      <pre
        style={scale}
        className="text-xs text-stone-700 whitespace-pre-wrap break-words p-3 bg-stone-50 rounded-lg"
      >
        {text}
      </pre>
    ) : (
      <EmptyState message={emptyMessage} />
    );
  } else {
    body = html ? (
      <iframe
        title={alt || "document"}
        srcDoc={html}
        // ไม่ใส่ sandbox โดยเจตนา: DocumentPreview ต้นทางก็ render โดยไม่มี sandbox
        // (template เอกสารใช้ CSS แบบ unscoped + อาจมี script สำหรับพิมพ์)
        // ถ้าต้องการ sandbox ที่เข้มขึ้น = การตัดสินใจของ Phase 4 ไม่แก้เงียบ ๆ ที่นี่
        className="w-full bg-white"
        style={{ height: documentHeight, border: 0, ...(scale ?? {}) }}
      />
    ) : (
      <EmptyState message={emptyMessage} />
    );
  }

  return (
    <div className={"flex flex-col bg-white border border-stone-200 rounded-xl overflow-hidden " + className}>
      {toolbar && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-stone-100 flex-shrink-0">
          {toolbar}
        </div>
      )}
      <div className="overflow-auto">{body}</div>
    </div>
  );
}

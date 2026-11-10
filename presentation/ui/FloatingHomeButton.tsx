"use client";

/**
 * FLOATING HOME BUTTON — ทางเข้าเมนูเดียวของทั้งระบบ (owner 2026-11-02)
 *
 * บริบท: ONE NAVIGATION เดิมมี 3 ทางที่ต่างกัน (IconRail ของ WorkspaceShell,
 * AppShell ของ line-customers, WorkspaceToolNavigation ใน admin layout) —
 * ตอนนี้รวมเหลือปุ่มลอยปุ่มเดียว ปุ่มนี้จึงต้อง "ถือเมนูเอง" ไม่ใช่แค่ trigger
 * เหมือน FloatingToolsButton เดิมที่อาศัย drawer ของ WorkspaceFrame
 *
 * drag = Pointer Events + setPointerCapture ⇒ ลากออกนอกปุ่มแล้วไม่หลุด
 * click หลังลาก: pointerup ยิง click ตามมาเสมอ ⇒ suppressClick กันการลาก
 * กลายเป็นการเปิดเมนู (เกิน 3px = ลาก, ไม่เกิน = กดปกติ)
 *
 * เมนูเป็น fixed ลอยทับ ไม่ดันเนื้อหา · เปิด/ปิดด้วยคลิกนอกเมนู, Escape,
 * ปุ่มปิด และการเปลี่ยน route (pathname) — ไม่มี state ค้างข้ามหน้า
 */
import { useEffect, useRef, useState, type ElementType, type PointerEvent as ReactPointerEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Grid2X2, X, Briefcase, Users, User, LayoutGrid,
  Files, FileText, MessageCircle, Wallet, MapPin, ScanLine,
  MessageSquare, FileSignature, Banknote, Mountain, Server, Cloud, BookOpen,
} from "lucide-react";
import { openExternal } from "@/components/admin/openExternal";
import LogoutButton from "@/components/auth/LogoutButton";

type MenuItem = {
  icon: ElementType;
  label: string;
  /** route ภายในแอป */
  route?: string;
  /** URL ภายนอก — เปิดผ่าน openExternal (Tauri + web pattern เดิมของ rail) */
  external?: string;
};

// RUNPOD console shortcut (owner 2026-08-03) — เดิมอยู่ใน IconRail ของ
// relationships ตอนนี้ย้ายมาเมนูรวม (external = เปิด browser จริง)
const RUNPOD_CONSOLE_URL = "https://console.runpod.io/pods";

/** 14 จุดหมายธุรกิจ — ค่าเดียวกับ APPS ใน app/workspace/WorkspaceFrame.tsx */
const APPS: MenuItem[] = [
  { icon: BookOpen, label: "คู่มือ", route: "/admin/docs" },
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
  { icon: Server, label: "ค่าใช้จ่าย", route: "/admin/infrastructure" },
  { icon: Cloud, label: "Cloud GPU", external: RUNPOD_CONSOLE_URL },
];

/**
 * 4 workspace switches — href เดียวกับ core/navigation/resolveNavItems.ts
 * (admin ชี้ /admin/dashboard ไม่ใช่ /admin เพราะ /admin เป็น redirect stub)
 */
const WORKSPACES: MenuItem[] = [
  { icon: LayoutGrid, label: "Admin", route: "/admin/dashboard" },
  { icon: Briefcase, label: "Business", route: "/business" },
  { icon: Users, label: "Partner", route: "/partner" },
  { icon: User, label: "User", route: "/user" },
];

export default function FloatingHomeButton() {
  const router = useRouter();
  const pathname = usePathname();
  const SIZE = 48;

  const [pos, setPos] = useState({ x: 24, y: 80 });
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [menuStyle, setMenuStyle] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const dragRef = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  // route เปลี่ยน = ปิดเมนู (ไม่มีเมนูค้างข้ามหน้า)
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape ปิดเมนู
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const clamp = (value: number, max: number) => Math.min(Math.max(0, value), Math.max(0, max));

  /** เปิดเมนู: คำนวณตำแหน่งจากปุ่มจริงแล้ว clamp ให้อยู่ใน viewport */
  const openMenu = () => {
    const width = Math.min(320, window.innerWidth - 24);
    const left = Math.min(Math.max(8, pos.x), Math.max(8, window.innerWidth - width - 8));
    const top = Math.min(pos.y + SIZE + 8, Math.max(8, window.innerHeight - 220));
    setMenuStyle({ left, top, width, maxHeight: Math.max(180, window.innerHeight - top - 12) });
    setOpen(true);
  };

  const activate = (item: MenuItem) => {
    setOpen(false);
    if (item.external) {
      void openExternal(item.external);
      return;
    }
    if (!item.route || item.route === pathname) return;
    router.push(item.route);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false };
    suppressClick.current = false;
    setDragging(true);
    setOpen(false);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const x = clamp(e.clientX - drag.dx, window.innerWidth - SIZE);
    const y = clamp(e.clientY - drag.dy, window.innerHeight - SIZE);
    if (!drag.moved && (Math.abs(x - pos.x) > 3 || Math.abs(y - pos.y) > 3)) {
      drag.moved = true;
      suppressClick.current = true;
    }
    if (drag.moved) setPos({ x, y });
  };

  const endDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <>
      {open && <div className="floating-home-backdrop" onClick={() => setOpen(false)} aria-hidden />}

      {open && menuStyle && (
        <div
          className="floating-home-menu"
          role="dialog"
          aria-label="เมนูหลัก DNA OS"
          style={menuStyle}
        >
          <div className="fh-head">
            <strong>เมนู</strong>
            <button type="button" className="fh-close" onClick={() => setOpen(false)} aria-label="ปิดเมนู">
              <X />
            </button>
          </div>

          <div className="fh-grid">
            {APPS.map((item) => (
              <button key={item.label} type="button" className="fh-item" onClick={() => activate(item)}>
                <item.icon size={16} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>

          <div className="fh-divider" />

          <div className="fh-grid">
            {WORKSPACES.map((item) => (
              <button
                key={item.label}
                type="button"
                className="fh-item"
                aria-current={item.route === pathname ? "page" : undefined}
                onClick={() => activate(item)}
              >
                <item.icon size={16} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>

          <div className="fh-divider" />

          <LogoutButton className="fh-item fh-logout" />
        </div>
      )}

      <button
        type="button"
        className={dragging ? "floating-home-btn is-drag" : "floating-home-btn"}
        style={{ left: pos.x, top: pos.y }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="เปิดเมนูหลัก"
        title="เมนู (ลากเพื่อย้ายตำแหน่ง)"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          if (open) setOpen(false);
          else openMenu();
        }}
      >
        <Grid2X2 size={20} color="white" />
      </button>
    </>
  );
}

import { ADMIN_TIER, ANY_AUTHENTICATED } from "@/core/auth/session";
import type { ApplicationDefinition } from "./application";

// Application Registry (Phase 5, Step 23). Every panel below names a real
// PresenterId; ids without a real Presenter (Phase 4C findings — no
// backing data source) are listed as-is and render as placeholders, never
// fabricated content (owner constraint #7, applied consistently to every
// Application, not just Finance).
export const APPLICATIONS: ApplicationDefinition[] = [
  {
    id: "dashboard",
    name: "Dashboard",
    boardType: "dashboard",
    requiredRoles: ANY_AUTHENTICATED,
    panels: [
      { presenterId: "debt", title: "หนี้ค้างชำระ" },
      { presenterId: "workflow", title: "สถานะ Workflow" },
      { presenterId: "system-status", title: "System Status" }, // no real presenter
      { presenterId: "timeline", title: "Timeline" }, // no real presenter
      { presenterId: "alerts", title: "Alerts" }, // no real presenter
    ],
  },
  {
    id: "business",
    name: "Business",
    boardType: "business",
    requiredRoles: ADMIN_TIER,
    panels: [
      { presenterId: "partner", title: "พาร์ทเนอร์" },
      { presenterId: "order", title: "คำสั่งซื้อ" },
      { presenterId: "invoice", title: "ใบแจ้งหนี้" },
      { presenterId: "document", title: "เอกสาร" },
      { presenterId: "material", title: "วัสดุ" },
      { presenterId: "transport", title: "งานขนส่ง" },
      { presenterId: "workflow", title: "สถานะ Workflow" },
    ],
  },
  {
    id: "partner",
    name: "Partner",
    boardType: "partner",
    requiredRoles: [...ADMIN_TIER, "partner"],
    panels: [
      { presenterId: "order", title: "คำสั่งซื้อ" },
      { presenterId: "invoice", title: "ใบแจ้งหนี้" },
      { presenterId: "payment", title: "การชำระเงิน" }, // no real presenter
      { presenterId: "document", title: "เอกสาร" },
      { presenterId: "timeline", title: "Timeline" }, // no real presenter
    ],
  },
  {
    id: "finance",
    name: "Finance",
    boardType: "finance",
    requiredRoles: ADMIN_TIER,
    panels: [
      { presenterId: "debt", title: "หนี้" },
      { presenterId: "invoice", title: "ใบแจ้งหนี้" },
      { presenterId: "payment", title: "การชำระเงิน" }, // no real presenter
      { presenterId: "cashflow", title: "กระแสเงินสด" }, // no real presenter
      { presenterId: "vat", title: "VAT" }, // no real presenter
    ],
  },
];
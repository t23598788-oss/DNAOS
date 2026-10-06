// UI Gallery — uiCatalog.ts
//
// Presentation metadata ของ UI Gallery (Owner decision ข้อ 8: ใช้ TS presentation
// metadata รอบนี้ — **ห้ามสร้าง registry ใหม่** และ **ห้ามแก้
// registry/module-registry.json เพื่อเรื่อง Gallery**)
//
// ไฟล์นี้เป็น "ข้อมูลสำหรับจัดหมวดเพื่อดู" เท่านั้น:
//   - ไม่มี runtime registration, ไม่มี side effect
//   - ไม่ import React / component ใด ๆ (component จริง resolve ที่
//     _lib/componentHost.tsx — กันไม่ให้ไฟล์ข้อมูลลาก UI เข้า bundle)
//   - ไม่มี business data (ไม่มีเลขที่เอกสาร/ยอดเงิน/ชื่อลูกค้า)
//
// source path ทุกตัวคือ path จริงใน repo ณ origin/main (ยกเว้น branch: "branch")
// route ทุกตัวเป็น route จริงที่ตรวจแล้ว — item ที่ route เป็น redirect-only หรือ
// ต้องพึ่งข้อมูลจริง จะถูกทำเครื่องหมาย renderMode ให้ตรงความจริง ไม่เดา

export type UiCategory =
  | "Full Workspace"
  | "Template"
  | "Business Page"
  | "Shell"
  | "Layout"
  | "Sidebar"
  | "Board"
  | "Panel"
  | "Canvas"
  | "Preview"
  | "Login"
  | "Component";

export type UiRenderMode =
  | "route" // เปิดด้วย <iframe src={route}> — เห็น UI จริงพร้อม shell/layout จริง
  | "component" // import component จริงในโฮสต์ page แล้วป้อน props (ไม่มีสำเนา)
  | "blocked"; // redirect-only / ต้องข้อมูลจริง — การ์ดอธิบาย + ลิงก์ไป route จริง

export type UiBranch = "main" | "branch";

export interface UiItem {
  id: string;
  label: string;
  /** source path จริงใน repo */
  path: string;
  branch: UiBranch;
  category: UiCategory;
  renderMode: UiRenderMode;
  /** renderMode=route — route จริงที่ iframe ได้ */
  route?: string;
  /** renderMode=component — key ใน componentHost.tsx */
  hostKey?: string;
  /** shell ที่ UI นี้ใช้ (ตาม Inventory) */
  shell?: string;
  /** Next.js layout ที่ครอบ UI นี้ */
  layout?: string;
  notes?: string;
  /** renderMode=blocked — เหตุผลที่ preview ตรง ๆ ไม่ได้ */
  blockedReason?: string;
  /** component ที่เขียนข้อมูลจริงได้ (upload/save/send) — แสดงคำเตือน */
  writeCapable?: boolean;
  /** ต้องมี session/ข้อมูลจริงก่อนจึงเห็นเนื้อหา */
  needsRealData?: boolean;
  /** UI ที่ไม่มีใคร mount (orphan) */
  orphan?: boolean;
}

export const UI_CATEGORY_ORDER: UiCategory[] = [
  "Full Workspace",
  "Template",
  "Business Page",
  "Shell",
  "Layout",
  "Sidebar",
  "Board",
  "Panel",
  "Canvas",
  "Preview",
  "Login",
  "Component",
];

const T = "presentation/foundation/tokens ThemeProvider";

export const UI_CATALOG: UiItem[] = [
  { id: "assistant-crew", label: "พนักงานผู้ช่วย — 4 รูปแบบขยับได้", path: "app/admin/ui-gallery/assistants/page.tsx", branch: "branch", category: "Preview", renderMode: "route", route: "/admin/ui-gallery/assistants", notes: "น้องพร้อม / น้องแฟ้ม / น้องมิว / น้องออร์บ — ต้นแบบบุคลิกและอารมณ์ ไม่มีการอ่านข้อมูลหรือส่งงานจริง" },
  // ── FULL WORKSPACES (main 9) ───────────────────────────────────────────────
  { id: "owner-control-center", label: "Owner Control Center", path: "app/OperationalWorkspace.tsx", branch: "main", category: "Full Workspace", renderMode: "route", route: "/", shell: T, layout: "app/layout.tsx", needsRealData: true, notes: "gated ด้วย requireAuthPage(ADMIN_TIER) เหมือน /admin" },
  { id: "relationship-workspace", label: "Relationship Workspace V1", path: "app/admin/relationships/workspace.tsx", branch: "main", category: "Full Workspace", renderMode: "route", route: "/admin/relationships", shell: "presentation/shell/AppShell", layout: "app/admin/layout.tsx", needsRealData: true },
  { id: "line-customers-workspace", label: "LINE Customers Workspace", path: "app/admin/line-customers/page.tsx", branch: "main", category: "Full Workspace", renderMode: "route", route: "/admin/line-customers", shell: "presentation/shell/AppShell", layout: "app/admin/layout.tsx", needsRealData: true },
  { id: "software-factory-ide", label: "Software Factory IDE", path: "components/ide-shell/IDEWorkspace.tsx", branch: "main", category: "Full Workspace", renderMode: "route", route: "/admin/ide", shell: "ตัวเองเป็น shell (ActivityBar+LeftPanel+BottomTabs+StatusBar — ONE NAVIGATION: แถบแท็บไฟล์ถูกถอดแล้ว)", layout: "app/admin/layout.tsx", needsRealData: true, notes: "5,976 บรรท� — reuse ได้เป็น route ทั้งก้อนเท่านั้น" },
  { id: "admin-command-workspace", label: "Admin Command Workspace", path: "app/admin/workspace/page.tsx", branch: "main", category: "Full Workspace", renderMode: "route", route: "/admin/workspace", shell: "(ไม่มี nav ในตัวเอง)", layout: "app/admin/layout.tsx", needsRealData: true },
  { id: "visual-workspace-canvas", label: "Visual Workspace Canvas", path: "app/workspace-preview/WorkspacePreviewClient.tsx", branch: "main", category: "Full Workspace", renderMode: "route", route: "/workspace-preview", shell: "components/workspace/canvas/Canvas", notes: "อ่าน moduleRegistry + localStorage เท่านั้น ไม่แตะ DB" },
  { id: "application-composition", label: "Application Composition", path: "app/workspace-preview/apps/[appId]/page.tsx", branch: "main", category: "Full Workspace", renderMode: "route", route: "/workspace-preview/apps/dashboard", shell: "presentation/shell/workspace/DashboardBoard", needsRealData: true, notes: "appId จริงจาก core/workspace/applicationRegistry.ts" },

  // ── TEMPLATE (branch-only 5 — นำเข้าอย่างปลอดภัยแล้ว) ────────────────────────
  { id: "template-overview", label: "Business Workspace Template — ภาพรวม", path: "app/business-workspace-template/overview/page.tsx", branch: "branch", category: "Template", renderMode: "route", route: "/business-workspace-template/overview", shell: "presentation/shell/TemplateShell", layout: "(ไม่มี layout — TemplateShell ครอบเอง)", notes: "ตัด hardcoded sample data ออกแล้ว ใช้ EmptyState แทน" },
  { id: "template-workspace", label: "Business Workspace Template — Workspace", path: "app/business-workspace-template/workspace/page.tsx", branch: "branch", category: "Template", renderMode: "route", route: "/business-workspace-template/workspace", shell: "presentation/shell/TemplateShell", notes: "ตัด hardcoded sample data ออกแล้ว" },
  { id: "template-tasks", label: "Business Workspace Template — งาน/ตารางงาน", path: "app/business-workspace-template/tasks/page.tsx", branch: "branch", category: "Template", renderMode: "route", route: "/business-workspace-template/tasks", shell: "presentation/shell/TemplateShell", notes: "ตัด hardcoded sample data ออกแล้ว" },
  { id: "template-documents", label: "Business Workspace Template — เอกสาร", path: "app/business-workspace-template/documents/page.tsx", branch: "branch", category: "Template", renderMode: "route", route: "/business-workspace-template/documents", shell: "presentation/shell/TemplateShell", notes: "ตัด hardcoded sample data ออกแล้ว" },
  { id: "template-entry-redirect", label: "Business Workspace Template — entry (redirect)", path: "app/business-workspace-template/page.tsx", branch: "branch", category: "Template", renderMode: "blocked", route: "/business-workspace-template/overview", blockedReason: "route นี้เป็น redirect ไป /business-workspace-template/overview เท่านั้น — เปิด iframe จะได้หน้าว่าง" },


  // ── SHELLS (main 6 + branch 1) ─────────────────────────────────────────────
  { id: "shell-app-shell", label: "AppShell (3 คอลัมน์แบบ LINE)", path: "presentation/shell/AppShell.tsx", branch: "main", category: "Shell", renderMode: "component", hostKey: "shell-app-shell", shell: "IconRail + ListColumn + children" },
  { id: "shell-workspace-shell", label: "WorkspaceShell (IconRail + top bar)", path: "components/workspace/WorkspaceShell.tsx", branch: "main", category: "Shell", renderMode: "component", hostKey: "shell-workspace-shell", shell: "IconRail" },
  { id: "shell-portal-shell", label: "PortalShell (dark header + main + footer)", path: "presentation/shell/PortalShell.tsx", branch: "main", category: "Shell", renderMode: "component", hostKey: "shell-portal-shell", notes: "ผู้ใช้จริงเหลือแค่ /download" },
  { id: "shell-capability-page-shell", label: "CapabilityPageShell", path: "presentation/shell/PortalShell.tsx", branch: "main", category: "Shell", renderMode: "component", hostKey: "shell-capability-page-shell", notes: "ใช้โดย products/solutions/marketplace/ai-services/report" },
  { id: "shell-ide-workspace", label: "IDE Shell (IDEWorkspace)", path: "components/ide-shell/IDEWorkspace.tsx", branch: "main", category: "Shell", renderMode: "route", route: "/admin/ide", layout: "app/admin/layout.tsx", needsRealData: true, notes: "แยกเป็น component ไม่ได้ — ต้องเปิดเป็น route" },
  { id: "shell-template-shell", label: "TemplateShell (branch-only)", path: "presentation/shell/TemplateShell.tsx", branch: "branch", category: "Shell", renderMode: "component", hostKey: "shell-template-shell" },
  { id: "shell-theme-provider", label: "ThemeProvider + ThemeToggle (tokens)", path: "presentation/foundation/tokens/index.tsx", branch: "main", category: "Shell", renderMode: "component", hostKey: "shell-theme-provider" },

  // ── LAYOUTS (7 — preview ผ่าน route ตัวแทน) ─────────────────────────────────
  { id: "layout-root", label: "Root Layout", path: "app/layout.tsx", branch: "main", category: "Layout", renderMode: "route", route: "/login", layout: "app/layout.tsx", notes: "ครอบทุก route" },
  { id: "layout-admin", label: "Admin Layout", path: "app/admin/layout.tsx", branch: "main", category: "Layout", renderMode: "route", route: "/admin/line-customers", layout: "app/admin/layout.tsx", needsRealData: true, notes: "h-screen locked viewport + VoiceStandbyWidget (no top bar — ONE SURFACE)" },
  { id: "layout-business", label: "Business Layout", path: "app/business/layout.tsx", branch: "main", category: "Layout", renderMode: "route", route: "/business", layout: "app/business/layout.tsx", needsRealData: true },
  { id: "layout-partner", label: "Partner Layout", path: "app/partner/layout.tsx", branch: "main", category: "Layout", renderMode: "route", route: "/partner", layout: "app/partner/layout.tsx", needsRealData: true },
  { id: "layout-user", label: "User Layout", path: "app/user/layout.tsx", branch: "main", category: "Layout", renderMode: "route", route: "/user", layout: "app/user/layout.tsx", needsRealData: true },
  { id: "layout-observer", label: "Observer Layout (passthrough)", path: "app/observer/layout.tsx", branch: "main", category: "Layout", renderMode: "route", route: "/observer", layout: "app/observer/layout.tsx" },
  { id: "layout-liff", label: "LIFF Layout (passthrough)", path: "app/liff/layout.tsx", branch: "main", category: "Layout", renderMode: "route", route: "/liff/add-friend", layout: "app/liff/layout.tsx" },


  // ── SIDEBARS / ICON RAILS (main 6 + branch 1) ───────────────────────────────
  { id: "sidebar-icon-rail", label: "IconRail (rail 64px)", path: "presentation/shell/navigation/IconRail.tsx", branch: "main", category: "Sidebar", renderMode: "component", hostKey: "sidebar-icon-rail" },
  { id: "sidebar-list-column", label: "ListColumn (300 / 64 / 0 px)", path: "presentation/shell/navigation/ListColumn.tsx", branch: "main", category: "Sidebar", renderMode: "component", hostKey: "sidebar-list-column" },
  { id: "sidebar-admin-sidebar-nav", label: "AdminSidebarNav (w-60)", path: "components/admin/AdminSidebarNav.tsx", branch: "main", category: "Sidebar", renderMode: "component", hostKey: "sidebar-admin-sidebar-nav", orphan: true, notes: "0 consumer — ไม่ถูก mount ที่ไหนเลย (ในตัวมี polling /api/admin/outbound-drafts จริง)" },
  { id: "sidebar-settings-drawer", label: "SettingsDrawer", path: "components/settings/SettingsDrawer.tsx", branch: "main", category: "Sidebar", renderMode: "component", hostKey: "sidebar-settings-drawer", needsRealData: true, notes: "เปิดแล้วจะ fetch /api/admin/settings จริง" },
  { id: "sidebar-ide-activity-bar", label: "IDE ActivityBar + LeftPanel (ฝังใน IDEWorkspace)", path: "components/ide-shell/IDEWorkspace.tsx", branch: "main", category: "Sidebar", renderMode: "route", route: "/admin/ide", layout: "app/admin/layout.tsx", needsRealData: true },
  { id: "sidebar-template-nav", label: "TemplateShell sidebar w-64 (branch-only)", path: "presentation/shell/TemplateShell.tsx", branch: "branch", category: "Sidebar", renderMode: "route", route: "/business-workspace-template/overview", shell: "presentation/shell/TemplateShell" },
  { id: "sidebar-workspace-shell-rail", label: "WorkspaceShell IconRail (rail + user/logout)", path: "components/workspace/WorkspaceShell.tsx", branch: "main", category: "Sidebar", renderMode: "route", route: "/business", layout: "app/business/layout.tsx", needsRealData: true },

  // ── BOARDS (2 ไฟล์ / 5 board types) ─────────────────────────────────────────
  { id: "board-dashboard-board", label: "DashboardBoard (Dashboard board type)", path: "presentation/shell/workspace/DashboardBoard.tsx", branch: "main", category: "Board", renderMode: "component", hostKey: "board-dashboard-board", notes: "ป้อน EMPTY_RENDER_MODEL — ไม่ประดิษฐ์ข้อมูลธุรกิจ" },
  { id: "board-not-implemented", label: "NotImplementedBoard (business/finance/partner/mobile)", path: "presentation/shell/workspace/NotImplementedBoard.tsx", branch: "main", category: "Board", renderMode: "component", hostKey: "board-not-implemented" },
  { id: "board-any-type", label: "Board — ทดลอง board type (resolveBoard)", path: "core/workspace/boardRouter.ts", branch: "main", category: "Board", renderMode: "component", hostKey: "board-type-any", notes: "สลับ dashboard/business/finance/partner/mobile ผ่าน core/workspace/boardRouter.ts จริง ด้วย EMPTY_RENDER_MODEL" },

  // ── PANELS (8 ไฟล์เดี่ยว + IDE panels) ──────────────────────────────────────
  { id: "panel-transaction-panel", label: "TransactionPanel", path: "components/transactions/TransactionPanel.tsx", branch: "main", category: "Panel", renderMode: "route", route: "/admin/transactions", writeCapable: true, needsRealData: true, notes: "มีปุ่มสร้าง/ยืนยันธุรกรรมจริง — เปิดเป็น route" },
  { id: "panel-inspector", label: "Inspector (key/value)", path: "presentation/panels/Inspector.tsx", branch: "main", category: "Panel", renderMode: "component", hostKey: "panel-inspector" },
  { id: "panel-property-inspector", label: "PropertyInspector (Canvas)", path: "components/workspace/canvas/PropertyInspector.tsx", branch: "main", category: "Panel", renderMode: "component", hostKey: "panel-property-inspector" },
  { id: "panel-module-inspector", label: "ModuleInspector (Canvas)", path: "components/workspace/canvas/ModuleInspector.tsx", branch: "main", category: "Panel", renderMode: "component", hostKey: "panel-module-inspector", notes: "อ่าน metadata จริงจาก moduleRegistry" },
  { id: "panel-system-reality-report", label: "SystemRealityReportSection", path: "components/workspace/SystemRealityReportSection.tsx", branch: "main", category: "Panel", renderMode: "component", hostKey: "panel-system-reality-report", needsRealData: true, notes: "ต้องครอบ ThemeProvider (โฮสต์จัดให้) + fetch /api/admin/system-reality จริง" },
  { id: "panel-system-config-center", label: "SystemConfigCenter", path: "components/admin/SystemConfigCenter.tsx", branch: "main", category: "Panel", renderMode: "route", route: "/admin/system-config", writeCapable: true, needsRealData: true },
  { id: "panel-module-palette", label: "ModulePalette (Canvas)", path: "components/workspace/canvas/ModulePalette.tsx", branch: "main", category: "Panel", renderMode: "component", hostKey: "panel-module-palette", notes: "แสดง module จริงจาก moduleRegistry" },
  { id: "panel-ide-panels", label: "IDE Panels (Explorer/Search/SourceControl/…)", path: "components/ide-shell/IDEWorkspace.tsx", branch: "main", category: "Panel", renderMode: "route", route: "/admin/ide", needsRealData: true },


  // ── CANVAS ──────────────────────────────────────────────────────────────────
  { id: "canvas-editor", label: "Canvas (pan/zoom + dock + screens)", path: "components/workspace/canvas/Canvas.tsx", branch: "main", category: "Canvas", renderMode: "component", hostKey: "canvas-editor", notes: "ป้อน layout จาก workspaceLayoutStore.createEmpty() จริง (localStorage เท่านั้น)" },
  { id: "canvas-node-renderer", label: "NodeRenderer + ConnectionLayer (ภายใน Canvas)", path: "components/workspace/canvas/NodeRenderer.tsx", branch: "main", category: "Canvas", renderMode: "blocked", blockedReason: "เป็น component ภายในของ Canvas (ต้องได้ node/connection state จาก useCanvasState) — ใช้รายการ Canvas ด้านบนเพื่อดูของจริง" },
  { id: "canvas-preview-route", label: "Visual Workspace Canvas (route จริง)", path: "app/workspace-preview/page.tsx", branch: "main", category: "Canvas", renderMode: "route", route: "/workspace-preview" },

  // ── PREVIEW ─────────────────────────────────────────────────────────────────
  { id: "preview-debt-widget", label: "Preview — Debt Widget (vertical slice)", path: "app/workspace-preview/debt-widget/page.tsx", branch: "main", category: "Preview", renderMode: "route", route: "/workspace-preview/debt-widget", shell: "presentation/shell/workspace/DashboardBoard", needsRealData: true },
  { id: "preview-document", label: "Preview — Document", path: "app/workspace-preview/document/page.tsx", branch: "main", category: "Preview", renderMode: "route", route: "/workspace-preview/document", shell: "presentation/shell/workspace/DashboardBoard", needsRealData: true },
  { id: "preview-invoice", label: "Preview — Invoice", path: "app/workspace-preview/invoice/page.tsx", branch: "main", category: "Preview", renderMode: "route", route: "/workspace-preview/invoice", shell: "presentation/shell/workspace/DashboardBoard", needsRealData: true },
  { id: "preview-order", label: "Preview — Order", path: "app/workspace-preview/order/page.tsx", branch: "main", category: "Preview", renderMode: "route", route: "/workspace-preview/order", shell: "presentation/shell/workspace/DashboardBoard", needsRealData: true },
  { id: "preview-partner", label: "Preview — Partner", path: "app/workspace-preview/partner/page.tsx", branch: "main", category: "Preview", renderMode: "route", route: "/workspace-preview/partner", shell: "presentation/shell/workspace/DashboardBoard", needsRealData: true },
  { id: "preview-material", label: "Preview — Material", path: "app/workspace-preview/material/page.tsx", branch: "main", category: "Preview", renderMode: "route", route: "/workspace-preview/material", shell: "presentation/shell/workspace/DashboardBoard", needsRealData: true },
  { id: "preview-transport", label: "Preview — Transport", path: "app/workspace-preview/transport/page.tsx", branch: "main", category: "Preview", renderMode: "route", route: "/workspace-preview/transport", shell: "presentation/shell/workspace/DashboardBoard", needsRealData: true },
  { id: "preview-workflow", label: "Preview — Workflow", path: "app/workspace-preview/workflow/page.tsx", branch: "main", category: "Preview", renderMode: "route", route: "/workspace-preview/workflow", shell: "presentation/shell/workspace/DashboardBoard", needsRealData: true },
  { id: "preview-app-finance", label: "Preview — Application: finance", path: "app/workspace-preview/apps/[appId]/page.tsx", branch: "main", category: "Preview", renderMode: "route", route: "/workspace-preview/apps/finance", shell: "presentation/shell/workspace/DashboardBoard", needsRealData: true },
  { id: "preview-playground", label: "Playground (Conversational Command Surface)", path: "app/playground/page.tsx", branch: "main", category: "Preview", renderMode: "route", route: "/playground", shell: "app/playground/_components", needsRealData: true },

  // ── LOGIN ───────────────────────────────────────────────────────────────────
  { id: "login-sso", label: "SSO Login (ของจริง)", path: "app/login/page.tsx", branch: "main", category: "Login", renderMode: "route", route: "/login", notes: "ที่เดียวในระบบที่ login จริง (Supabase Auth)" },
  { id: "login-admin-redirect", label: "Admin Login (redirect)", path: "app/admin/login/page.tsx", branch: "main", category: "Login", renderMode: "blocked", route: "/login", blockedReason: "route นี้เป็น redirect ไป /login เท่านั้น (เก็บไว้กัน bookmark 404)" },
  { id: "login-template-prototype", label: "Template Login (prototype, branch-only)", path: "app/business-workspace-template/login/page.tsx", branch: "branch", category: "Login", renderMode: "route", route: "/business-workspace-template/login", notes: "ฟอร์ม static — ไม่ผูก auth จริง (ระบุไว้ในหน้าจอเองแล้ว)" },
  { id: "login-oauth-authorize", label: "OAuth Authorize (approve/deny)", path: "app/oauth/authorize/page.tsx", branch: "main", category: "Login", renderMode: "route", route: "/oauth/authorize", needsRealData: true },
  { id: "login-change-password", label: "Change Password Form", path: "app/account/change-password/ChangePasswordForm.tsx", branch: "main", category: "Login", renderMode: "route", route: "/account/change-password", notes: "ฟอร์มจริงผ่าน Supabase Auth" },
  { id: "login-logout-button", label: "LogoutButton", path: "components/auth/LogoutButton.tsx", branch: "main", category: "Login", renderMode: "component", hostKey: "login-logout-button", writeCapable: true, notes: "กดแล้ว sign out จริง" },


  // ── COMPONENT ───────────────────────────────────────────────────────────────
  { id: "comp-window", label: "Window (frame + title + close)", path: "presentation/panels/Window.tsx", branch: "main", category: "Component", renderMode: "component", hostKey: "comp-window" },
  { id: "comp-empty-state", label: "EmptyState", path: "presentation/feedback/EmptyState.tsx", branch: "main", category: "Component", renderMode: "component", hostKey: "comp-empty-state" },
  { id: "comp-action-bar", label: "ActionBar (actions + overflow)", path: "presentation/panels/ActionBar.tsx", branch: "main", category: "Component", renderMode: "component", hostKey: "comp-action-bar" },
  { id: "comp-map-view", label: "MapView (markers grid)", path: "presentation/viewer/MapView.tsx", branch: "main", category: "Component", renderMode: "component", hostKey: "comp-map-view" },
  { id: "comp-flex-preview", label: "FlexPreview (LINE Flex renderer)", path: "presentation/viewer/FlexPreview.tsx", branch: "main", category: "Component", renderMode: "component", hostKey: "comp-flex-preview", notes: "ป้อน Flex แบบโครงสร้างล้วน (ไม่มีข้อมูลธุรกิจ) เพื่อดูว่า renderer ทำงานอย่างไร" },
  { id: "comp-capability-skeleton", label: "CapabilitySkeleton (loading)", path: "presentation/feedback/CapabilitySkeleton.tsx", branch: "main", category: "Component", renderMode: "component", hostKey: "comp-capability-skeleton" },
  { id: "comp-copy-button", label: "CopyButton", path: "presentation/feedback/CopyButton.tsx", branch: "main", category: "Component", renderMode: "component", hostKey: "comp-copy-button" },
  { id: "comp-file-upload", label: "FileUpload (แนบไฟล์)", path: "presentation/documents/FileUpload.tsx", branch: "main", category: "Component", renderMode: "component", hostKey: "comp-file-upload", writeCapable: true, notes: "กดแนบไฟล์ = อัปโหลดเข้า Storage จริง — ใช้ด้วยความระวัง" },
  { id: "comp-document-preview", label: "DocumentPreview (iframe เอกสาร)", path: "components/documents/DocumentPreview.tsx", branch: "main", category: "Component", renderMode: "blocked", route: "/admin/create-document", blockedReason: "ต้องมี draft + CompanySettings จริง (อยู่หลัง DocumentBuilder) — เปิด /admin/create-document เพื่อดูของจริง" },
  { id: "comp-contact-settings-modal", label: "ContactSettingsModal", path: "components/line/ContactSettingsModal.tsx", branch: "main", category: "Component", renderMode: "blocked", blockedReason: "ต้องมี lineUserId จริงเพื่อ fetch โปรไฟล์ — เปิด /admin/relationships แล้วกดตั้งค่าคอนแท็กเพื่อดูของจริง" },
  { id: "comp-status-pill", label: "StatusPill (branch-only)", path: "presentation/shell/TemplateShell.tsx", branch: "branch", category: "Component", renderMode: "component", hostKey: "comp-status-pill" },
  { id: "comp-template-panel", label: "Template Panel (branch-only)", path: "presentation/shell/TemplateShell.tsx", branch: "branch", category: "Component", renderMode: "component", hostKey: "comp-template-panel" },

  // ── BUSINESS PAGES (main — Main UI ที่เหลือ ซึ่ง preview ได้ผ่าน route) ─────
  // ทุกตัวเป็น route จริง เปิดด้วย iframe (same-origin, session เดิม)
  // ตัวที่ต้องมี id/param จริง หรือเป็น redirect-only จะถูกทำเครื่องหมายตามจริง
  { id: "page-admin-root", label: "Admin entry (redirect)", path: "app/admin/page.tsx", branch: "main", category: "Business Page", renderMode: "blocked", route: "/admin/relationships", blockedReason: "redirect ไป /admin/relationships เท่านั้น" },
  { id: "page-workspace-entry", label: "Business Workspace — พื้นที่ทำงานปัจจุบัน", path: "app/workspace/page.tsx", branch: "main", category: "Full Workspace", renderMode: "route", route: "/workspace", shell: "app/workspace/WorkspaceFrame", needsRealData: true, notes: "ONE NAVIGATION: shell เดียว = WorkspaceFrame (ปุ่มขอบจอ) — ไม่มี IconRail/แท็บในตัวหน้าอีกต่อไป · ใช้สิทธิ์จากระบบกลาง — ต้องเข้าสู่ระบบ" },
  { id: "page-admin-dev-loop", label: "Dev Loop", path: "app/admin/dev-loop/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/dev-loop", layout: "app/admin/layout.tsx", needsRealData: true, notes: "มี DevLoopVoiceAlerts (Realtime + TTS)" },
  { id: "page-admin-finance", label: "Finance Summary", path: "app/admin/finance/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/finance", layout: "app/admin/layout.tsx", needsRealData: true },
  { id: "page-admin-create-document", label: "Create Document (DocumentBuilder)", path: "app/admin/create-document/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/create-document", layout: "app/admin/layout.tsx", writeCapable: true, needsRealData: true },
  { id: "page-admin-invoice", label: "Invoice (DocumentBuilder)", path: "app/admin/invoice/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/invoice", layout: "app/admin/layout.tsx", writeCapable: true, needsRealData: true },
  { id: "page-admin-receipt", label: "Receipt (DocumentBuilder)", path: "app/admin/receipt/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/receipt", layout: "app/admin/layout.tsx", writeCapable: true, needsRealData: true },
  { id: "page-admin-receipts", label: "Receipts (list)", path: "app/admin/receipts/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/receipts", layout: "app/admin/layout.tsx", needsRealData: true },
  { id: "page-admin-purchase-order", label: "Purchase Order", path: "app/admin/purchase-order/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/purchase-order", layout: "app/admin/layout.tsx", writeCapable: true, needsRealData: true },
  { id: "page-admin-delivery-order", label: "Delivery Order", path: "app/admin/delivery-order/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/delivery-order", layout: "app/admin/layout.tsx", writeCapable: true, needsRealData: true },
  { id: "page-admin-payment-voucher", label: "Payment Voucher", path: "app/admin/payment-voucher/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/payment-voucher", layout: "app/admin/layout.tsx", writeCapable: true, needsRealData: true },
  { id: "page-admin-debt-notice", label: "Debt Notice", path: "app/admin/debt-notice/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/debt-notice", layout: "app/admin/layout.tsx", writeCapable: true, needsRealData: true },
  { id: "page-admin-debt-tracking", label: "Debt Tracking", path: "app/admin/debt-tracking/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/debt-tracking", layout: "app/admin/layout.tsx", writeCapable: true, needsRealData: true },
  { id: "page-admin-pending", label: "Pending transactions", path: "app/admin/pending/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/pending", layout: "app/admin/layout.tsx", needsRealData: true },
  { id: "page-admin-jobs", label: "Jobs", path: "app/admin/jobs/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/jobs", layout: "app/admin/layout.tsx", needsRealData: true },
  { id: "page-admin-jobs-create", label: "Jobs — create", path: "app/admin/jobs/create/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/jobs/create", layout: "app/admin/layout.tsx", writeCapable: true, needsRealData: true },
  { id: "page-admin-partners", label: "Partners", path: "app/admin/partners/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/partners", layout: "app/admin/layout.tsx", needsRealData: true },

  { id: "page-admin-pits", label: "Material Pits", path: "app/admin/pits/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/pits", layout: "app/admin/layout.tsx", needsRealData: true },
  { id: "page-admin-quotation-queue", label: "Quotation Queue", path: "app/admin/quotation-queue/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/quotation-queue", layout: "app/admin/layout.tsx", needsRealData: true },
  { id: "page-admin-equipment", label: "Equipment (GPS/Relay permission)", path: "app/admin/equipment/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/equipment", layout: "app/admin/layout.tsx", writeCapable: true, needsRealData: true },
  { id: "page-admin-dbd", label: "DBD", path: "app/admin/dbd/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/dbd", layout: "app/admin/layout.tsx", needsRealData: true },
  { id: "page-admin-reader", label: "Reader", path: "app/admin/reader/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/reader", layout: "app/admin/layout.tsx", needsRealData: true },
  { id: "page-admin-connectors", label: "Connectors", path: "app/admin/connectors/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/connectors", layout: "app/admin/layout.tsx", writeCapable: true, needsRealData: true, notes: "ไฟล์นี้บน main ใหม่กว่าเวอร์ชันใน feature branch" },
  { id: "page-admin-links", label: "System Links", path: "app/admin/links/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/links", layout: "app/admin/layout.tsx" },
  { id: "page-admin-line-profiles", label: "LINE Profiles", path: "app/admin/line-profiles/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/line-profiles", layout: "app/admin/layout.tsx", needsRealData: true },
  { id: "page-admin-notifications", label: "Notifications (LINE push)", path: "app/admin/notifications/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/notifications", layout: "app/admin/layout.tsx", writeCapable: true, needsRealData: true },
  { id: "page-admin-users", label: "Users (roles)", path: "app/admin/users/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/users", layout: "app/admin/layout.tsx", writeCapable: true, needsRealData: true },
  { id: "page-admin-settings", label: "Settings", path: "app/admin/settings/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/settings", layout: "app/admin/layout.tsx", needsRealData: true },
  { id: "page-admin-storage", label: "Storage", path: "app/admin/storage/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/storage", layout: "app/admin/layout.tsx", needsRealData: true },
  { id: "page-admin-infrastructure", label: "Infrastructure & Costs", path: "app/admin/infrastructure/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/infrastructure", layout: "app/admin/layout.tsx", needsRealData: true },
  { id: "page-admin-schema-audit", label: "Schema Audit", path: "app/admin/schema-audit/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/schema-audit", layout: "app/admin/layout.tsx", needsRealData: true },
  { id: "page-admin-backup", label: "Backup", path: "app/admin/backup/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/backup", layout: "app/admin/layout.tsx", needsRealData: true },
  { id: "page-admin-deploy", label: "Deploy", path: "app/admin/deploy/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/deploy", layout: "app/admin/layout.tsx", needsRealData: true },
  { id: "page-admin-dna", label: "DNA", path: "app/admin/dna/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/dna", layout: "app/admin/layout.tsx", needsRealData: true },
  { id: "page-admin-engine-explorer", label: "Engine Explorer", path: "app/admin/engine-explorer/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/engine-explorer", layout: "app/admin/layout.tsx", needsRealData: true },
  { id: "page-admin-event-inbox", label: "Event Inbox", path: "app/admin/event-inbox/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/event-inbox", layout: "app/admin/layout.tsx", needsRealData: true },
  { id: "page-admin-traces", label: "Traces", path: "app/admin/traces/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/traces", layout: "app/admin/layout.tsx", needsRealData: true },
  { id: "page-admin-api-explorer", label: "API Explorer", path: "app/admin/api-explorer/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/api-explorer", layout: "app/admin/layout.tsx", needsRealData: true },
  { id: "page-admin-api-tokens", label: "API Tokens", path: "app/admin/api-tokens/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/admin/api-tokens", layout: "app/admin/layout.tsx", writeCapable: true, needsRealData: true },

  { id: "page-partner-detail", label: "Partner detail [id]", path: "app/admin/partners/[id]/page.tsx", branch: "main", category: "Business Page", renderMode: "blocked", route: "/admin/partners", blockedReason: "ต้องมี partner id จริงใน URL — เปิด /admin/partners แล้วเลือกคู่ค้าเพื่อดูของจริง" },
  { id: "page-job-detail", label: "Job detail [id]", path: "app/admin/jobs/[id]/page.tsx", branch: "main", category: "Business Page", renderMode: "blocked", route: "/admin/jobs", blockedReason: "ต้องมี job id จริงใน URL — เปิด /admin/jobs แล้วเลือกงานเพื่อดูของจริง" },
  { id: "page-relationship-detail", label: "Relationship detail [relationshipId]", path: "app/admin/relationships/[relationshipId]/page.tsx", branch: "main", category: "Business Page", renderMode: "blocked", route: "/admin/relationships", blockedReason: "ต้องมี relationship id จริงใน URL — เปิด /admin/relationships แล้วเลือกบริษัทเพื่อดูของจริง" },
  { id: "page-products", label: "Products (CapabilityPageShell)", path: "app/products/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/products", shell: "presentation/shell/PortalShell" },
  { id: "page-solutions", label: "Solutions (CapabilityPageShell)", path: "app/solutions/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/solutions", shell: "presentation/shell/PortalShell" },
  { id: "page-marketplace", label: "Marketplace (CapabilityPageShell)", path: "app/marketplace/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/marketplace", shell: "presentation/shell/PortalShell" },
  { id: "page-ai-services", label: "AI Services (CapabilityPageShell)", path: "app/ai-services/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/ai-services", shell: "presentation/shell/PortalShell" },
  { id: "page-report", label: "Report (CapabilityPageShell)", path: "app/report/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/report", shell: "presentation/shell/PortalShell" },
  { id: "page-download", label: "Download (PortalShell)", path: "app/download/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/download", shell: "presentation/shell/PortalShell" },
  { id: "page-start", label: "Engineering Workspace (/start)", path: "app/start/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/start" },
  { id: "page-examples", label: "Examples (Screen→Command map)", path: "app/examples/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/examples" },
  { id: "page-observer", label: "Observer (read-only architecture)", path: "app/observer/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/observer" },
  { id: "page-business", label: "Business Portal (CEO dashboard)", path: "app/business/page.tsx", branch: "main", category: "Business Page", renderMode: "route", route: "/business", layout: "app/business/layout.tsx", needsRealData: true },

  // ── PRESENTATION CANONICAL — ตัวที่ยังไม่มี entry (เพิ่มรอบ Owner review) ──────
  { id: "presentation-viewer", label: "Viewer (canonical viewer: image / text / document)", path: "presentation/viewer/Viewer.tsx", branch: "main", category: "Component", renderMode: "component", hostKey: "presentation-viewer", notes: "PDF = ยังไม่มี implementation ในระบบ (ไม่สร้าง) — รอบนี้ render kind=text + empty state จริงของ component" },
  { id: "presentation-data-table", label: "DataTable (canonical table primitive)", path: "presentation/table/DataTable.tsx", branch: "main", category: "Component", renderMode: "component", hostKey: "presentation-data-table", notes: "ยังไม่มี consumer — แสดงด้วย props เชิงโครงสร้าง (คอลัมน์ + ค่า '—') ไม่มีข้อมูลธุรกิจ" },
  { id: "presentation-form-field", label: "FormField (canonical form field)", path: "presentation/form/FormField.tsx", branch: "main", category: "Component", renderMode: "component", hostKey: "presentation-form-field", notes: "ยังไม่มี consumer" },
  { id: "presentation-form-actions", label: "FormActions (canonical form actions)", path: "presentation/form/FormActions.tsx", branch: "main", category: "Component", renderMode: "component", hostKey: "presentation-form-actions", notes: "ยังไม่มี consumer" },
  { id: "presentation-assets-manifest", label: "Assets — manifest (แผนที่ asset)", path: "presentation/assets/manifest.ts", branch: "main", category: "Component", renderMode: "component", hostKey: "presentation-assets-manifest", notes: "แสดงข้อมูลจริงจาก manifest (URL/ไฟล์/สถานะ/consumer) ไม่ใช่ UI ธุรกิจ" },
  { id: "ai-chat-input", label: "AI — ChatInput", path: "presentation/ai/ChatInput.tsx", branch: "main", category: "Component", renderMode: "component", hostKey: "ai-chat-input", notes: "source ไม่มี header — รอ Owner ประกาศ purpose จากหน้าที่จริง" },
  { id: "ai-chat-message-list", label: "AI — ChatMessageList", path: "presentation/ai/ChatMessageList.tsx", branch: "main", category: "Component", renderMode: "component", hostKey: "ai-chat-message-list", notes: "messages=[] → แสดง empty state จริงของ component เอง" },
  { id: "ai-clarifying-choice", label: "AI — ClarifyingChoice", path: "presentation/ai/ClarifyingChoice.tsx", branch: "main", category: "Component", renderMode: "component", hostKey: "ai-clarifying-choice", notes: "ป้อนค่าตัวอย่างเชิงโครงสร้าง (ไม่ใช่คำถามธุรกิจจริง) และปุ่ม disabled จริง" },
  { id: "ai-confirmation-preview", label: "AI — ConfirmationPreview (Rule 72 gate)", path: "presentation/ai/ConfirmationPreview.tsx", branch: "main", category: "Component", renderMode: "component", hostKey: "ai-confirmation-preview", notes: "ไม่มีปุ่มยืนยัน — มีแต่ลิงก์ไปหน้าแอดมิน (ตามที่ component กำหนด)" },
  { id: "ai-result-card", label: "AI — ResultCard", path: "presentation/ai/ResultCard.tsx", branch: "main", category: "Component", renderMode: "component", hostKey: "ai-result-card" },

];

/**
 * Preset การเปรียบเทียบ (Owner ข้อ 10 — ใช้ preset ที่มีอยู่แล้วจาก Inventory)
 * ทุก id ต้องมีอยู่ใน UI_CATALOG และเป็น renderMode="route" เพื่อเปิด iframe ได้พร้อมกัน
 */
export interface UiComparePreset {
  id: string;
  label: string;
  reason: string;
  itemIds: string[];
}

export const UI_COMPARE_PRESETS: UiComparePreset[] = [
  {
    id: "duplicate-workspaces",
    label: "Workspace ที่ซ้ำกัน (Inventory D1)",
    reason: "ทั้งคู่ใช้ AppShell + IconRail + RAIL_ITEMS ชุดเดียวกัน — ต่างแค่ activeKey (ข้อความ/LINE)",
    itemIds: ["relationship-workspace", "line-customers-workspace"],
  },
  {
    id: "template-vs-real",
    label: "Business Workspace Template vs Workspace จริง",
    reason: "เทียบ UI ต้นแบบ (branch-only, static) กับ Relationship Workspace ที่ใช้ข้อมูลจริงบน main",
    itemIds: ["template-overview", "relationship-workspace"],
  },
  {
    id: "same-shell-roles",
    label: "Shell เดียวกัน 3 บทบาท (business/partner/user)",
    reason: "ทั้งสามใช้ components/workspace/WorkspaceShell ตัวเดียวกัน ต่างแค่ navItems ตามสิทธิ์",
    itemIds: ["layout-business", "layout-partner", "layout-user"],
  },
  {
    id: "owner-vs-engineering",
    label: "Owner Control Center vs Software Factory IDE",
    reason: "เทียบ workspace ของ Owner กับ workspace ของนักพัฒนา (shell/ธีม/ความหนาแน่นต่างกัน)",
    itemIds: ["owner-control-center", "software-factory-ide"],
  },
  {
    id: "canvas-vs-composition",
    label: "Canvas Editor vs Application Composition",
    reason: "สองมุมของการประกอบหน้าจอ: ลาก module เอง กับ ให้ Application Registry ประกอบให้",
    itemIds: ["visual-workspace-canvas", "application-composition"],
  },
  {
    id: "shell-vs-shell",
    label: "Shell 2 แบบที่ใช้ร่วมกัน (AppShell vs WorkspaceShell)",
    reason: "AppShell = 3 คอลัมน์ (มี ListColumn) · WorkspaceShell = rail + top bar เท่านั้น",
    itemIds: ["relationship-workspace", "layout-business"],
  },
  {
    id: "boards",
    label: "Preview boards ของ Workspace",
    reason: "ดูเส้นทาง Board/Presenter ที่มีจริง (debt-widget คือ vertical slice แรก)",
    itemIds: ["preview-debt-widget", "preview-invoice", "preview-material"],
  },
];

// ── PRESENTATION CANONICAL (34 ไฟล์) — กลุ่มสำหรับ Owner review ───────────────
//
// Owner directive 2026-09-22: ก่อนประกาศ presentation/ เป็น UI canonical บน main
// Owner ต้องเห็นของจริงทั้งหมดก่อน — ตารางนี้เป็น "ข้อมูลจัดกลุ่มเพื่อดู" เท่านั้น:
//   - path = ไฟล์จริงใน presentation/ (34 ไฟล์ ณ source ปัจจุบัน)
//   - renderable = มีหน้าจอให้ render จริงผ่าน preview (uiItemId) — ไม่มี mock UI
//   - non-visual = token/config ล้วน → แสดง "ผลที่มันควบคุม" ผ่าน uiItemId ที่ระบุ
// ไม่มี runtime registration, ไม่มี business data, ไม่อ้าง capability ใด ๆ

export type PresentationGroup =
  | "Foundation / Tokens"
  | "Application Shell"
  | "Navigation / Header"
  | "Viewer"
  | "Table"
  | "Form"
  | "Documents"
  | "Panels"
  | "Feedback"
  | "AI"
  | "Assets";

export const PRESENTATION_GROUP_ORDER: PresentationGroup[] = [
  "Foundation / Tokens",
  "Application Shell",
  "Navigation / Header",
  "Viewer",
  "Table",
  "Form",
  "Documents",
  "Panels",
  "Feedback",
  "AI",
  "Assets",
];

export interface PresentationEntry {
  /** ไฟล์จริงใน presentation/ (ตรวจกับ source ปัจจุบัน) */
  path: string;
  group: PresentationGroup;
  kind: "renderable" | "non-visual";
  /** id ใน UI_CATALOG สำหรับเปิด preview (ไฟล์เอง หรือของที่มันควบคุมเมื่อ kind=non-visual) */
  uiItemId: string;
  /** kind=non-visual — สิ่งที่ไฟล์นี้ควบคุม */
  controls?: string;
}

const TOKENS_PREVIEW = "shell-theme-provider";

export const PRESENTATION_CATALOG: PresentationEntry[] = [
  // ── Foundation / Tokens (6) ────────────────────────────────────────────────
  { path: "presentation/foundation/tokens/index.tsx", group: "Foundation / Tokens", kind: "renderable", uiItemId: TOKENS_PREVIEW },
  { path: "presentation/foundation/tokens/colors.ts", group: "Foundation / Tokens", kind: "non-visual", uiItemId: TOKENS_PREVIEW, controls: "สีทั้งชุดของ 2 ธีม (Enterprise Light / Developer Dark)" },
  { path: "presentation/foundation/tokens/typography.ts", group: "Foundation / Tokens", kind: "non-visual", uiItemId: TOKENS_PREVIEW, controls: "ชั้นตัวอักษร heading/body/description + น้ำหนักฟอนต์ที่ใช้ทั้งระบบ" },
  { path: "presentation/foundation/tokens/spacing.ts", group: "Foundation / Tokens", kind: "non-visual", uiItemId: TOKENS_PREVIEW, controls: "จังหวะแนวตั้งและความกว้าง container ของหน้า" },
  { path: "presentation/foundation/tokens/elevation.ts", group: "Foundation / Tokens", kind: "non-visual", uiItemId: TOKENS_PREVIEW, controls: "5 ชั้นพื้นผิว (background→section→card→interactive→floating) + เงา/เส้นขอบ" },
  { path: "presentation/foundation/tokens/semantic-colors.ts", group: "Foundation / Tokens", kind: "non-visual", uiItemId: TOKENS_PREVIEW, controls: "สีสถานะ success/warning/error/info (text/chip/dot)" },

  // ── Application Shell (5) ──────────────────────────────────────────────────
  { path: "presentation/shell/AppShell.tsx", group: "Application Shell", kind: "renderable", uiItemId: "shell-app-shell" },
  { path: "presentation/shell/PortalShell.tsx", group: "Application Shell", kind: "renderable", uiItemId: "shell-portal-shell" },
  { path: "presentation/shell/TemplateShell.tsx", group: "Application Shell", kind: "renderable", uiItemId: "shell-template-shell" },
  { path: "presentation/shell/workspace/DashboardBoard.tsx", group: "Application Shell", kind: "renderable", uiItemId: "board-dashboard-board" },
  { path: "presentation/shell/workspace/NotImplementedBoard.tsx", group: "Application Shell", kind: "renderable", uiItemId: "board-not-implemented" },

  // ── Navigation / Header (2 — ONE NAVIGATION: AppHeader/HomeBackBar ถูกลบแล้ว) ──
  { path: "presentation/shell/navigation/IconRail.tsx", group: "Navigation / Header", kind: "renderable", uiItemId: "sidebar-icon-rail" },
  { path: "presentation/shell/navigation/ListColumn.tsx", group: "Navigation / Header", kind: "renderable", uiItemId: "sidebar-list-column" },

  // ── Viewer (3) ─────────────────────────────────────────────────────────────
  { path: "presentation/viewer/Viewer.tsx", group: "Viewer", kind: "renderable", uiItemId: "presentation-viewer" },
  { path: "presentation/viewer/MapView.tsx", group: "Viewer", kind: "renderable", uiItemId: "comp-map-view" },
  { path: "presentation/viewer/FlexPreview.tsx", group: "Viewer", kind: "renderable", uiItemId: "comp-flex-preview" },

  // ── Table (1) ──────────────────────────────────────────────────────────────
  { path: "presentation/table/DataTable.tsx", group: "Table", kind: "renderable", uiItemId: "presentation-data-table" },

  // ── Form (2) ───────────────────────────────────────────────────────────────
  { path: "presentation/form/FormField.tsx", group: "Form", kind: "renderable", uiItemId: "presentation-form-field" },
  { path: "presentation/form/FormActions.tsx", group: "Form", kind: "renderable", uiItemId: "presentation-form-actions" },

  // ── Documents (1) ──────────────────────────────────────────────────────────
  { path: "presentation/documents/FileUpload.tsx", group: "Documents", kind: "renderable", uiItemId: "comp-file-upload" },

  // ── Panels (3) ─────────────────────────────────────────────────────────────
  { path: "presentation/panels/Inspector.tsx", group: "Panels", kind: "renderable", uiItemId: "panel-inspector" },
  { path: "presentation/panels/ActionBar.tsx", group: "Panels", kind: "renderable", uiItemId: "comp-action-bar" },
  { path: "presentation/panels/Window.tsx", group: "Panels", kind: "renderable", uiItemId: "comp-window" },

  // ── Feedback (3) ───────────────────────────────────────────────────────────
  { path: "presentation/feedback/EmptyState.tsx", group: "Feedback", kind: "renderable", uiItemId: "comp-empty-state" },
  { path: "presentation/feedback/CapabilitySkeleton.tsx", group: "Feedback", kind: "renderable", uiItemId: "comp-capability-skeleton" },
  { path: "presentation/feedback/CopyButton.tsx", group: "Feedback", kind: "renderable", uiItemId: "comp-copy-button" },

  // ── AI (5) ─────────────────────────────────────────────────────────────────
  { path: "presentation/ai/ChatInput.tsx", group: "AI", kind: "renderable", uiItemId: "ai-chat-input" },
  { path: "presentation/ai/ChatMessageList.tsx", group: "AI", kind: "renderable", uiItemId: "ai-chat-message-list" },
  { path: "presentation/ai/ClarifyingChoice.tsx", group: "AI", kind: "renderable", uiItemId: "ai-clarifying-choice" },
  { path: "presentation/ai/ConfirmationPreview.tsx", group: "AI", kind: "renderable", uiItemId: "ai-confirmation-preview" },
  { path: "presentation/ai/ResultCard.tsx", group: "AI", kind: "renderable", uiItemId: "ai-result-card" },

  // ── Assets (1) ─────────────────────────────────────────────────────────────
  { path: "presentation/assets/manifest.ts", group: "Assets", kind: "renderable", uiItemId: "presentation-assets-manifest" },
];

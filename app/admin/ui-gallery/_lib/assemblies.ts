// UI Gallery — assemblies.ts
//
// "ประกอบหน้าจอ" — รายการรูปแบบหน้าจอที่ประกอบจาก component จริงที่มีอยู่ใน repo
// ไฟล์นี้เป็น "ข้อมูล" ล้วน (ไม่มี React, ไม่มี I/O, ไม่มี business logic):
//   - componentsUsed  : ชื่อ component จริงที่ถูกประกอบ
//   - sourceEvidence  : call site จริงใน source ที่พิสูจน์ว่า component เหล่านี้เคยอยู่ด้วยกัน
//   - availableActions: action ที่ทำงานได้จริงตอนนี้ (client state ของ component เอง)
//   - notWiredActions : action ที่ยังไม่มี backend/ข้อมูลจริง → แสดงปุ่มจริงแต่ disable หรือระบุไว้
// ไม่มี mock product, ไม่มี design system ใหม่, ไม่มี capability mapping, ไม่มีข้อมูลธุรกิจปลอม

export interface AssemblySpec {
  id: string;
  name: string;
  /** หนึ่งบรรทัดว่าชุดนี้คือหน้าจอแบบไหน */
  entry: string;
  componentsUsed: string[];
  /** call site จริงใน source — หลักฐานว่า component เหล่านี้ประกอบกันได้จริง */
  sourceEvidence: string[];
  availableActions: string[];
  notWiredActions: string[];
  /** route จริงที่เปิดเทียบได้จากชุดนี้ */
  routePreview?: { label: string; route: string }[];
}

export const ASSEMBLIES: AssemblySpec[] = [
  {
    id: "application-shell",
    name: "1 · Application Shell",
    entry: "navigation + header + workspace + inspector/panel (โครง 3 คอลัมน์แบบ LINE)",
    componentsUsed: ["AppShell", "IconRail", "ListColumn", "ActionBar", "Inspector", "EmptyState"],
    sourceEvidence: [
      "app/admin/line-customers/page.tsx:486 (<AppShell>)",
      "app/admin/line-customers/page.tsx:671 (<ActionBar>)",
      "app/admin/relationships/workspace.tsx:1215 (<AppShell>)",
      "app/admin/relationships/workspace.tsx:1481 (<Inspector>)",
    ],
    availableActions: [
      "สลับ rail ซ้าย (IconRail — client state จริง)",
      "พับ/กาง ListColumn (ปุ่มของ component เอง)",
      "ค้นหาใน ListColumn (ช่องค้นหาจริงของ component)",
      "ปิด Inspector (onClose ของ component)",
    ],
    notWiredActions: [
      "ปุ่มใน ActionBar ทุกตัว (ไม่มี backend — disable ไว้)",
      "รายการใน ListColumn (ไม่มีข้อมูลจริง — แสดง EmptyState จริงของ component)",
    ],
    routePreview: [{ label: "Relationship Workspace (route จริง)", route: "/admin/relationships" }],
  },
  {
    id: "workspace-board",
    name: "2 · Workspace + Board",
    entry: "shell + action controls + main work area ที่ RenderModel ขับ (ผ่าน board router จริง)",
    componentsUsed: ["AppShell", "DashboardBoard", "NotImplementedBoard", "resolveBoard()", "EMPTY_RENDER_MODEL"],
    sourceEvidence: [
      "core/workspace/boardRouter.ts:4-5 (import board จริง 2 ตัว)",
      "app/workspace-preview/apps/[appId]/page.tsx:6 (<DashboardBoard>)",
      "app/workspace-preview/WorkspacePreviewClient.tsx:24 (<Canvas initialLayout=…>)",
    ],
    availableActions: ["สลับ board type ผ่าน resolveBoard() จริง (dashboard/business/finance/partner/mobile)"],
    notWiredActions: ["ข้อมูลใน board — EMPTY_RENDER_MODEL เท่านั้น (ไม่ประดิษฐ์ข้อมูล)"],
    routePreview: [{ label: "Visual Workspace Canvas (route จริง)", route: "/workspace-preview" }],
  },
  {
    id: "viewer-workspace",
    name: "3 · Viewer Workspace",
    entry: "action bar + Viewer + inspector/panel",
    componentsUsed: ["Viewer", "ActionBar", "Inspector", "EmptyState"],
    sourceEvidence: [
      "presentation/viewer/Viewer.tsx (mirror ของ components/documents/DocumentPreview.tsx:43)",
      "app/admin/relationships/workspace.tsx:1461 + :1481 (ActionBar + Inspector อยู่ด้วยกันจริง)",
    ],
    availableActions: [
      "สลับ kind = text / document / image (props จริงของ Viewer)",
      "ปรับ zoom prop ที่ component รับ",
      "ปิด Inspector",
    ],
    notWiredActions: [
      "kind=\"pdf\" — ไม่มี PDF viewer ในระบบ (component แจ้งเองตรง ๆ)",
      "kind=\"document\" ต้องมี HTML ที่ engine สร้างแล้ว (ต้องมี draft จริง) → แสดง empty state",
    ],
    routePreview: [{ label: "workspace-preview/document (route จริง)", route: "/workspace-preview/document" }],
  },
  {
    id: "table-workspace",
    name: "4 · Table Workspace",
    entry: "action bar + DataTable + selection + inspector",
    componentsUsed: ["DataTable", "ActionBar", "Inspector", "EmptyState"],
    sourceEvidence: [
      "presentation/table/DataTable.tsx (requirement §6 ของ UI_PRESENTATION_BOUNDARY_PLAN.md — 13 ไฟล์ตารางเดิม)",
      "app/admin/line-customers/page.tsx:671 (<ActionBar> กับตาราง/list อยู่ด้วยกันจริง)",
    ],
    availableActions: [
      "กดหัวคอลัมน์เพื่อเรียง (sort state จริงของ DataTable)",
      "เลือกแถว (selection state จริง → ส่งต่อไป Inspector)",
      "สลับ rows=[] เพื่อดู empty state จริง",
    ],
    notWiredActions: [
      "ช่องค้นหา/ตัวกรอง — ของจริงอยู่ใน ListColumn (ชุดที่ 1) ไม่ยัดเข้า DataTable",
      "ปุ่มใน ActionBar (ไม่มี backend)",
    ],
    routePreview: [{ label: "Admin relationships (route จริง)", route: "/admin/relationships" }],
  },
  {
    id: "form-workspace",
    name: "5 · Form Workspace",
    entry: "FormField + FormActions + panel ที่แสดงค่าที่กรอก (ไม่มี backend)",
    componentsUsed: ["FormField", "FormActions", "Inspector", "EmptyState"],
    sourceEvidence: [
      "presentation/form/FormField.tsx + presentation/form/FormActions.tsx (requirement §7)",
      "components/documents/DocumentBuilder.tsx:568 (รูปแบบ form + panel ที่ source ใช้จริง)",
    ],
    availableActions: [
      "พิมพ์ในช่องได้จริง (client state)",
      "สลับ state required / hint / error ของ FormField",
      "ปิด Inspector",
    ],
    notWiredActions: ["ปุ่ม Save/Submit (ไม่มี endpoint — disable ไว้)", "validation จริง (อยู่ใน engines/ นอกขอบเขต)"],
    routePreview: [{ label: "create-document (route จริง — ต้อง login)", route: "/admin/create-document" }],
  },
  {
    id: "document-workspace",
    name: "6 · Document Workspace",
    entry: "document component + FileUpload + preview/viewer + document actions",
    componentsUsed: ["FileUpload", "Viewer", "ActionBar", "EmptyState"],
    sourceEvidence: [
      "components/documents/DocumentBuilder.tsx:568 (<FileUpload documentId=… files=… onChange=…>)",
      "components/documents/DocumentPreview.tsx:43 (iframe srcdoc = วิธี render เอกสารจริง)",
      "app/download/page.tsx:24 (<CopyButton text={cmd} />)",
    ],
    availableActions: ["แนบไฟล์จริง (component อัปโหลดจริง — ระวัง)", "สลับ preview เป็น kind=document เพื่อดู empty state"],
    notWiredActions: [
      "DocumentBuilder / DocumentPreview เต็มตัว — ต้องมี draft + CompanySettings จริง (mixed boundary: engines/documents/*)",
      "พิมพ์/บันทึก/ยืนยันเอกสาร — ไม่มี backend ในชุดนี้",
    ],
    routePreview: [{ label: "create-document (route จริง — ต้อง login)", route: "/admin/create-document" }],
  },
  {
    id: "ai-workspace",
    name: "7 · AI / Communication Workspace",
    entry: "ChatMessageList + ChatInput + ClarifyingChoice + ConfirmationPreview + ResultCard ตาม flow จริงของ playground",
    componentsUsed: ["ChatMessageList", "ChatInput", "ClarifyingChoice", "ConfirmationPreview", "ResultCard"],
    sourceEvidence: [
      "app/playground/page.tsx:340 (<ChatMessageList messages=… activeClarifyId=… onChoose=… running=…>)",
      "app/playground/page.tsx:353 (<ChatInput onSend=… disabled=…>)",
      "presentation/ai/ChatMessageList.tsx:2-4 (import ResultCard / ClarifyingChoice / ConfirmationPreview เอง)",
    ],
    availableActions: ["พิมพ์แล้วส่ง — ข้อความของ Owner จะเข้าลิสต์จริง (ข้อความมาจาก Owner ไม่ใช่ข้อมูลที่แต่งขึ้น)"],
    notWiredActions: [
      "การตอบกลับ / เรียก /api/v1/query — ไม่มี backend ในชุดนี้ (ไม่ประดิษฐ์คำตอบ)",
      "การยืนยันคำสั่ง — ConfirmationPreview เป็น Rule-72 gate UI มีแต่ลิงก์ไปหน้าแอดมิน",
    ],
    routePreview: [{ label: "/playground (route จริง)", route: "/playground" }],
  },
  {
    id: "template-suite",
    name: "8 · Business Workspace Template (ชุดเดียว 4 หน้า)",
    entry: "overview + workspace + tasks + documents — เห็นเป็นชุดเดียว ไม่ใช่การ์ดแยกกัน",
    componentsUsed: ["TemplateShell", "Panel", "StatusPill"],
    sourceEvidence: [
      "app/business-workspace-template/overview/page.tsx:10",
      "app/business-workspace-template/workspace/page.tsx:10",
      "app/business-workspace-template/tasks/page.tsx:10",
      "app/business-workspace-template/documents/page.tsx:10",
    ],
    availableActions: ["สลับ 4 หน้าในชุดเดียวกัน (iframe ของ route จริงทั้ง 4)"],
    notWiredActions: ["เนื้อหาในแต่ละหน้า — โครงสร้างล้วน ไม่มีข้อมูลธุรกิจ (ตัด sample data ออกแล้ว)"],
    routePreview: [
      { label: "overview", route: "/business-workspace-template/overview" },
      { label: "workspace", route: "/business-workspace-template/workspace" },
      { label: "tasks", route: "/business-workspace-template/tasks" },
      { label: "documents", route: "/business-workspace-template/documents" },
    ],
  },
  {
    id: "admin-owner-workspace",
    name: "9 · Admin / Owner Workspace",
    entry: "WorkspaceShell + พื้นที่งาน (ONE NAVIGATION: แถบ Back/Home ถูกลบแล้ว)",
    componentsUsed: ["WorkspaceShell", "EmptyState", "resolveNavItems()"],
    sourceEvidence: [
      "app/business/layout.tsx:24 (<WorkspaceShell> — ใช้ร่วม business/user/partner)",
      "app/user/layout.tsx:20 และ app/partner/layout.tsx:16 (<WorkspaceShell>)",
    ],
    availableActions: [
      "สลับ active nav item ของ WorkspaceShell",
    ],
    notWiredActions: [
      "LogoutButton ไม่ถูกประกอบในชุดนี้ (sign out จริง — ไม่ควรกดพลาดระหว่าง review)",
      "เนื้อหาหน้า admin จริง (ต้อง login)",
    ],
    routePreview: [{ label: "business (route จริง — ต้อง login)", route: "/business" }],
  },
  {
    id: "portal-capability",
    name: "10 · Portal / Capability Shell",
    entry: "PortalShell + CopyButton + CapabilitySkeleton",
    componentsUsed: ["PortalShell", "CopyButton", "CapabilitySkeleton"],
    sourceEvidence: [
      "app/download/page.tsx:9 (<PortalShell portalId=\"download_center\">)",
      "app/download/page.tsx:24 (<CopyButton text={cmd} />)",
      "app/products/loading.tsx:4 (<CapabilitySkeleton cards={6} />)",
    ],
    availableActions: ["คัดลอกข้อความด้วย CopyButton จริง", "สลับโหมด Portal (portalId) / Capability (title + description)"],
    notWiredActions: ["เนื้อหา portal จริงจาก registry — ชุดนี้แสดง empty state ของ shell"],
    routePreview: [{ label: "/download (route จริง)", route: "/download" }],
  },
  {
    id: "canvas-workspace",
    name: "11 · Canvas Workspace",
    entry: "Canvas จริง + palette/inspector ที่ source มี (layout จาก workspaceLayoutStore.createEmpty())",
    componentsUsed: ["Canvas", "ModulePalette", "PropertyInspector", "ModuleInspector", "workspaceLayoutStore.createEmpty()"],
    sourceEvidence: [
      "app/workspace-preview/WorkspacePreviewClient.tsx:24 (<Canvas initialLayout={layout} />)",
      "core/workspace/workspaceLayout.ts (createEmpty — layout จริง ไม่ได้ประดิษฐ์)",
    ],
    availableActions: ["ลาก/ซูม/เลือก node ใน Canvas จริง", "ใช้ palette ที่ source มี"],
    notWiredActions: ["การบันทึก layout ลง store/server"],
    routePreview: [{ label: "/workspace-preview (route จริง)", route: "/workspace-preview" }],
  },
];

export function getAssembly(id: string | null | undefined): AssemblySpec | undefined {
  if (!id) return undefined;
  return ASSEMBLIES.find((a) => a.id === id);
}

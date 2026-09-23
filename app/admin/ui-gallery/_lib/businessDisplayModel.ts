/**
 * BUSINESS DISPLAY MODEL — DATA → DISPLAY MODEL → RENDER
 *
 * หลักการ: ใช้ display/rendering principles แบบ work tool/IDE กับข้อมูลธุรกิจ
 *   - ไม่ได้ embed VS Code · ไม่ได้ copy source · ไม่ได้ทำ code editor สำหรับผู้ใช้ธุรกิจ
 *   - reuse "หลักการแสดงผล" เท่านั้น: line rhythm · indent · tree · diff · problem · reference
 *   - renderer ตัวเดียวสร้างทุกอย่างจากข้อมูล (ไม่วาด layout เฉพาะรายการทีละตัว)
 *
 * ไฟล์นี้เป็น *ข้อมูล + ชนิดข้อมูล* เท่านั้น (ไม่มี business logic · ไม่มี scanner · ไม่มี validation)
 * ตัวอย่างทั้งหมดเป็น "โครงสร้าง" (structural) ไม่ใช่ข้อมูลธุรกิจจริง
 */

// ── ชนิดข้อมูลของ display model ──────────────────────────────────────────────

export type Tone = "default" | "success" | "warning" | "danger" | "muted";

export interface TextLine {
  kind: "text";
  id: string;
  text: string;
  tone?: Tone;
  mono?: boolean;
}

export interface FieldRow {
  kind: "field";
  id: string;
  label: string;
  value: string;
  tone?: Tone;
  /** ค่าเดิม → ค่าใหม่ (ใช้กับ diff ได้) */
  before?: string;
  after?: string;
}

export interface TreeItem {
  kind: "tree";
  id: string;
  label: string;
  depth: number;
  expandable?: boolean;
  expanded?: boolean;
  selected?: boolean;
  badge?: number;
  tone?: Tone;
  /** เส้นทางอ้างอิงของรายการ (ใช้เป็น reference/link) */
  ref?: string;
}

export interface GroupItem {
  kind: "group";
  id: string;
  label: string;
  count?: number;
  expanded?: boolean;
  tone?: Tone;
}

export interface SeparatorItem {
  kind: "separator";
  id: string;
  label?: string;
}

export interface BadgeItem {
  kind: "badge";
  id: string;
  label: string;
  tone?: Tone;
}

export interface ProblemItem {
  kind: "problem";
  id: string;
  severity: "error" | "warning" | "info";
  message: string;
  source: string;
  /** ตำแหน่งอ้างอิง (path/บรรทัด/คอลัมน์) — ใช้เปิดของจริงในอนาคต */
  location?: string;
}

export interface DiffItem {
  kind: "diff";
  id: string;
  label: string;
  before: string;
  after: string;
  state: "changed" | "missing" | "added";
}

export interface SearchHitItem {
  kind: "search";
  id: string;
  source: string;
  line: number;
  text: string;
  /** ช่วงที่ match (start,length) — display model เป็นเจ้าของ ไม่ใช่ renderer */
  match?: { start: number; length: number };
}

export interface ReferenceItem {
  kind: "reference";
  id: string;
  label: string;
  target: string;
  tone?: Tone;
}

export type DisplayItem =
  | TextLine
  | FieldRow
  | TreeItem
  | GroupItem
  | SeparatorItem
  | BadgeItem
  | ProblemItem
  | DiffItem
  | SearchHitItem
  | ReferenceItem;

export type DisplayBlock =
  | { kind: "lines"; id: string; title?: string; items: DisplayItem[] }
  | { kind: "tree"; id: string; title?: string; items: TreeItem[] }
  | { kind: "fields"; id: string; title?: string; fields: FieldRow[]; groupLabel?: string }
  | { kind: "table"; id: string; title?: string; columns: { key: string; label: string }[]; rows: string[][] }
  | { kind: "diff"; id: string; title?: string; items: DiffItem[] }
  | { kind: "problems"; id: string; title?: string; items: ProblemItem[] }
  | { kind: "search"; id: string; title?: string; items: SearchHitItem[] }
  | { kind: "references"; id: string; title?: string; items: ReferenceItem[] }
  | { kind: "document"; id: string; title?: string; html: string }
  | { kind: "conversation"; id: string; title?: string; messages: { id: string; role: "user" | "assistant"; text: string }[] };

export interface BusinessDisplayModel {
  id: string;
  title: string;
  /** ชนิดงานที่ display model นี้แทน (จาก Business Domain) */
  domain: string;
  blocks: DisplayBlock[];
}


// ── DISPLAY_PRIMITIVE_MAPPING (จาก SEARCH ของเดิมเท่านั้น) ────────────────────
//
// REUSE_DIRECT = ใช้ component เดิมได้ทันที
// ADAPT_ONLY   = มีของเดิมแต่ต้องประกอบที่ชั้น compose (ไม่แก้ตัว primitive)
// MIXED        = มี implementation จริง แต่ฝังในไฟล์ MIXED_BOUNDARY และไม่ export
//                → import ไม่ได้ ถ้าจะดึงออกต้อง refactor (ต้องให้ Owner อนุมัติ)
// MISSING      = ไม่พบของเดิม

export type MappingState = "REUSE_DIRECT" | "ADAPT_ONLY" | "MIXED" | "MISSING";

export interface PrimitiveMapping {
  businessDisplay: string;
  existingComponent: string;
  existingBehavior: string;
  state: MappingState;
  evidence: string;
  note?: string;
}

export const DISPLAY_PRIMITIVE_MAPPING: PrimitiveMapping[] = [
  {
    businessDisplay: "TEXT / LINE",
    existingComponent: 'presentation/viewer/Viewer (kind="text") · presentation/ai/ChatMessageList',
    existingBehavior: "บรรทัดข้อความ mono/wrap · ข้อความในเธรดพร้อม meta",
    state: "REUSE_DIRECT",
    evidence: "presentation/viewer/Viewer.tsx · presentation/ai/ChatMessageList.tsx",
  },
  {
    businessDisplay: "ROW",
    existingComponent: "presentation/panels/Inspector (InspectorField {label,value,tone})",
    existingBehavior: "แถว label → value + tone สี",
    state: "REUSE_DIRECT",
    evidence: "presentation/panels/Inspector.tsx:11",
  },
  {
    businessDisplay: "COLUMN / TABLE",
    existingComponent: "presentation/table/DataTable",
    existingBehavior: "columns(align,width,sortable) · rows · renderCell · sort · activeId · emptyMessage",
    state: "REUSE_DIRECT",
    evidence: "presentation/table/DataTable.tsx (DataTableProps)",
  },
  {
    businessDisplay: "SELECTION",
    existingComponent: "DataTable.activeId · ListColumn.activeId",
    existingBehavior: "เลือกได้ทีละรายการ (หลักฐานเดิม: ListColumn.activeId)",
    state: "REUSE_DIRECT",
    evidence: "presentation/table/DataTable.tsx · presentation/shell/navigation/ListColumn.tsx",
  },
  {
    businessDisplay: "HOVER",
    existingComponent: "Tailwind classes ในทุก primitive (hover:bg-…)",
    existingBehavior: "hover state มาตรฐานของแถว/ปุ่ม",
    state: "REUSE_DIRECT",
    evidence: "ทุกไฟล์ใน presentation/",
  },
  {
    businessDisplay: "BADGE",
    existingComponent: "ListColumnItem.badge · IconRailItem.badge",
    existingBehavior: "ตัวเลขบนรายการ/บน rail",
    state: "REUSE_DIRECT",
    evidence: "presentation/shell/navigation/{ListColumn,IconRail}.tsx",
  },
  {
    businessDisplay: "STATUS",
    existingComponent: "InspectorField.tone + foundation/tokens (semanticColors)",
    existingBehavior: "สีข้อความตามสถานะ + chip/dot",
    state: "REUSE_DIRECT",
    evidence: "presentation/panels/Inspector.tsx:18 · presentation/foundation/tokens/semantic-colors.ts",
  },
  {
    businessDisplay: "SCROLL",
    existingComponent: "ทุก primitive มี overflow-y-auto ในตัวเอง",
    existingBehavior: "scroll ภายในพื้นที่ของตัวเอง ไม่ดันทั้งหน้า",
    state: "REUSE_DIRECT",
    evidence: "presentation/panels/Window.tsx:64 · ListColumn · DataTable",
  },
  {
    businessDisplay: "PREVIEW",
    existingComponent: "viewer/Viewer (toolbar/zoom) · FlexPreview · MapView · panels/Window",
    existingBehavior: "iframe/text/image + toolbar ที่ผู้เรียกเป็นเจ้าของ",
    state: "REUSE_DIRECT",
    evidence: "presentation/viewer/{Viewer,FlexPreview,MapView}.tsx",
  },
  {
    businessDisplay: "CONVERSATION",
    existingComponent: "presentation/ai/{ChatMessageList,ChatInput,ClarifyingChoice,ConfirmationPreview,ResultCard}",
    existingBehavior: "เธรดข้อความ + ช่องพิมพ์ + บล็อกยืนยัน/ผลลัพธ์",
    state: "REUSE_DIRECT",
    evidence: "presentation/ai/*",
  },
  {
    businessDisplay: "SECTION / GROUP / SEPARATOR",
    existingComponent: "panels/Window (header title+subtitle + border-b) · tokens (border/spacing)",
    existingBehavior: "หัวข้อ + เส้นคั่นบาง · ไม่ใช้ card ใหญ่",
    state: "ADAPT_ONLY",
    evidence: "presentation/panels/Window.tsx:46-63 · presentation/foundation/tokens/spacing.ts",
  },
  {
    businessDisplay: "SPLIT / RESIZE",
    existingComponent: "ListColumn width states (full 300 / compact 64 / hidden 0 + localStorage) · Window width",
    existingBehavior: "ย่อ/ขยาย/ซ่อนคอลัมน์ และกำหนดความกว้าง panel ได้",
    state: "ADAPT_ONLY",
    evidence: "presentation/shell/navigation/ListColumn.tsx:32 (WIDTH_PX, STORAGE_KEY)",
    note: "ไม่มี split divider ที่ลากปรับได้ในชั้น presentation",
  },
  {
    businessDisplay: "SEARCH (กล่องค้นหา)",
    existingComponent: "ListColumn (ช่องค้นหา + placeholder ในตัว)",
    existingBehavior: "ช่องค้นหา; การกรองเป็นของผู้เรียก (component ไม่กรองเอง)",
    state: "ADAPT_ONLY",
    evidence: "presentation/shell/navigation/ListColumn.tsx:39,95-100",
  },
  {
    businessDisplay: "TREE (EXPAND / COLLAPSE + INDENT)",
    existingComponent: "IDEWorkspace :: TreeNode (depth, expanded, ChevronRight/Down)",
    existingBehavior: "ต้นไม้หลายระดับ + กาง/พับ + เลือกได้",
    state: "MIXED",
    evidence: "components/ide-shell/IDEWorkspace.tsx:1746 (ไม่ export · ไฟล์ 5,976 บรรทัด = MIXED_BOUNDARY)",
    note: "ของเดิมมีจริงแต่ import ไม่ได้ — รอบนี้ compose ที่ชั้น display จาก primitive ที่มีอยู่",
  },
  {
    businessDisplay: "DIFF (เดิม → ใหม่)",
    existingComponent: "IDEWorkspace :: DiskVsEditorDiff (:2988) · DiffPane (:3017)",
    existingBehavior: "เทียบสองฝั่ง แสดงบรรทัดเพิ่ม-ลบ",
    state: "MIXED",
    evidence: "components/ide-shell/IDEWorkspace.tsx:2988,3017 (ไม่ export)",
    note: "ไม่ดึง logic diff มาใช้ — display model รับ before/after ที่ผู้เรียกเตรียมแล้ว",
  },
  {
    businessDisplay: "PROBLEMS PANEL (รวมรายการ)",
    existingComponent: "IDEWorkspace :: ProblemsPanel (:3687 · onOpenFinding(path,line,column))",
    existingBehavior: "รายการปัญหา + เปิดไปยังตำแหน่งจริงได้",
    state: "MIXED",
    evidence: "components/ide-shell/IDEWorkspace.tsx:3687 · app/api/admin/ide/_lib/problems.ts (reader เดิม)",
  },
  {
    businessDisplay: "TAB / TABSTRIP",
    existingComponent: "IDEWorkspace :: TabStrip (:2543 · tabs/activeTabId/onSelect/onClose/dirtyTabIds)",
    existingBehavior: "หลายเอกสารเปิดพร้อมกัน · ปิดได้ · dirty state",
    state: "MIXED",
    evidence: "components/ide-shell/IDEWorkspace.tsx:2543 (ไม่ export)",
    note: "ชั้น presentation ยังไม่มี tab primitive — รอบนี้ compose จาก Window/ActionBar",
  },
  {
    businessDisplay: "SEARCH HIGHLIGHT (เน้นช่วงที่ match)",
    existingComponent: "IDEWorkspace :: SearchPanel (:1844 → ส่ง line/column/matchLength)",
    existingBehavior: "ไฮไลต์ช่วงข้อความที่ตรงคำค้น",
    state: "MIXED",
    evidence: "components/ide-shell/IDEWorkspace.tsx:1844",
    note: "display model เก็บ match{start,length} ไว้แล้ว — รอบนี้ยังแสดงเป็นข้อความธรรมดา",
  },
  {
    businessDisplay: "OUTPUT (Scanner / Validation / Import / Export)",
    existingComponent: "presentation/feedback/{EmptyState,CapabilitySkeleton} · table/DataTable · panels/Inspector",
    existingBehavior: "สถานะว่าง/กำลังโหลด + ตาราง/แถวผลลัพธ์",
    state: "ADAPT_ONLY",
    evidence: "presentation/feedback/* · presentation/table/DataTable.tsx",
    note: "ยังไม่มี primitive output panel เฉพาะ — ประกอบจากตาราง + แถวสถานะ",
  },
  {
    businessDisplay: "WHITE RULE (วัตถุจริงที่เป็นขาว)",
    existingComponent: 'viewer/Viewer (kind="document" · iframe) — container เป็นสีขาวตามต้นฉบับ',
    existingBehavior: "เอกสาร PDF/A4/ฟอร์ม oficial แสดงเป็นพื้นที่ขาวจริง; ส่วนอื่นใช้ workspace background",
    state: "ADAPT_ONLY",
    evidence: "presentation/viewer/Viewer.tsx:140 (container bg-white + border)",

// ── ตัวอย่างเชิงโครงสร้าง (structural) สำหรับหน้าจอ review ───────────────────
// ไม่ใช่ข้อมูลธุรกิจจริง · ไม่มี logic · ใช้พิสูจน์ว่า display model ทำงานได้
    note: "รายการ/tree/search/chat/scanner ต้องอยู่บน workspace background ไม่ใช่ขาว",
  },
];

export const MAPPING_SUMMARY = {
  total: DISPLAY_PRIMITIVE_MAPPING.length,
  reuseDirect: DISPLAY_PRIMITIVE_MAPPING.filter((m) => m.state === "REUSE_DIRECT").length,
  adaptOnly: DISPLAY_PRIMITIVE_MAPPING.filter((m) => m.state === "ADAPT_ONLY").length,
  mixedBoundary: DISPLAY_PRIMITIVE_MAPPING.filter((m) => m.state === "MIXED").length,
  missing: DISPLAY_PRIMITIVE_MAPPING.filter((m) => m.state === "MISSING").length,
};

// ── ตัวอย่างเชิงโครงสร้าง (structural) สำหรับหน้าจอ review ───────────────────
// ไม่ใช่ข้อมูลธุรกิจจริง · ไม่มี logic · ใช้พิสูจน์ว่า display model ทำงานได้

export const SAMPLE_DISPLAY_MODELS: BusinessDisplayModel[] = [
  {
    id: "1-business-file-tree",
    title: "1 · Business File Tree",
    domain: "Source Tree → โครงสร้างข้อมูล/เอกสารธุรกิจ",
    blocks: [
      {
        kind: "tree",
        id: "t1",
        title: "เอกสารธุรกิจ (ตัวอย่างโครงสร้าง)",
        items: [
          { kind: "tree", id: "t1a", label: "เอกสารขาย", depth: 0, expandable: true, expanded: true, badge: 3 },
          { kind: "tree", id: "t1b", label: "ใบเสนอราคา", depth: 1, badge: 1 },
          { kind: "tree", id: "t1c", label: "ใบแจ้งหนี้", depth: 1, selected: true },
          { kind: "tree", id: "t1d", label: "ใบเสร็จ / ใบกำกับภาษี", depth: 1, tone: "muted" },
          { kind: "tree", id: "t1e", label: "เอกสารซื้อ", depth: 0, expandable: true, expanded: false, badge: 2 },
          { kind: "tree", id: "t1f", label: "หลักฐาน / แนบ", depth: 0, expandable: true, expanded: true },
          { kind: "tree", id: "t1g", label: "ไม่มีไฟล์แนบ (ว่าง)", depth: 1, tone: "warning" },
        ],
      },
    ],
  },
  {
    id: "2-search-results",
    title: "2 · Search Results (หลายแหล่ง)",
    domain: "Search Results → DNA OS / LINE / Email / Files / Database",
    blocks: [
      { kind: "lines", id: "s2bar", items: [{ kind: "text", id: "s2q", text: "ค้นหา: <คำค้น> (ตัวอย่าง)", mono: true, tone: "muted" }] },
      {
        kind: "search",
        id: "s3",
        title: "ผลลัพธ์ (display model เก็บ match{start,length} ไว้แล้ว — รอบนี้ยังไม่ไฮไลต์)",
        items: [
          { kind: "search", id: "s3a", source: "DNA OS · เอกสาร", line: 12, text: "…พบคำค้นในหัวข้อเอกสาร…", match: { start: 8, length: 6 } },
          { kind: "search", id: "s3b", source: "LINE · บทสนทนา", line: 3, text: "…พบคำค้นในข้อความลูกค้า…", match: { start: 9, length: 6 } },
          { kind: "search", id: "s3c", source: "Email", line: 1, text: "…ไม่มีผลลัพธ์ในชุดนี้…" },
          { kind: "search", id: "s3d", source: "Database · ตาราง", line: 44, text: "…พบคำค้นในคอลัมน์ชื่อ…", match: { start: 8, length: 6 } },
        ],
      },
    ],
  },
  {
    id: "3-document-viewer",
    title: "3 · Document Viewer (WHITE RULE)",
    domain: "Editor View → Document และของจริงที่ควรเป็นขาว",
    blocks: [
      {
        kind: "document",
        id: "d3",
        title: "พื้นที่เอกสารจริง (ขาว) — PDF/A4/ฟอร์ม ใช้สีขาวตามต้นฉบับ",
        html:
          "<div style='font-family:system-ui;padding:28px;color:#44403c'><div style='font-size:13px;font-weight:700'>ตัวอย่างพื้นที่เอกสาร (structural)</div><div style='margin-top:12px;font-size:12px;line-height:1.9'>เลขที่: —<br/>วันที่: —<br/>ผู้ขาย: —<br/>ยอด: —<br/>VAT: —<br/>WHT: —</div><div style='margin-top:16px;border-top:1px solid #e7e5e4;padding-top:8px;font-size:11px;color:#a8a29e'>พื้นที่ขาวจริงตาม WHITE RULE</div></div>",
      },
    ],
  },
  {
    id: "4-scanner-result",
    title: "4 · Structured Scanner Result",
    domain: "Output → Scanner / Validation Result",
    blocks: [
      {
        kind: "fields",
        id: "f4",
        title: "ผลสแกนเอกสาร (ตัวอย่างโครงสร้าง)",
        fields: [
          { kind: "field", id: "f4a", label: "เลขที่", value: "—" },
          { kind: "field", id: "f4b", label: "วันที่", value: "—" },
          { kind: "field", id: "f4c", label: "บริษัท", value: "—", tone: "warning" },
          { kind: "field", id: "f4d", label: "ยอด", value: "—" },
          { kind: "field", id: "f4e", label: "VAT", value: "—", tone: "danger" },
          { kind: "field", id: "f4f", label: "WHT", value: "—" },
          { kind: "field", id: "f4g", label: "หลักฐาน", value: "missing → found", before: "missing", after: "found", tone: "success" },
        ],
      },
      {
        kind: "problems",
        id: "p4",
        title: "Problems (จากผลสแกน)",
        items: [
          { kind: "problem", id: "p4a", severity: "error", message: "VAT ไม่ตรงกับยอด (ตัวอย่าง)", source: "scanner", location: "fields.vat" },
          { kind: "problem", id: "p4b", severity: "warning", message: "ข้อมูลขาด: ชื่อบริษัท (ตัวอย่าง)", source: "scanner", location: "fields.company" },
        ],
      },
      {
        kind: "references",
        id: "r4",
        title: "References",
        items: [
          { kind: "reference", id: "r4a", label: "เอกสารนี้", target: "document://—" },
          { kind: "reference", id: "r4b", label: "ธุรกรรมที่เชื่อม", target: "transaction://—" },
          { kind: "reference", id: "r4c", label: "คู่ค้า", target: "partner://—", tone: "muted" },
        ],
      },
    ],
  },
  {
    id: "5-business-diff",
    title: "5 · Business Diff (เดิม → ใหม่)",
    domain: "Diff → ค่าเดิม ↔ ค่าใหม่",
    blocks: [
      {
        kind: "diff",
        id: "d5",
        title: "การเปลี่ยนแปลง (ตัวอย่าง)",
        items: [
          { kind: "diff", id: "d5a", label: "สถานะการยืนยัน", before: "unverified", after: "verified", state: "changed" },
          { kind: "diff", id: "d5b", label: "หลักฐาน", before: "missing", after: "found", state: "added" },
          { kind: "diff", id: "d5c", label: "ยอดรวม", before: "—", after: "—", state: "changed" },
          { kind: "diff", id: "d5d", label: "เลขที่เอกสาร", before: "—", after: "—", state: "missing" },
        ],
      },
      {
        kind: "lines",
        id: "d5n",
        items: [{ kind: "text", id: "d5n1", text: "display model รับ before/after ที่ผู้เรียกเตรียมแล้ว — ไม่มี logic diff ในชั้นนี้", tone: "muted" }],
      },
    ],
  },
  {
    id: "6-problems-validation",
    title: "6 · Problems / Validation",
    domain: "Problems → เอกสารผิด · ข้อมูลขาด · VAT ผิด · ยอดไม่ตรง",
    blocks: [
      {
        kind: "problems",
        id: "p6",
        title: "รายการปัญหา (ตัวอย่าง โครงสร้าง)",
        items: [
          { kind: "problem", id: "p6a", severity: "error", message: "เอกสารผิด — เลขที่ไม่ตรงรูปแบบ (ตัวอย่าง)", source: "validation", location: "document.number" },
          { kind: "problem", id: "p6b", severity: "warning", message: "ข้อมูลขาด — ไม่มีวันที่ (ตัวอย่าง)", source: "validation", location: "document.date" },
          { kind: "problem", id: "p6c", severity: "warning", message: "ยอดไม่ตรง (ตัวอย่าง)", source: "validation", location: "fields.total" },
          { kind: "problem", id: "p6d", severity: "info", message: "ผ่านการตรวจ (ตัวอย่าง)", source: "validation", location: "fields.wht" },
        ],
      },
      {
        kind: "lines",
        id: "p6s",
        items: [{ kind: "text", id: "p6s1", text: "ยังไม่มี problems panel ใน presentation — ประกอบจากแถวสถานะ (MIXED: IDEWorkspace.ProblemsPanel ไม่ export)", tone: "muted" }],
      },
    ],
  },
  {
    id: "7-table",
    title: "7 · Table",
    domain: "Editor View → Table",
    blocks: [
      {
        kind: "table",
        id: "tb7",
        title: "ตาราง (ตัวอย่างโครงสร้าง · ไม่มีแถวข้อมูลจริง)",
        columns: [
          { key: "a", label: "เลขที่" },
          { key: "b", label: "วันที่" },
          { key: "c", label: "ยอด" },
          { key: "d", label: "สถานะ" },
        ],
        rows: [],
      },
      { kind: "lines", id: "tb7n", items: [{ kind: "text", id: "tb7n1", text: "rows = [] → DataTable ใช้ EmptyState ของเดิม", tone: "muted" }] },
    ],
  },
  {
    id: "8-conversation",
    title: "8 · Conversation",
    domain: "Editor View → Conversation (LINE / AI / Chat)",
    blocks: [
      {
        kind: "conversation",
        id: "cv8",
        title: "บทสนทนา (ตัวอย่างโครงสร้าง)",
        messages: [
          { id: "cv8a", role: "user", text: "ข้อความจากผู้ใช้ (ตัวอย่าง)" },
          { id: "cv8b", role: "assistant", text: "ข้อความตอบกลับ (ตัวอย่าง)" },
        ],
      },
      {
        kind: "lines",
        id: "cv8n",
        items: [{ kind: "text", id: "cv8n1", text: "ใช้ ChatMessageList/ChatInput เดิม — ChatInput แสดงสถานะยังไม่ผูก (disabled)", tone: "muted" }],
      },
    ],
  },
];



/**
 * BUSINESS WORKSPACE — tool registry + เนื้อหาซ้าย/ขวา (หน้าจอจริง /workspace)
 * ประกอบจากของเดิม: icon ชุดที่ระบบใช้จริง · BusinessDisplayModel → BusinessDisplayRenderer (ตัวเดิม)
 * ไม่มี business logic/scanner/renderer ใหม่ · DEV TOOLS ซ่อนจาก business client เท่านั้น (ไม่ลบ)
 */
import {
  FileText, Search, MessageCircle, Cable, GitBranch, AlertTriangle, Clock, Calculator,
  Wallet, Briefcase, Users, Truck, Mountain, Download, Terminal, Bug, Hammer, FlaskConical,
  Settings, Database, Server, BrainCircuit,
} from "lucide-react";
import type { BusinessDisplayModel, DisplayBlock } from "@/app/admin/ui-gallery/_lib/businessDisplayModel";

export interface BusinessTool { key: string; label: string; icon: typeof FileText; leftModel: BusinessDisplayModel }
export interface OpenTarget { id: string; title: string; model: BusinessDisplayModel }

const lines = (id: string, texts: string[]): DisplayBlock => ({
  kind: "lines", id: `b-${id}`,
  items: texts.map((text, i) => ({ kind: "text" as const, id: `${id}-${i}`, text, tone: "muted" as const })),
});
const ti = (id: string, label: string, depth: number, extra: Partial<{ expandable: boolean; expanded: boolean; badge: number; tone: "warning" | "muted" }> = {}) => ({ kind: "tree" as const, id, label, depth, ...extra });
const fi = (id: string, label: string, value: string, tone?: "warning" | "muted" | "success") => ({ kind: "field" as const, id, label, value, tone });

export const TOOLS: BusinessTool[] = [
  { key: "documents", label: "เอกสาร", icon: FileText, leftModel: { id: "left-documents", title: "เอกสาร / ไฟล์", domain: "tree ของเอกสารธุรกิจ (ตัวอย่าง)", blocks: [
    { kind: "tree", id: "doc-tree", items: [
      ti("d-sales", "เอกสารขาย", 0, { expandable: true, expanded: true, badge: 3 }),
      ti("d-quote", "ใบเสนอราคา", 1),
      ti("d-invoice", "ใบแจ้งหนี้", 1, { badge: 1 }),
      ti("d-tax", "ใบกำกับภาษี", 1, { tone: "muted" }),
      ti("d-buy", "เอกสารซื้อ", 0, { expandable: true, expanded: false }),
      ti("d-attach", "หลักฐาน / แนบ", 0, { expandable: true, expanded: true }),
      ti("d-none", "ไม่มีไฟล์แนบ", 1, { tone: "warning" }),
    ] },
  ] } },
  { key: "search", label: "ค้นหา", icon: Search, leftModel: { id: "left-search", title: "ค้นหา", domain: "DNA OS · LINE · Email · Files · Database", blocks: [
    lines("s", ["พิมพ์คำค้นแล้วกด Enter (ตัวอย่าง)"]),
    { kind: "search", id: "sr", items: [
      { kind: "search", id: "sr1", source: "DNA OS · เอกสาร", line: 12, text: "…ผลลัพธ์ตัวอย่าง…", match: { start: 1, length: 6 } },
      { kind: "search", id: "sr2", source: "LINE · บทสนทนา", line: 3, text: "…ผลลัพธ์ตัวอย่าง…", match: { start: 1, length: 6 } },
    ] },
  ] } },
  { key: "chat", label: "ข้อความ / สั่งงาน", icon: MessageCircle, leftModel: { id: "left-chat", title: "ข้อความ / สั่งงาน", domain: "Conversation + command input", blocks: [
    { kind: "conversation", id: "cv", messages: [ { id: "cv1", role: "user", text: "ข้อความตัวอย่าง" }, { id: "cv2", role: "assistant", text: "คำตอบตัวอย่าง" } ] },
  ] } },
  { key: "connections", label: "การเชื่อมต่อ", icon: Cable, leftModel: { id: "left-conn", title: "แหล่งข้อมูลที่เชื่อมต่อ", domain: "Connections (ตัวอย่าง)", blocks: [
    { kind: "fields", id: "c", fields: [ fi("c1", "LINE OA", "—", "warning"), fi("c2", "Supabase", "—"), fi("c3", "Google", "—", "muted"), fi("c4", "Email", "—", "muted") ] },
  ] } },
  { key: "changes", label: "การเปลี่ยนแปลง", icon: GitBranch, leftModel: { id: "left-changes", title: "การเปลี่ยนแปลงข้อมูล", domain: "Diff เดิม → ใหม่", blocks: [
    { kind: "diff", id: "ch", items: [
      { kind: "diff", id: "ch1", label: "สถานะเอกสาร", before: "unverified", after: "verified", state: "changed" },
      { kind: "diff", id: "ch2", label: "หลักฐาน", before: "missing", after: "found", state: "added" },
    ] },
  ] } },
  { key: "problems", label: "ปัญหา / ตรวจสอบ", icon: AlertTriangle, leftModel: { id: "left-problems", title: "ปัญหาที่พบ", domain: "Validation / Problems", blocks: [
    { kind: "problems", id: "pb", items: [
      { kind: "problem", id: "pb1", severity: "error", message: "VAT ไม่ตรงกับยอด (ตัวอย่าง)", source: "validation", location: "fields.vat" },
      { kind: "problem", id: "pb2", severity: "warning", message: "ข้อมูลขาด (ตัวอย่าง)", source: "validation", location: "fields.company" },
    ] },
  ] } },
  { key: "history", label: "ประวัติ", icon: Clock, leftModel: { id: "left-history", title: "ประวัติการทำงาน", domain: "Activity / History", blocks: [lines("h", ["— กิจกรรมล่าสุด (ตัวอย่าง)"])] } },
  { key: "accounting", label: "บัญชี", icon: Calculator, leftModel: { id: "left-acc", title: "บัญชี", domain: "Accounting", blocks: [lines("a", ["— รายการบัญชี (ตัวอย่าง)"])] } },
  { key: "finance", label: "การเงิน", icon: Wallet, leftModel: { id: "left-fin", title: "การเงิน", domain: "Finance", blocks: [lines("f", ["— สรุปการเงิน (ตัวอย่าง)"])] } },
  { key: "jobs", label: "งาน", icon: Briefcase, leftModel: { id: "left-jobs", title: "งาน", domain: "Jobs", blocks: [lines("j", ["— รายการงาน (ตัวอย่าง)"])] } },
  { key: "people", label: "บุคคล / คู่ค้า", icon: Users, leftModel: { id: "left-people", title: "บุคคล / คู่ค้า", domain: "People / Partners", blocks: [lines("p", ["— รายชื่อ (ตัวอย่าง)"])] } },
  { key: "vehicles", label: "ยานพาหนะ", icon: Truck, leftModel: { id: "left-vehicles", title: "ยานพาหนะ", domain: "Vehicles", blocks: [lines("v", ["— รายการรถ (ตัวอย่าง)"])] } },
  { key: "materials", label: "วัสดุ", icon: Mountain, leftModel: { id: "left-mat", title: "วัสดุ", domain: "Materials", blocks: [lines("ml", ["— รายการวัสดุ (ตัวอย่าง)"])] } },
  { key: "transfer", label: "นำเข้า / ส่งออก", icon: Download, leftModel: { id: "left-transfer", title: "นำเข้า / ส่งออก", domain: "Import / Export result", blocks: [lines("t", ["— ผลนำเข้า/ส่งออก (ตัวอย่าง)"])] } },
];


/** ซ่อนจาก business client เท่านั้น — DO NOT DELETE · backend ยังอยู่ที่ /admin/ide ตามเดิม */
export const HIDDEN_DEV_TOOLS = [
  { key: "terminal", label: "Terminal", icon: Terminal },
  { key: "debugger", label: "Debugger", icon: Bug },
  { key: "build", label: "Build", icon: Hammer },
  { key: "test", label: "Test", icon: FlaskConical },
  { key: "git", label: "Raw Git", icon: GitBranch },
  { key: "registry", label: "Raw Registry", icon: Database },
  { key: "mcp", label: "Developer MCP", icon: BrainCircuit },
  { key: "runtime", label: "Runtime Diagnostics", icon: Server },
  { key: "settings", label: "IDE Settings", icon: Settings },
];

/** กดรายการนี้จากซ้าย → เปิด tab ฝั่งขวา (DATA → DISPLAY MODEL → RENDERER เดิม) */
export const OPEN_TARGETS: Record<string, OpenTarget> = {
  "d-invoice": {
    id: "d-invoice",
    title: "ใบแจ้งหนี้ (ตัวอย่าง)",
    model: {
      id: "right-invoice",
      title: "ใบแจ้งหนี้ · ตัวอย่าง",
      domain: "Document → Viewer (พื้นที่ขาว)",
      blocks: [
        { kind: "document", id: "doc", title: "เอกสารจริง (WHITE RULE)", html: "<div style='font-family:system-ui;padding:28px;color:#44403c'><div style='font-size:14px;font-weight:700'>ใบแจ้งหนี้ (ตัวอย่างโครงสร้าง)</div><div style='margin-top:14px;font-size:12.5px;line-height:2'>เลขที่: —<br/>วันที่: —<br/>ผู้ขาย: —<br/>ยอด: —<br/>VAT: —<br/>WHT: —</div></div>" },
        { kind: "fields", id: "f", fields: [ fi("f1", "สถานะ", "—"), fi("f2", "หลักฐาน", "missing → found", "success") ] },
      ],
    },
  },
  "d-sales": {
    id: "d-sales",
    title: "ตารางเอกสารขาย",
    model: { id: "right-table", title: "ตารางเอกสารขาย · ตัวอย่าง", domain: "Table (DataTable)", blocks: [
      { kind: "table", id: "t", columns: [ { key: "a", label: "เลขที่" }, { key: "b", label: "วันที่" }, { key: "c", label: "ยอด" }, { key: "d", label: "สถานะ" } ], rows: [] },
      lines("tn", ["ยังไม่มีแถวข้อมูลจริง — ใช้ EmptyState ของเดิม"]),
    ] },
  },
  "d-attach": {
    id: "d-attach",
    title: "ผลตรวจสอบ (ตัวอย่าง)",
    model: { id: "right-problems", title: "ผลตรวจสอบ · ตัวอย่าง", domain: "Validation → Problems + Diff", blocks: [
      { kind: "problems", id: "p", items: [
        { kind: "problem", id: "p1", severity: "error", message: "ยอดไม่ตรง (ตัวอย่าง)", source: "validation", location: "fields.total" },
        { kind: "problem", id: "p2", severity: "info", message: "ผ่านการตรวจ (ตัวอย่าง)", source: "validation", location: "fields.wht" },
      ] },
      { kind: "diff", id: "d", items: [{ kind: "diff", id: "d1", label: "สถานะ", before: "unverified", after: "verified", state: "changed" }] },
    ] },
  },
  sr1: {
    id: "sr1",
    title: "ผลค้นหา (ตัวอย่าง)",
    model: { id: "right-search", title: "ผลค้นหา · ตัวอย่าง", domain: "Search result", blocks: [
      { kind: "search", id: "s", items: [{ kind: "search", id: "s1", source: "DNA OS · เอกสาร", line: 12, text: "…ผลลัพธ์ตัวอย่าง…", match: { start: 1, length: 6 } }] },
    ] },
  },
  cv: {
    id: "cv",
    title: "บทสนทนา (ตัวอย่าง)",
    model: { id: "right-conv", title: "บทสนทนา · ตัวอย่าง", domain: "Conversation", blocks: [
      { kind: "conversation", id: "c", messages: [ { id: "c1", role: "user", text: "ข้อความตัวอย่าง" }, { id: "c2", role: "assistant", text: "คำตอบตัวอย่าง" } ] },
    ] },
  },
  c1: {
    id: "c1",
    title: "LINE OA (ตัวอย่าง)",
    model: { id: "right-line", title: "LINE OA · ตัวอย่าง", domain: "Connect · interface boundary เท่านั้น", blocks: [
      { kind: "fields", id: "f", fields: [ fi("l1", "สถานะการเชื่อมต่อ", "—", "warning"), fi("l2", "credential", "—"), fi("l3", "webhook", "—") ] },
      lines("ln", ["ยังไม่ผูก runtime จริง — เตรียมขอบเขตไว้รับผลจาก reader/scanner เดิม"]),
    ] },
  },
};

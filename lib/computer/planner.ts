/**
 * Task Planner (2-Layer)
 *
 * Layer 1: Intent Plan  — ภาษาธุรกิจ (เปลี่ยนแอปไม่ต้องแก้)
 * Layer 2: Execution Plan — ภาษาเครื่อง (เปลี่ยนตาม driver)
 *
 * Capability → Intent Plan → Execution Plan → Steps
 *
 * เปลี่ยนจาก LINE → WhatsApp = เปลี่ยนแค่ Execution Plan
 * Intent Plan เหมือนเดิม
 */

import type { CapabilityAction } from "../executor/capability-manager";

// ── Intent Step (ภาษาธุรกิจ) ──

export type IntentAction =
  | "open_app"
  | "find_contact"
  | "open_chat"
  | "compose_message"
  | "send"
  | "verify_delivery"
  | "read_messages"
  | "view_map"
  | "get_route"
  | "search_place"
  | "open_document"
  | "create_document"
  | "export_document"
  | "upload_file"
  | "download_file"
  | "list_files"
  | "query_data"
  | "insert_data"
  | "update_data"
  | "delete_data"
  | "translate"
  | "analyze"
  | "generate"
  | "deploy"
  | "push_code"
  | "check_status"
  | "trigger_webhook"
  | "run_workflow"
  | "compose_email"
  | "send_email"
  | "create_event"
  | "create_invoice"
  | "create_post"
  | "read_feed"
  | "make_call"
  | "close_app";

export interface IntentStep {
  order: number;
  intent: IntentAction;
  description: string;
  args: Record<string, unknown>;
}

export interface IntentPlan {
  capability: CapabilityAction;
  steps: IntentStep[];
  requireConfirm: boolean;
}

// ── Execution Step (ภาษาเครื่อง) ──

export type ExecutionAction =
  | "launch"
  | "focus"
  | "close"
  | "search"
  | "click"
  | "type"
  | "read"
  | "wait"
  | "submit"
  | "report"
  | "open_url"
  | "shortcut"
  | "paste";

export interface ExecutionStep {
  order: number;
  action: ExecutionAction;
  app: string;
  args: Record<string, unknown>;
  description: string;
  fromIntent: IntentAction;
}

export interface TaskPlan {
  capability: CapabilityAction;
  app: string;
  intentPlan: IntentPlan;
  executionSteps: ExecutionStep[];
  requireConfirm: boolean;
  estimatedMs: number;
}

// ── backward compat ──
export type PlannedStep = ExecutionStep;

// ═══════════════════════════════════════════
// Intent Plans (ภาษาธุรกิจ — ไม่ขึ้นกับแอป)
// ═══════════════════════════════════════════

type IntentFactory = (args: Record<string, unknown>) => IntentPlan;

const intents: Record<string, IntentFactory> = {
  "communication.send_message": (args) => ({
    capability: "communication.send_message",
    requireConfirm: true,
    steps: [
      { order: 1, intent: "open_app",         description: "เปิดแอปส่งข้อความ",  args: {} },
      { order: 2, intent: "find_contact",      description: "หาผู้ติดต่อ",        args: { contact: args.contact ?? args.to } },
      { order: 3, intent: "open_chat",         description: "เปิดห้องแชท",        args: {} },
      { order: 4, intent: "compose_message",   description: "เขียนข้อความ",       args: { message: args.message ?? args.text } },
      { order: 5, intent: "send",              description: "ส่งข้อความ",         args: {} },
      { order: 6, intent: "verify_delivery",   description: "ตรวจสอบการส่ง",      args: {} },
    ],
  }),

  "communication.read_message": (args) => ({
    capability: "communication.read_message",
    requireConfirm: false,
    steps: [
      { order: 1, intent: "open_app",       description: "เปิดแอปส่งข้อความ",  args: {} },
      { order: 2, intent: "find_contact",    description: "หาผู้ติดต่อ",        args: { contact: args.contact } },
      { order: 3, intent: "read_messages",   description: "อ่านข้อความ",        args: {} },
    ],
  }),

  "communication.call": (args) => ({
    capability: "communication.call",
    requireConfirm: true,
    steps: [
      { order: 1, intent: "open_app",       description: "เปิดแอปโทร",         args: {} },
      { order: 2, intent: "find_contact",    description: "หาเบอร์",           args: { contact: args.number ?? args.contact } },
      { order: 3, intent: "make_call",       description: "โทร",               args: {} },
    ],
  }),

  "maps.view_location": (args) => ({
    capability: "maps.view_location",
    requireConfirm: false,
    steps: [
      { order: 1, intent: "open_app",    description: "เปิดแผนที่",     args: {} },
      { order: 2, intent: "view_map",    description: "แสดงตำแหน่ง",   args: { lat: args.lat, lng: args.lng } },
    ],
  }),

  "maps.get_directions": (args) => ({
    capability: "maps.get_directions",
    requireConfirm: false,
    steps: [
      { order: 1, intent: "open_app",    description: "เปิดแผนที่",     args: {} },
      { order: 2, intent: "get_route",   description: "หาเส้นทาง",     args: { from: args.from, to: args.to } },
    ],
  }),

  "maps.search_nearby": (args) => ({
    capability: "maps.search_nearby",
    requireConfirm: false,
    steps: [
      { order: 1, intent: "open_app",      description: "เปิดแผนที่",     args: {} },
      { order: 2, intent: "search_place",  description: "ค้นหาสถานที่",   args: { query: args.query } },
    ],
  }),

  "documents.open": (args) => ({
    capability: "documents.open",
    requireConfirm: false,
    steps: [
      { order: 1, intent: "open_app",       description: "เปิดแอปเอกสาร",   args: {} },
      { order: 2, intent: "open_document",  description: "เปิดเอกสาร",      args: { url: args.url } },
    ],
  }),

  "documents.create": (args) => ({
    capability: "documents.create",
    requireConfirm: true,
    steps: [
      { order: 1, intent: "open_app",          description: "เปิดแอปเอกสาร",   args: {} },
      { order: 2, intent: "create_document",   description: "สร้างเอกสาร",     args: { title: args.title } },
    ],
  }),

  "documents.export": () => ({
    capability: "documents.export",
    requireConfirm: true,
    steps: [
      { order: 1, intent: "export_document",  description: "ส่งออกเอกสาร",    args: {} },
    ],
  }),

  "storage.upload": (args) => ({
    capability: "storage.upload",
    requireConfirm: true,
    steps: [
      { order: 1, intent: "open_app",     description: "เปิดที่เก็บไฟล์",   args: {} },
      { order: 2, intent: "upload_file",  description: "อัพโหลด",          args: { file: args.file } },
    ],
  }),

  "storage.download": (args) => ({
    capability: "storage.download",
    requireConfirm: false,
    steps: [
      { order: 1, intent: "download_file", description: "ดาวน์โหลดไฟล์",   args: { url: args.url } },
    ],
  }),

  "storage.list": () => ({
    capability: "storage.list",
    requireConfirm: false,
    steps: [
      { order: 1, intent: "open_app",    description: "เปิดที่เก็บไฟล์",   args: {} },
      { order: 2, intent: "list_files",  description: "แสดงรายการไฟล์",   args: {} },
    ],
  }),

  "database.query": (args) => ({
    capability: "database.query",
    requireConfirm: false,
    steps: [
      { order: 1, intent: "query_data",  description: "ดึงข้อมูล",  args: { table: args.table, filter: args.filter } },
    ],
  }),

  "database.insert": (args) => ({
    capability: "database.insert",
    requireConfirm: true,
    steps: [
      { order: 1, intent: "insert_data", description: "เพิ่มข้อมูล", args: { table: args.table, data: args.data } },
    ],
  }),

  "database.update": (args) => ({
    capability: "database.update",
    requireConfirm: true,
    steps: [
      { order: 1, intent: "update_data", description: "แก้ไขข้อมูล", args: { table: args.table, id: args.id, data: args.data } },
    ],
  }),

  "database.delete": (args) => ({
    capability: "database.delete",
    requireConfirm: true,
    steps: [
      { order: 1, intent: "delete_data", description: "ลบข้อมูล",   args: { table: args.table, id: args.id } },
    ],
  }),

  "ai.translate": (args) => ({
    capability: "ai.translate",
    requireConfirm: false,
    steps: [
      { order: 1, intent: "translate",  description: "แปลภาษา", args: { text: args.text, from: args.from, to: args.to } },
    ],
  }),

  "ai.analyze": (args) => ({
    capability: "ai.analyze",
    requireConfirm: false,
    steps: [
      { order: 1, intent: "analyze",  description: "วิเคราะห์", args: { data: args.data, prompt: args.prompt } },
    ],
  }),

  "ai.generate": (args) => ({
    capability: "ai.generate",
    requireConfirm: false,
    steps: [
      { order: 1, intent: "generate", description: "สร้างข้อความ", args: { prompt: args.prompt } },
    ],
  }),

  "development.deploy": () => ({
    capability: "development.deploy",
    requireConfirm: true,
    steps: [
      { order: 1, intent: "deploy",  description: "Deploy ขึ้น Production", args: {} },
    ],
  }),

  "development.push": () => ({
    capability: "development.push",
    requireConfirm: true,
    steps: [
      { order: 1, intent: "push_code", description: "Push โค้ดขึ้น GitHub", args: {} },
    ],
  }),

  "development.status": () => ({
    capability: "development.status",
    requireConfirm: false,
    steps: [
      { order: 1, intent: "check_status", description: "เช็คสถานะ Git", args: {} },
    ],
  }),

  "automation.webhook": (args) => ({
    capability: "automation.webhook",
    requireConfirm: true,
    steps: [
      { order: 1, intent: "trigger_webhook", description: "เรียก Webhook", args: { url: args.url } },
    ],
  }),

  "automation.workflow": (args) => ({
    capability: "automation.workflow",
    requireConfirm: true,
    steps: [
      { order: 1, intent: "run_workflow", description: "เรียก Workflow", args: { url: args.url } },
    ],
  }),

  "business.send_email": (args) => ({
    capability: "business.send_email",
    requireConfirm: true,
    steps: [
      { order: 1, intent: "open_app",       description: "เปิดอีเมล",     args: {} },
      { order: 2, intent: "compose_email",  description: "เขียนเมล",      args: { to: args.to, subject: args.subject, body: args.body } },
      { order: 3, intent: "send_email",     description: "ส่งเมล",        args: {} },
    ],
  }),

  "business.calendar": (args) => ({
    capability: "business.calendar",
    requireConfirm: true,
    steps: [
      { order: 1, intent: "open_app",       description: "เปิดปฏิทิน",    args: {} },
      { order: 2, intent: "create_event",   description: "สร้างนัด",      args: { title: args.title, date: args.date } },
    ],
  }),

  "business.invoice": (args) => ({
    capability: "business.invoice",
    requireConfirm: true,
    steps: [
      { order: 1, intent: "create_invoice", description: "สร้างใบแจ้งหนี้", args: { ...args } },
    ],
  }),

  "social.post": (args) => ({
    capability: "social.post",
    requireConfirm: true,
    steps: [
      { order: 1, intent: "open_app",     description: "เปิดโซเชียล",     args: {} },
      { order: 2, intent: "create_post",  description: "สร้างโพสต์",      args: { text: args.text } },
      { order: 3, intent: "send",         description: "โพสต์",           args: {} },
    ],
  }),

  "social.read_feed": () => ({
    capability: "social.read_feed",
    requireConfirm: false,
    steps: [
      { order: 1, intent: "open_app",    description: "เปิดโซเชียล",     args: {} },
      { order: 2, intent: "read_feed",   description: "อ่าน Feed",       args: {} },
    ],
  }),
};

// ═══════════════════════════════════════════════════
// Execution Resolvers (แปลง Intent → Steps ตามแอป)
// ═══════════════════════════════════════════════════

type ExecutionResolver = (intent: IntentStep, args: Record<string, unknown>) => ExecutionStep[];

const appResolvers: Record<string, Record<string, ExecutionResolver>> = {
  // ── LINE ──
  line: {
    open_app: (i) => [
      { order: 1, action: "launch", app: "LINE", args: {}, description: "Launch LINE", fromIntent: i.intent },
      { order: 2, action: "focus",  app: "LINE", args: {}, description: "Activate LINE", fromIntent: i.intent },
    ],
    find_contact: (i) => [
      { order: 1, action: "shortcut", app: "LINE", args: { key: "f", modifiers: ["command"] }, description: "Cmd+F ค้นหา", fromIntent: i.intent },
      { order: 2, action: "type",     app: "LINE", args: { text: i.args.contact ?? "" }, description: "พิมพ์ชื่อ", fromIntent: i.intent },
      { order: 3, action: "wait",     app: "LINE", args: { timeoutMs: 1000 }, description: "รอผลค้นหา", fromIntent: i.intent },
    ],
    open_chat: (i) => [
      { order: 1, action: "submit", app: "LINE", args: {}, description: "Enter เปิดแชท", fromIntent: i.intent },
      { order: 2, action: "wait",   app: "LINE", args: { timeoutMs: 500 }, description: "รอแชทเปิด", fromIntent: i.intent },
    ],
    compose_message: (i) => [
      { order: 1, action: "paste", app: "LINE", args: { text: i.args.message ?? "" }, description: "วางข้อความ", fromIntent: i.intent },
    ],
    send: (i) => [
      { order: 1, action: "submit", app: "LINE", args: {}, description: "Enter ส่ง", fromIntent: i.intent },
    ],
    verify_delivery: (i) => [
      { order: 1, action: "wait",   app: "LINE", args: { timeoutMs: 2000 }, description: "รอยืนยันส่ง", fromIntent: i.intent },
      { order: 2, action: "report", app: "LINE", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
    read_messages: (i) => [
      { order: 1, action: "read",   app: "LINE", args: {}, description: "อ่านข้อความ", fromIntent: i.intent },
      { order: 2, action: "report", app: "LINE", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
  },

  // ── Google Chrome (Maps / Drive / Docs / Facebook) ──
  chrome: {
    open_app: (i) => [
      { order: 1, action: "launch", app: "Google Chrome", args: {}, description: "Launch Chrome", fromIntent: i.intent },
      { order: 2, action: "focus",  app: "Google Chrome", args: {}, description: "Activate Chrome", fromIntent: i.intent },
    ],
    view_map: (i) => [
      { order: 1, action: "open_url", app: "Google Chrome", args: { url: `https://maps.google.com/@${i.args.lat},${i.args.lng},15z` }, description: "เปิด Maps", fromIntent: i.intent },
      { order: 2, action: "wait",     app: "Google Chrome", args: { timeoutMs: 3000 }, description: "รอโหลด", fromIntent: i.intent },
      { order: 3, action: "report",   app: "Google Chrome", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
    get_route: (i) => [
      { order: 1, action: "open_url", app: "Google Chrome", args: { url: `https://maps.google.com/maps/dir/${encodeURIComponent(String(i.args.from ?? ""))}/${encodeURIComponent(String(i.args.to ?? ""))}` }, description: "เปิดเส้นทาง", fromIntent: i.intent },
      { order: 2, action: "wait",     app: "Google Chrome", args: { timeoutMs: 3000 }, description: "รอโหลด", fromIntent: i.intent },
      { order: 3, action: "report",   app: "Google Chrome", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
    search_place: (i) => [
      { order: 1, action: "open_url", app: "Google Chrome", args: { url: `https://maps.google.com/maps/search/${encodeURIComponent(String(i.args.query ?? ""))}` }, description: "ค้นหาสถานที่", fromIntent: i.intent },
      { order: 2, action: "wait",     app: "Google Chrome", args: { timeoutMs: 3000 }, description: "รอโหลด", fromIntent: i.intent },
      { order: 3, action: "report",   app: "Google Chrome", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
    open_document: (i) => [
      { order: 1, action: "open_url", app: "Google Chrome", args: { url: i.args.url ?? "https://drive.google.com" }, description: "เปิดเอกสาร", fromIntent: i.intent },
      { order: 2, action: "wait",     app: "Google Chrome", args: { timeoutMs: 3000 }, description: "รอโหลด", fromIntent: i.intent },
      { order: 3, action: "report",   app: "Google Chrome", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
    create_document: (i) => [
      { order: 1, action: "open_url", app: "Google Chrome", args: { url: "https://docs.google.com/document/create" }, description: "สร้าง Google Doc", fromIntent: i.intent },
      { order: 2, action: "wait",     app: "Google Chrome", args: { timeoutMs: 5000 }, description: "รอสร้าง", fromIntent: i.intent },
      { order: 3, action: "type",     app: "Google Chrome", args: { text: i.args.title ?? "" }, description: "ตั้งชื่อ", fromIntent: i.intent },
      { order: 4, action: "report",   app: "Google Chrome", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
    upload_file: (i) => [
      { order: 1, action: "open_url", app: "Google Chrome", args: { url: "https://drive.google.com" }, description: "เปิด Drive", fromIntent: i.intent },
      { order: 2, action: "wait",     app: "Google Chrome", args: { timeoutMs: 3000 }, description: "รอโหลด", fromIntent: i.intent },
      { order: 3, action: "click",    app: "Google Chrome", args: { target: "upload_button" }, description: "กดอัพโหลด", fromIntent: i.intent },
      { order: 4, action: "wait",     app: "Google Chrome", args: { timeoutMs: 30000 }, description: "รออัพโหลดเสร็จ", fromIntent: i.intent },
      { order: 5, action: "report",   app: "Google Chrome", args: { file: i.args.file }, description: "รายงานผล", fromIntent: i.intent },
    ],
    download_file: (i) => [
      { order: 1, action: "open_url",  app: "Google Chrome", args: { url: i.args.url ?? "" }, description: "เปิดลิงก์", fromIntent: i.intent },
      { order: 2, action: "shortcut",  app: "Google Chrome", args: { key: "s", modifiers: ["command"] }, description: "Cmd+S บันทึก", fromIntent: i.intent },
      { order: 3, action: "report",    app: "Google Chrome", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
    list_files: (i) => [
      { order: 1, action: "open_url", app: "Google Chrome", args: { url: "https://drive.google.com" }, description: "เปิด Drive", fromIntent: i.intent },
      { order: 2, action: "wait",     app: "Google Chrome", args: { timeoutMs: 3000 }, description: "รอโหลด", fromIntent: i.intent },
      { order: 3, action: "read",     app: "Google Chrome", args: {}, description: "อ่านรายการ", fromIntent: i.intent },
      { order: 4, action: "report",   app: "Google Chrome", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
    create_post: (i) => [
      { order: 1, action: "open_url", app: "Google Chrome", args: { url: "https://www.facebook.com" }, description: "เปิด Facebook", fromIntent: i.intent },
      { order: 2, action: "wait",     app: "Google Chrome", args: { timeoutMs: 3000 }, description: "รอโหลด", fromIntent: i.intent },
      { order: 3, action: "click",    app: "Google Chrome", args: { target: "create_post" }, description: "คลิกสร้างโพสต์", fromIntent: i.intent },
      { order: 4, action: "type",     app: "Google Chrome", args: { text: i.args.text ?? "" }, description: "พิมพ์เนื้อหา", fromIntent: i.intent },
    ],
    send: (i) => [
      { order: 1, action: "click",  app: "Google Chrome", args: { target: "post_button" }, description: "กดโพสต์", fromIntent: i.intent },
      { order: 2, action: "report", app: "Google Chrome", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
    read_feed: (i) => [
      { order: 1, action: "open_url", app: "Google Chrome", args: { url: "https://www.facebook.com" }, description: "เปิด Facebook", fromIntent: i.intent },
      { order: 2, action: "wait",     app: "Google Chrome", args: { timeoutMs: 3000 }, description: "รอโหลด", fromIntent: i.intent },
      { order: 3, action: "read",     app: "Google Chrome", args: {}, description: "อ่าน Feed", fromIntent: i.intent },
      { order: 4, action: "report",   app: "Google Chrome", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
  },

  // ── Mail ──
  mail: {
    open_app: (i) => [
      { order: 1, action: "launch", app: "Mail", args: {}, description: "Launch Mail", fromIntent: i.intent },
      { order: 2, action: "focus",  app: "Mail", args: {}, description: "Activate Mail", fromIntent: i.intent },
    ],
    compose_email: (i) => [
      { order: 1, action: "shortcut", app: "Mail", args: { key: "n", modifiers: ["command"] }, description: "Cmd+N สร้างเมล", fromIntent: i.intent },
      { order: 2, action: "type",     app: "Mail", args: { text: i.args.to ?? "" }, description: "ใส่ผู้รับ", fromIntent: i.intent },
      { order: 3, action: "click",    app: "Mail", args: { target: "subject" }, description: "Tab ไป Subject", fromIntent: i.intent },
      { order: 4, action: "type",     app: "Mail", args: { text: i.args.subject ?? "" }, description: "ใส่หัวข้อ", fromIntent: i.intent },
      { order: 5, action: "click",    app: "Mail", args: { target: "body" }, description: "Tab ไป Body", fromIntent: i.intent },
      { order: 6, action: "type",     app: "Mail", args: { text: i.args.body ?? "" }, description: "พิมพ์เนื้อหา", fromIntent: i.intent },
    ],
    send_email: (i) => [
      { order: 1, action: "shortcut", app: "Mail", args: { key: "d", modifiers: ["command", "shift"] }, description: "Cmd+Shift+D ส่ง", fromIntent: i.intent },
      { order: 2, action: "wait",     app: "Mail", args: { timeoutMs: 2000 }, description: "รอส่ง", fromIntent: i.intent },
      { order: 3, action: "report",   app: "Mail", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
  },

  // ── Calendar ──
  calendar: {
    open_app: (i) => [
      { order: 1, action: "launch", app: "Calendar", args: {}, description: "Launch Calendar", fromIntent: i.intent },
      { order: 2, action: "focus",  app: "Calendar", args: {}, description: "Activate Calendar", fromIntent: i.intent },
    ],
    create_event: (i) => [
      { order: 1, action: "shortcut", app: "Calendar", args: { key: "n", modifiers: ["command"] }, description: "Cmd+N สร้างนัด", fromIntent: i.intent },
      { order: 2, action: "type",     app: "Calendar", args: { text: i.args.title ?? "" }, description: "ใส่ชื่อนัด", fromIntent: i.intent },
      { order: 3, action: "submit",   app: "Calendar", args: {}, description: "บันทึก", fromIntent: i.intent },
      { order: 4, action: "report",   app: "Calendar", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
  },

  // ── Terminal ──
  terminal: {
    deploy: (i) => [
      { order: 1, action: "launch", app: "Terminal", args: {}, description: "Launch Terminal", fromIntent: i.intent },
      { order: 2, action: "type",   app: "Terminal", args: { text: "vercel --prod" }, description: "พิมพ์คำสั่ง deploy", fromIntent: i.intent },
      { order: 3, action: "submit", app: "Terminal", args: {}, description: "Enter", fromIntent: i.intent },
      { order: 4, action: "wait",   app: "Terminal", args: { timeoutMs: 120000 }, description: "รอ deploy", fromIntent: i.intent },
      { order: 5, action: "report", app: "Terminal", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
    trigger_webhook: (i) => [
      { order: 1, action: "launch", app: "Terminal", args: {}, description: "Launch Terminal", fromIntent: i.intent },
      { order: 2, action: "type",   app: "Terminal", args: { text: `curl -X POST "${i.args.url ?? ""}"` }, description: "เรียก webhook", fromIntent: i.intent },
      { order: 3, action: "submit", app: "Terminal", args: {}, description: "Enter", fromIntent: i.intent },
      { order: 4, action: "wait",   app: "Terminal", args: { timeoutMs: 10000 }, description: "รอผลลัพธ์", fromIntent: i.intent },
      { order: 5, action: "report", app: "Terminal", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
    run_workflow: (i) => [
      { order: 1, action: "launch", app: "Terminal", args: {}, description: "Launch Terminal", fromIntent: i.intent },
      { order: 2, action: "type",   app: "Terminal", args: { text: `curl -X POST "${i.args.url ?? ""}"` }, description: "เรียก workflow", fromIntent: i.intent },
      { order: 3, action: "submit", app: "Terminal", args: {}, description: "Enter", fromIntent: i.intent },
      { order: 4, action: "wait",   app: "Terminal", args: { timeoutMs: 30000 }, description: "รอ workflow", fromIntent: i.intent },
      { order: 5, action: "report", app: "Terminal", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
  },

  // ── GitHub Desktop ──
  github: {
    push_code: (i) => [
      { order: 1, action: "launch",   app: "GitHub Desktop", args: {}, description: "Launch GitHub Desktop", fromIntent: i.intent },
      { order: 2, action: "focus",    app: "GitHub Desktop", args: {}, description: "Activate", fromIntent: i.intent },
      { order: 3, action: "shortcut", app: "GitHub Desktop", args: { key: "p", modifiers: ["command"] }, description: "Cmd+P Push", fromIntent: i.intent },
      { order: 4, action: "wait",     app: "GitHub Desktop", args: { timeoutMs: 30000 }, description: "รอ push", fromIntent: i.intent },
      { order: 5, action: "report",   app: "GitHub Desktop", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
    check_status: (i) => [
      { order: 1, action: "launch", app: "GitHub Desktop", args: {}, description: "Launch GitHub Desktop", fromIntent: i.intent },
      { order: 2, action: "read",   app: "GitHub Desktop", args: {}, description: "อ่านสถานะ", fromIntent: i.intent },
      { order: 3, action: "report", app: "GitHub Desktop", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
  },

  // ── Preview (PDF) ──
  preview: {
    export_document: (i) => [
      { order: 1, action: "launch",   app: "Preview", args: {}, description: "Launch Preview", fromIntent: i.intent },
      { order: 2, action: "shortcut", app: "Preview", args: { key: "e", modifiers: ["command"] }, description: "Cmd+E Export", fromIntent: i.intent },
      { order: 3, action: "report",   app: "Preview", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
  },

  // ── Supabase (API-based) ──
  supabase: {
    query_data: (i) => [
      { order: 1, action: "read",   app: "Supabase", args: { table: i.args.table, filter: i.args.filter }, description: "Query", fromIntent: i.intent },
      { order: 2, action: "report", app: "Supabase", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
    insert_data: (i) => [
      { order: 1, action: "click",  app: "Supabase", args: { target: "insert", table: i.args.table, data: i.args.data }, description: "Insert", fromIntent: i.intent },
      { order: 2, action: "report", app: "Supabase", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
    update_data: (i) => [
      { order: 1, action: "click",  app: "Supabase", args: { target: "update", table: i.args.table, id: i.args.id, data: i.args.data }, description: "Update", fromIntent: i.intent },
      { order: 2, action: "report", app: "Supabase", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
    delete_data: (i) => [
      { order: 1, action: "click",  app: "Supabase", args: { target: "soft_delete", table: i.args.table, id: i.args.id }, description: "Soft Delete", fromIntent: i.intent },
      { order: 2, action: "report", app: "Supabase", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
    create_invoice: (i) => [
      { order: 1, action: "click",  app: "Supabase", args: { target: "insert", table: "documents", data: { document_type: "invoice", ...i.args } }, description: "สร้างใบแจ้งหนี้", fromIntent: i.intent },
      { order: 2, action: "report", app: "Supabase", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
  },

  // ── OpenAI (API-based) ──
  openai: {
    translate: (i) => [
      { order: 1, action: "read",   app: "OpenAI", args: { ...i.args }, description: "แปลภาษา", fromIntent: i.intent },
      { order: 2, action: "report", app: "OpenAI", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
    analyze: (i) => [
      { order: 1, action: "read",   app: "OpenAI", args: { ...i.args }, description: "วิเคราะห์", fromIntent: i.intent },
      { order: 2, action: "report", app: "OpenAI", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
    generate: (i) => [
      { order: 1, action: "read",   app: "OpenAI", args: { ...i.args }, description: "สร้างข้อความ", fromIntent: i.intent },
      { order: 2, action: "report", app: "OpenAI", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
  },

  // ── FaceTime ──
  facetime: {
    open_app: (i) => [
      { order: 1, action: "launch", app: "FaceTime", args: {}, description: "Launch FaceTime", fromIntent: i.intent },
    ],
    find_contact: (i) => [
      { order: 1, action: "search", app: "FaceTime", args: { query: i.args.contact ?? "" }, description: "ค้นหาเบอร์", fromIntent: i.intent },
    ],
    make_call: (i) => [
      { order: 1, action: "click",  app: "FaceTime", args: { target: "call" }, description: "กดโทร", fromIntent: i.intent },
      { order: 2, action: "report", app: "FaceTime", args: {}, description: "รายงานผล", fromIntent: i.intent },
    ],
  },
};

// ═══════════════════════════════════════════
// Capability → App mapping
// ═══════════════════════════════════════════

const capabilityToApp: Record<string, string> = {
  "communication.send_message": "line",
  "communication.read_message": "line",
  "communication.call": "facetime",
  "maps.view_location": "chrome",
  "maps.get_directions": "chrome",
  "maps.search_nearby": "chrome",
  "documents.open": "chrome",
  "documents.create": "chrome",
  "documents.export": "preview",
  "storage.upload": "chrome",
  "storage.download": "chrome",
  "storage.list": "chrome",
  "database.query": "supabase",
  "database.insert": "supabase",
  "database.update": "supabase",
  "database.delete": "supabase",
  "ai.translate": "openai",
  "ai.analyze": "openai",
  "ai.generate": "openai",
  "development.deploy": "terminal",
  "development.push": "github",
  "development.status": "github",
  "automation.webhook": "terminal",
  "automation.workflow": "terminal",
  "business.send_email": "mail",
  "business.calendar": "calendar",
  "business.invoice": "supabase",
  "social.post": "chrome",
  "social.read_feed": "chrome",
};

// ═══════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════

export function planTask(
  capability: CapabilityAction,
  args: Record<string, unknown> = {}
): TaskPlan | null {
  const intentFactory = intents[capability];
  if (!intentFactory) return null;

  const intentPlan = intentFactory(args);
  const appKey = capabilityToApp[capability];
  if (!appKey) return null;

  const resolver = appResolvers[appKey];
  if (!resolver) return null;

  const executionSteps: ExecutionStep[] = [];
  let order = 0;

  for (const intentStep of intentPlan.steps) {
    const resolverFn = resolver[intentStep.intent];
    if (resolverFn) {
      const steps = resolverFn(intentStep, args);
      for (const s of steps) {
        order++;
        executionSteps.push({ ...s, order });
      }
    }
  }

  const appNames: Record<string, string> = {
    line: "LINE", chrome: "Google Chrome", mail: "Mail", calendar: "Calendar",
    terminal: "Terminal", github: "GitHub Desktop", preview: "Preview",
    supabase: "Supabase", openai: "OpenAI", facetime: "FaceTime",
  };

  return {
    capability,
    app: appNames[appKey] ?? appKey,
    intentPlan,
    executionSteps,
    requireConfirm: intentPlan.requireConfirm,
    estimatedMs: executionSteps.length * 1500,
  };
}

export function getIntentPlan(
  capability: CapabilityAction,
  args: Record<string, unknown> = {}
): IntentPlan | null {
  const factory = intents[capability];
  if (!factory) return null;
  return factory(args);
}

export function hasPlan(capability: CapabilityAction): boolean {
  return capability in intents;
}

export function listPlannedCapabilities(): string[] {
  return Object.keys(intents);
}

export function getAppForCapability(capability: string): string | undefined {
  return capabilityToApp[capability];
}

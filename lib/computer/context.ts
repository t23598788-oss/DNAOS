/**
 * Context Manager
 *
 * V6 จำ Context ปัจจุบัน — เฮียพูด "ใบนี้" ระบบรู้ว่าคือ Invoice.pdf
 *
 * ติดตาม:
 * - Current App
 * - Current Chat / Contact
 * - Current Folder / File
 * - Current Browser Tab / URL
 * - Current Window Title
 * - Recent Items (ย้อนหลังได้)
 */

export interface ComputerContext {
  currentApp: string | null;
  currentWindow: string | null;
  currentChat: string | null;
  currentContact: string | null;
  currentFolder: string | null;
  currentFile: string | null;
  currentUrl: string | null;
  currentBrowserTab: string | null;
  lastUpdated: number;
}

export interface ContextEntry {
  key: string;
  value: string;
  app: string;
  timestamp: number;
}

const ctx: ComputerContext = {
  currentApp: null,
  currentWindow: null,
  currentChat: null,
  currentContact: null,
  currentFolder: null,
  currentFile: null,
  currentUrl: null,
  currentBrowserTab: null,
  lastUpdated: 0,
};

const history: ContextEntry[] = [];
const MAX_HISTORY = 100;

export function setContext(key: keyof ComputerContext, value: string, app: string = ""): void {
  if (key === "lastUpdated") return;
  (ctx as unknown as Record<string, unknown>)[key] = value;
  ctx.lastUpdated = Date.now();

  history.push({ key, value, app, timestamp: Date.now() });
  if (history.length > MAX_HISTORY) history.shift();
}

export function getContext(): Readonly<ComputerContext> {
  return { ...ctx };
}

export function getContextValue(key: keyof ComputerContext): string | null {
  const val = ctx[key];
  if (typeof val === "string") return val;
  return null;
}

export function clearContext(): void {
  ctx.currentApp = null;
  ctx.currentWindow = null;
  ctx.currentChat = null;
  ctx.currentContact = null;
  ctx.currentFolder = null;
  ctx.currentFile = null;
  ctx.currentUrl = null;
  ctx.currentBrowserTab = null;
  ctx.lastUpdated = Date.now();
}

export function getContextHistory(count: number = 20): ContextEntry[] {
  return history.slice(-count);
}

// ── Resolve References ──

export function resolveReference(ref: string): { key: string; value: string } | null {
  const lower = ref.toLowerCase();

  if (matchesAny(lower, ["ใบนี้", "เอกสารนี้", "ไฟล์นี้", "this file", "this document"])) {
    if (ctx.currentFile) return { key: "currentFile", value: ctx.currentFile };
    if (ctx.currentWindow) return { key: "currentWindow", value: ctx.currentWindow };
  }

  if (matchesAny(lower, ["ลูกค้านี้", "คนนี้", "เจ้านี้", "this contact", "this customer"])) {
    if (ctx.currentContact) return { key: "currentContact", value: ctx.currentContact };
    if (ctx.currentChat) return { key: "currentChat", value: ctx.currentChat };
  }

  if (matchesAny(lower, ["แชทนี้", "ห้องนี้", "this chat"])) {
    if (ctx.currentChat) return { key: "currentChat", value: ctx.currentChat };
  }

  if (matchesAny(lower, ["หน้านี้", "เว็บนี้", "tab นี้", "this page", "this tab"])) {
    if (ctx.currentUrl) return { key: "currentUrl", value: ctx.currentUrl };
    if (ctx.currentBrowserTab) return { key: "currentBrowserTab", value: ctx.currentBrowserTab };
  }

  if (matchesAny(lower, ["โฟลเดอร์นี้", "ที่นี่", "this folder"])) {
    if (ctx.currentFolder) return { key: "currentFolder", value: ctx.currentFolder };
  }

  if (matchesAny(lower, ["แอปนี้", "โปรแกรมนี้", "this app"])) {
    if (ctx.currentApp) return { key: "currentApp", value: ctx.currentApp };
  }

  return null;
}

// ── Auto-update from Events ──

export function updateFromStepResult(
  app: string,
  step: string,
  data?: unknown
): void {
  setContext("currentApp", app, app);

  if (!data || typeof data !== "object") return;
  const d = data as Record<string, unknown>;

  if (d.windowTitle && typeof d.windowTitle === "string") {
    setContext("currentWindow", d.windowTitle, app);
    guessFromWindowTitle(d.windowTitle, app);
  }

  if (d.url && typeof d.url === "string") {
    setContext("currentUrl", d.url, app);
  }

  if (d.title && typeof d.title === "string") {
    setContext("currentBrowserTab", d.title, app);
  }

  if (d.chatOpened && typeof d.chatOpened === "string") {
    setContext("currentChat", d.chatOpened, app);
    setContext("currentContact", d.chatOpened, app);
  }

  if (d.query && typeof d.query === "string" && step.includes("search")) {
    setContext("currentContact", d.query, app);
  }

  if (d.path && typeof d.path === "string") {
    if (d.path.includes(".")) {
      setContext("currentFile", d.path, app);
    } else {
      setContext("currentFolder", d.path, app);
    }
  }

  if (d.opened && typeof d.opened === "string" && d.opened.includes("/")) {
    setContext("currentFolder", d.opened, app);
  }
}

function guessFromWindowTitle(title: string, app: string): void {
  if (title.endsWith(".pdf") || title.endsWith(".docx") || title.endsWith(".xlsx")) {
    setContext("currentFile", title, app);
  }

  if (app === "LINE" && title && !title.includes("LINE")) {
    setContext("currentChat", title, app);
    setContext("currentContact", title, app);
  }

  if (app === "Finder" && title.includes("/")) {
    setContext("currentFolder", title, app);
  }
}

function matchesAny(text: string, patterns: string[]): boolean {
  return patterns.some((p) => text.includes(p));
}

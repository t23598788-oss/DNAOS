/**
 * V6 Workflow Registry
 *
 * ทุกอย่างเป็น Data — Engine ไม่รู้จักแอป ไม่รู้จักภาษาไทย
 * เพิ่มคำสั่ง = เพิ่ม mapping, เพิ่ม workflow = เพิ่ม JSON
 *
 * Command Registry → Workflow Registry → Step Registry → Driver
 */

// ═══════════════════════════════════════════
// 1. Command Registry (ภาษาไทย → workflow)
// ═══════════════════════════════════════════

interface CommandMapping {
  patterns: string[];
  workflow: string;
  extractArgs?: (text: string) => Record<string, string>;
}

const commands: CommandMapping[] = [
  { patterns: ["เปิด line", "เปิดไลน์"],          workflow: "app.launch", extractArgs: () => ({ app: "LINE" }) },
  { patterns: ["เปิด chrome", "เปิดโครม", "เปิดเว็บ"], workflow: "app.launch", extractArgs: () => ({ app: "Google Chrome" }) },
  { patterns: ["เปิด vscode", "เปิดวีเอส", "เปิด vs code"], workflow: "app.launch", extractArgs: () => ({ app: "VS Code" }) },
  { patterns: ["เปิด terminal", "เปิดเทอร์มินอล"],  workflow: "app.launch", extractArgs: () => ({ app: "Terminal" }) },
  { patterns: ["เปิด finder", "เปิดไฟล์"],         workflow: "app.launch", extractArgs: () => ({ app: "Finder" }) },
  { patterns: ["เปิด mail", "เปิดเมล", "เปิดอีเมล"], workflow: "app.launch", extractArgs: () => ({ app: "Mail" }) },
  { patterns: ["เปิดปฏิทิน", "เปิด calendar"],     workflow: "app.launch", extractArgs: () => ({ app: "Calendar" }) },
  { patterns: ["เปิด github", "เปิดกิตฮับ"],       workflow: "app.launch", extractArgs: () => ({ app: "GitHub Desktop" }) },
  { patterns: ["เปิด google maps", "เปิดแผนที่", "เปิดแมพ"], workflow: "app.launch", extractArgs: () => ({ app: "Google Maps" }) },
  { patterns: ["เปิด google earth", "เปิดเอิร์ธ"], workflow: "app.launch", extractArgs: () => ({ app: "Google Earth" }) },
  { patterns: ["เปิด pdf", "เปิดพีดีเอฟ"],         workflow: "app.launch", extractArgs: () => ({ app: "PDF Viewer" }) },

  { patterns: ["ส่งข้อความ", "ส่งไลน์", "ส่ง line"], workflow: "message.send",
    extractArgs: (t) => {
      const rest = t.replace(/ส่ง(ข้อความ|ไลน์|line)\s*/i, "").trim();
      const parts = rest.split(/\s+ว่า\s+/);
      return { app: "LINE", contact: parts[0] ?? "", message: parts[1] ?? rest };
    },
  },

  { patterns: ["ดูแผนที่", "ดูตำแหน่ง", "นำทาง"], workflow: "map.view",
    extractArgs: (t) => ({ app: "Google Maps", query: t.replace(/ดู(แผนที่|ตำแหน่ง)|นำทาง/g, "").trim() }),
  },

  { patterns: ["ส่งเมล", "ส่งอีเมล"], workflow: "email.send",
    extractArgs: (t) => ({ app: "Mail", to: t.replace(/ส่ง(เมล|อีเมล)\s*/i, "").trim() }),
  },

  { patterns: ["deploy", "ดีพลอย"],   workflow: "dev.deploy", extractArgs: () => ({ app: "Terminal" }) },
  { patterns: ["push", "พุช", "อัพโค้ด"], workflow: "dev.push", extractArgs: () => ({ app: "GitHub Desktop" }) },
  { patterns: ["สถานะแอป", "สถานะโปรแกรม", "สถานะเครื่อง"], workflow: "system.status", extractArgs: () => ({}) },
];

// ═══════════════════════════════════════════
// 2. Workflow Registry (workflow → steps)
// ═══════════════════════════════════════════

interface WorkflowDef {
  steps: string[];
  requireConfirm: boolean;
}

const workflows: Record<string, WorkflowDef> = {
  "app.launch":     { steps: ["launch", "wait_ready", "report"],                                        requireConfirm: false },
  "app.close":      { steps: ["close", "report"],                                                       requireConfirm: false },
  "message.send":   { steps: ["launch", "wait_ready", "focus", "search", "click:chat", "type", "submit", "wait_delivery", "report"], requireConfirm: true },
  "message.read":   { steps: ["launch", "wait_ready", "focus", "search", "read", "report"],             requireConfirm: false },
  "map.view":       { steps: ["launch", "wait_ready", "search", "wait_load", "report"],                 requireConfirm: false },
  "email.send":     { steps: ["launch", "wait_ready", "focus", "click:compose", "type:to", "click:subject", "type:subject", "click:body", "type:body", "shortcut:send", "report"], requireConfirm: true },
  "dev.deploy":     { steps: ["launch", "wait_ready", "type:command", "submit", "wait_long", "report"], requireConfirm: true },
  "dev.push":       { steps: ["launch", "wait_ready", "focus", "shortcut:push", "wait_long", "report"], requireConfirm: true },
  "system.status":  { steps: ["check_all_apps"],                                                        requireConfirm: false },
};

// ═══════════════════════════════════════════
// 3. Step Registry (step → driver method)
// ═══════════════════════════════════════════

type StepHandler = (driver: DriverMethods, args: Record<string, string>) => Promise<StepExecResult>;

interface StepExecResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

interface DriverMethods {
  launch(): Promise<StepExecResult>;
  focus(): Promise<StepExecResult>;
  close(): Promise<StepExecResult>;
  search(query: string): Promise<StepExecResult>;
  click(target: string): Promise<StepExecResult>;
  type(text: string): Promise<StepExecResult>;
  read(): Promise<StepExecResult>;
}

const stepHandlers: Record<string, StepHandler> = {
  "launch":         (d) => d.launch(),
  "focus":          (d) => d.focus(),
  "close":          (d) => d.close(),
  "search":         (d, a) => d.search(a.contact ?? a.query ?? ""),
  "read":           (d) => d.read(),
  "submit":         (d) => d.click("submit"),
  "report":         async () => ({ ok: true, data: { reported: true } }),
  "wait_ready":     async () => { await sleep(500);  return { ok: true }; },
  "wait_load":      async () => { await sleep(2000); return { ok: true }; },
  "wait_delivery":  async () => { await sleep(1500); return { ok: true }; },
  "wait_long":      async () => { await sleep(5000); return { ok: true }; },
  "type":           (d, a) => d.type(a.message ?? a.text ?? ""),
  "type:to":        (d, a) => d.type(a.to ?? ""),
  "type:subject":   (d, a) => d.type(a.subject ?? ""),
  "type:body":      (d, a) => d.type(a.body ?? ""),
  "type:command":   (d, a) => d.type(a.command ?? "vercel --prod"),
  "click:chat":     (d) => d.click("chat"),
  "click:compose":  (d) => d.click("compose"),
  "click:subject":  (d) => d.click("subject"),
  "click:body":     (d) => d.click("body"),
  "shortcut:send":  (d) => d.click("shortcut:d"),
  "shortcut:push":  (d) => d.click("shortcut:p"),
};

// ═══════════════════════════════════════════
// 4. Engine (ไม่รู้จักแอป ไม่รู้จักภาษาไทย)
// ═══════════════════════════════════════════

export interface WorkflowResult {
  ok: boolean;
  workflow: string;
  app: string;
  steps: { step: string; status: string; durationMs: number; data?: unknown; error?: string }[];
  totalMs: number;
  error?: string;
}

export function matchCommand(text: string): { workflow: string; args: Record<string, string> } | null {
  const t = text.toLowerCase().trim();
  for (const cmd of commands) {
    if (cmd.patterns.some((p) => t.includes(p))) {
      const args = cmd.extractArgs ? cmd.extractArgs(text) : {};
      return { workflow: cmd.workflow, args };
    }
  }
  return null;
}

export function getWorkflow(name: string): WorkflowDef | undefined {
  return workflows[name];
}

export async function executeWorkflow(
  workflowName: string,
  args: Record<string, string>,
  driver: DriverMethods
): Promise<WorkflowResult> {
  const wf = workflows[workflowName];
  if (!wf) {
    return { ok: false, workflow: workflowName, app: args.app ?? "", steps: [], totalMs: 0, error: `ไม่พบ workflow: ${workflowName}` };
  }

  const start = Date.now();
  const stepResults: WorkflowResult["steps"] = [];

  for (const stepName of wf.steps) {
    const handler = stepHandlers[stepName];
    if (!handler) {
      stepResults.push({ step: stepName, status: "failed", durationMs: 0, error: `ไม่พบ step handler: ${stepName}` });
      return { ok: false, workflow: workflowName, app: args.app ?? "", steps: stepResults, totalMs: Date.now() - start, error: `step "${stepName}" ไม่มี handler` };
    }

    const stepStart = Date.now();
    try {
      const result = await handler(driver, args);
      stepResults.push({
        step: stepName,
        status: result.ok ? "success" : "failed",
        durationMs: Date.now() - stepStart,
        data: result.data,
        error: result.error,
      });
      if (!result.ok) {
        return { ok: false, workflow: workflowName, app: args.app ?? "", steps: stepResults, totalMs: Date.now() - start, error: result.error };
      }
    } catch (e) {
      const error = (e as Error).message;
      stepResults.push({ step: stepName, status: "failed", durationMs: Date.now() - stepStart, error });
      return { ok: false, workflow: workflowName, app: args.app ?? "", steps: stepResults, totalMs: Date.now() - start, error };
    }
  }

  return { ok: true, workflow: workflowName, app: args.app ?? "", steps: stepResults, totalMs: Date.now() - start };
}

// ═══════════════════════════════════════════
// 5. Helpers
// ═══════════════════════════════════════════

export function listWorkflows(): string[] {
  return Object.keys(workflows);
}

export function listCommands(): { pattern: string; workflow: string }[] {
  return commands.flatMap((c) => c.patterns.map((p) => ({ pattern: p, workflow: c.workflow })));
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

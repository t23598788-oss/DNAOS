/**
 * V6 Executor
 *
 * ชั้นเดียวที่เขียน DB ได้
 * รับคำสั่งจากมนุษย์ → Execute ผ่าน handler ที่เหมาะสม
 * ทุก execute ต้องผ่าน confirm จากมนุษย์ก่อน
 */

import { supabase } from "@/services/supabase/queries";
import { findTool } from "./capabilities";
import "@/plugins/registerAllDrivers"; // registers all AppDrivers on startup
import { get as getDriver } from "@/core/executor/registry";

export interface ExecuteRequest {
  tool_id: string;
  action: "create" | "update" | "delete" | "open" | "send" | "import";
  target?: string;
  payload: Record<string, unknown>;
  confirmed: boolean;
}

export interface ExecuteResult {
  ok: boolean;
  tool_id: string;
  action: string;
  result?: Record<string, unknown>;
  error?: string;
}

export async function execute(req: ExecuteRequest): Promise<ExecuteResult> {
  if (!req.confirmed) {
    return { ok: false, tool_id: req.tool_id, action: req.action, error: "ต้อง confirm ก่อน execute" };
  }

  const tool = findTool(req.tool_id);
  if (!tool) {
    return { ok: false, tool_id: req.tool_id, action: req.action, error: `ไม่พบเครื่องมือ: ${req.tool_id}` };
  }

  if (tool.status !== "connected") {
    return { ok: false, tool_id: req.tool_id, action: req.action, error: `${tool.name} — ${tool.status}` };
  }

  switch (tool.handler) {
    case "supabase":
      return executeSupabase(req);
    case "url_scheme":
      return executeUrlScheme(tool, req);
    case "driver":
      return executeDriver(tool, req);
    case "api":
      return executeApi(req);
    case "mcp":
      return { ok: false, tool_id: req.tool_id, action: req.action, error: "MCP ต้องเรียกผ่าน Mac terminal" };
    default:
      return { ok: false, tool_id: req.tool_id, action: req.action, error: `handler ไม่รองรับ: ${tool.handler}` };
  }
}

async function executeSupabase(req: ExecuteRequest): Promise<ExecuteResult> {
  const table = req.payload.table as string;
  const data = req.payload.data as Record<string, unknown>;
  const id = req.payload.id as string;

  if (!table) return { ok: false, tool_id: req.tool_id, action: req.action, error: "ต้องระบุ table" };

  switch (req.action) {
    case "create": {
      const { data: result, error } = await supabase().from(table).insert(data).select().single();
      if (error) return { ok: false, tool_id: req.tool_id, action: req.action, error: error.message };
      return { ok: true, tool_id: req.tool_id, action: "create", result: { id: result.id, table } };
    }
    case "update": {
      if (!id) return { ok: false, tool_id: req.tool_id, action: req.action, error: "ต้องระบุ id" };
      const { error } = await supabase().from(table).update(data).eq("id", id);
      if (error) return { ok: false, tool_id: req.tool_id, action: req.action, error: error.message };
      return { ok: true, tool_id: req.tool_id, action: "update", result: { id, table } };
    }
    case "delete": {
      if (!id) return { ok: false, tool_id: req.tool_id, action: req.action, error: "ต้องระบุ id" };
      const { error } = await supabase().from(table).update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) return { ok: false, tool_id: req.tool_id, action: req.action, error: error.message };
      return { ok: true, tool_id: req.tool_id, action: "delete", result: { id, table, soft_delete: true } };
    }
    default:
      return { ok: false, tool_id: req.tool_id, action: req.action, error: `supabase ไม่รองรับ action: ${req.action}` };
  }
}

async function executeDriver(tool: ReturnType<typeof findTool>, req: ExecuteRequest): Promise<ExecuteResult> {
  const appName = tool?.driver_app ?? req.tool_id;
  const driver = getDriver(appName);
  if (!driver) {
    return { ok: false, tool_id: req.tool_id, action: req.action, error: `ไม่พบ driver สำหรับ: ${appName}` };
  }
  try {
    const map: Record<string, () => Promise<unknown>> = {
      open:   () => driver.launch(),
      search: () => driver.search(String(req.payload.query ?? req.payload.q ?? "")),
      click:  () => driver.click(String(req.payload.target ?? "")),
      send:   () => driver.type(String(req.payload.text ?? "")),
      import: () => driver.read(),
      delete: () => driver.close(),
      update: () => driver.focus(),
    };
    const fn = map[req.action];
    if (!fn) return { ok: false, tool_id: req.tool_id, action: req.action, error: `driver ไม่รองรับ action: ${req.action}` };
    const result = await fn();
    return { ok: true, tool_id: req.tool_id, action: req.action, result: result as Record<string, unknown> };
  } catch (e: any) {
    return { ok: false, tool_id: req.tool_id, action: req.action, error: e.message ?? String(e) };
  }
}

function executeUrlScheme(tool: ReturnType<typeof findTool>, req: ExecuteRequest): ExecuteResult {
  const schemes: Record<string, string> = {
    line: "line://",
    phone: `tel:${req.payload.number ?? ""}`,
    google_maps: `https://maps.google.com/?q=${req.payload.lat ?? ""},${req.payload.lng ?? ""}`,
    siri: `shortcuts://run-shortcut?name=${req.payload.shortcut ?? ""}`,
    vscode: "vscode://",
    terminal: "x-apple.terminal://",
  };

  const url = schemes[req.tool_id];
  if (!url) return { ok: false, tool_id: req.tool_id, action: req.action, error: "ไม่พบ URL scheme" };

  return { ok: true, tool_id: req.tool_id, action: "open", result: { url, open_in_browser: true } };
}

async function executeApi(req: ExecuteRequest): Promise<ExecuteResult> {
  return { ok: false, tool_id: req.tool_id, action: req.action, error: "API executor รอ V6.1" };
}

// Browser handler removed — OS basics hidden from V6

/**
 * V6 Capability Manager
 *
 * Orchestrator ที่ผูกกับ "ความสามารถ" ไม่ใช่ยี่ห้อแอป
 * เปลี่ยน LINE เป็น WhatsApp ไม่ต้องแก้โค้ด
 * มี fallback อัตโนมัติ
 */

export type CapabilityAction =
  | "communication.send_message"
  | "communication.read_message"
  | "communication.call"
  | "documents.open"
  | "documents.create"
  | "documents.export"
  | "storage.upload"
  | "storage.download"
  | "storage.list"
  | "database.query"
  | "database.insert"
  | "database.update"
  | "database.delete"
  | "maps.view_location"
  | "maps.get_directions"
  | "maps.search_nearby"
  | "ai.translate"
  | "ai.analyze"
  | "ai.generate"
  | "development.deploy"
  | "development.push"
  | "development.status"
  | "automation.webhook"
  | "automation.workflow"
  | "business.send_email"
  | "business.calendar"
  | "business.invoice"
  | "social.post"
  | "social.read_feed";

interface MCPToolMapping {
  mcpServer: string;
  toolName: string;
  fallbackServer?: string;
  fallbackTool?: string;
  requireConfirm: boolean;
}

const registry: Record<CapabilityAction, MCPToolMapping> = {
  // Communication
  "communication.send_message": {
    mcpServer: "line-mcp-server",
    toolName: "send_line_notify",
    fallbackServer: "gmail-mcp-server",
    fallbackTool: "send_email",
    requireConfirm: true,
  },
  "communication.read_message": {
    mcpServer: "line-mcp-server",
    toolName: "read_line_messages",
    requireConfirm: false,
  },
  "communication.call": {
    mcpServer: "siri-mcp-server",
    toolName: "make_call",
    requireConfirm: true,
  },

  // Documents
  "documents.open": {
    mcpServer: "google-drive-mcp",
    toolName: "open_drive_file",
    requireConfirm: false,
  },
  "documents.create": {
    mcpServer: "google-drive-mcp",
    toolName: "create_document",
    fallbackServer: "local-file-mcp",
    fallbackTool: "create_local_file",
    requireConfirm: true,
  },
  "documents.export": {
    mcpServer: "pdf-mcp-server",
    toolName: "export_pdf",
    requireConfirm: true,
  },

  // Storage
  "storage.upload": {
    mcpServer: "google-drive-mcp",
    toolName: "upload_file",
    fallbackServer: "supabase-storage-mcp",
    fallbackTool: "upload_to_bucket",
    requireConfirm: true,
  },
  "storage.download": {
    mcpServer: "google-drive-mcp",
    toolName: "download_file",
    requireConfirm: false,
  },
  "storage.list": {
    mcpServer: "google-drive-mcp",
    toolName: "list_files",
    requireConfirm: false,
  },

  // Database
  "database.query": {
    mcpServer: "supabase-mcp",
    toolName: "execute_query",
    requireConfirm: false,
  },
  "database.insert": {
    mcpServer: "supabase-mcp",
    toolName: "insert_record",
    requireConfirm: true,
  },
  "database.update": {
    mcpServer: "supabase-mcp",
    toolName: "update_record",
    requireConfirm: true,
  },
  "database.delete": {
    mcpServer: "supabase-mcp",
    toolName: "soft_delete_record",
    requireConfirm: true,
  },

  // Maps
  "maps.view_location": {
    mcpServer: "google-maps-mcp",
    toolName: "open_location",
    fallbackServer: "google-earth-mcp",
    fallbackTool: "fly_to_3d_coordinates",
    requireConfirm: false,
  },
  "maps.get_directions": {
    mcpServer: "google-maps-mcp",
    toolName: "get_directions",
    requireConfirm: false,
  },
  "maps.search_nearby": {
    mcpServer: "google-maps-mcp",
    toolName: "search_nearby_places",
    requireConfirm: false,
  },

  // AI
  "ai.translate": {
    mcpServer: "openai-mcp",
    toolName: "translate_text",
    fallbackServer: "gemini-mcp",
    fallbackTool: "translate",
    requireConfirm: false,
  },
  "ai.analyze": {
    mcpServer: "openai-mcp",
    toolName: "analyze_data",
    fallbackServer: "claude-mcp",
    fallbackTool: "analyze",
    requireConfirm: false,
  },
  "ai.generate": {
    mcpServer: "openai-mcp",
    toolName: "generate_text",
    fallbackServer: "gemini-mcp",
    fallbackTool: "generate",
    requireConfirm: false,
  },

  // Development
  "development.deploy": {
    mcpServer: "vercel-mcp",
    toolName: "trigger_deploy",
    requireConfirm: true,
  },
  "development.push": {
    mcpServer: "github-mcp",
    toolName: "git_push",
    requireConfirm: true,
  },
  "development.status": {
    mcpServer: "github-mcp",
    toolName: "get_status",
    requireConfirm: false,
  },

  // Automation
  "automation.webhook": {
    mcpServer: "webhook-mcp",
    toolName: "trigger_webhook",
    requireConfirm: true,
  },
  "automation.workflow": {
    mcpServer: "n8n-mcp",
    toolName: "run_workflow",
    fallbackServer: "webhook-mcp",
    fallbackTool: "trigger_webhook",
    requireConfirm: true,
  },

  // Business
  "business.send_email": {
    mcpServer: "gmail-mcp",
    toolName: "send_email",
    requireConfirm: true,
  },
  "business.calendar": {
    mcpServer: "google-calendar-mcp",
    toolName: "create_event",
    requireConfirm: true,
  },
  "business.invoice": {
    mcpServer: "supabase-mcp",
    toolName: "create_invoice_document",
    requireConfirm: true,
  },

  // Social
  "social.post": {
    mcpServer: "meta-mcp",
    toolName: "create_post",
    requireConfirm: true,
  },
  "social.read_feed": {
    mcpServer: "meta-mcp",
    toolName: "read_feed",
    requireConfirm: false,
  },
};

// ---- Health check cache ----
const serverHealth: Record<string, { alive: boolean; checkedAt: number }> = {};

function isServerAlive(server: string): boolean {
  const cached = serverHealth[server];
  if (cached && Date.now() - cached.checkedAt < 60_000) return cached.alive;
  return true;
}

function markServerDown(server: string) {
  serverHealth[server] = { alive: false, checkedAt: Date.now() };
}

// ---- Orchestrator ----

export interface CapabilityResult {
  ok: boolean;
  capability: CapabilityAction;
  server_used: string;
  tool_used: string;
  is_fallback: boolean;
  require_confirm: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

export async function executeCapability(
  capability: CapabilityAction,
  args: Record<string, unknown>,
  confirmed: boolean = false
): Promise<CapabilityResult> {
  const mapping = registry[capability];

  if (!mapping) {
    return {
      ok: false, capability, server_used: "", tool_used: "",
      is_fallback: false, require_confirm: false,
      error: `ระบบยังไม่ได้ลงทะเบียนความสามารถ: ${capability}`,
    };
  }

  if (mapping.requireConfirm && !confirmed) {
    return {
      ok: false, capability, server_used: mapping.mcpServer, tool_used: mapping.toolName,
      is_fallback: false, require_confirm: true,
      error: "ต้องยืนยันก่อน execute",
    };
  }

  // ลอง Computer Control Layer ก่อน (local macOS)
  const localResult = await tryLocalExecution(capability, args);
  if (localResult) return localResult;

  // ลอง primary MCP server
  if (isServerAlive(mapping.mcpServer)) {
    try {
      const result = await callMcpExecutor(mapping.mcpServer, mapping.toolName, args);
      return {
        ok: true, capability, server_used: mapping.mcpServer, tool_used: mapping.toolName,
        is_fallback: false, require_confirm: mapping.requireConfirm, result,
      };
    } catch {
      markServerDown(mapping.mcpServer);
    }
  }

  // ลอง fallback MCP server
  if (mapping.fallbackServer && mapping.fallbackTool) {
    try {
      const result = await callMcpExecutor(mapping.fallbackServer, mapping.fallbackTool, args);
      return {
        ok: true, capability, server_used: mapping.fallbackServer, tool_used: mapping.fallbackTool,
        is_fallback: true, require_confirm: mapping.requireConfirm, result,
      };
    } catch {
      markServerDown(mapping.fallbackServer);
    }
  }

  return {
    ok: false, capability, server_used: mapping.mcpServer, tool_used: mapping.toolName,
    is_fallback: false, require_confirm: mapping.requireConfirm,
    error: `ทั้ง ${mapping.mcpServer} และ ${mapping.fallbackServer ?? "ไม่มี fallback"} ไม่ตอบสนอง`,
  };
}

async function tryLocalExecution(
  capability: CapabilityAction,
  args: Record<string, unknown>
): Promise<CapabilityResult | null> {
  try {
    const { isLocalMac } = await import("./computer-control/osascript");
    if (!isLocalMac()) return null;

    const { planTask } = await import("../computer/planner");
    const { enqueue, getQueueItem } = await import("../computer/queue");

    const plan = planTask(capability, args);
    if (!plan) return null;

    plan.requireConfirm = false;
    const item = enqueue(plan, args);

    // รอ queue ทำงานเสร็จ (max 30s)
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const current = getQueueItem(item.id);
      if (!current) break;
      if (current.status === "completed" || current.status === "failed" || current.status === "cancelled") {
        return {
          ok: current.status === "completed",
          capability,
          server_used: "local-mac",
          tool_used: plan.app,
          is_fallback: false,
          require_confirm: false,
          result: current.status === "completed"
            ? { steps: current.stepResults.length, app: plan.app, queueId: item.id }
            : undefined,
          error: current.status !== "completed" ? current.error : undefined,
        };
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    return {
      ok: false, capability, server_used: "local-mac", tool_used: plan.app,
      is_fallback: false, require_confirm: false,
      error: "หมดเวลา — queue ทำงานไม่เสร็จภายใน 30 วินาที",
    };
  } catch {
    return null;
  }
}

async function callMcpExecutor(
  server: string,
  tool: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  // TODO: เชื่อม MCP Client จริงของ Mac
  // return await mcpClient.callTool(server, tool, args);
  return { success: true, server, tool, message: `ธุรกรรมผ่านท่อตรง ${server} เรียบร้อย` };
}

// ---- Lookup ----

export function getCapabilityInfo(capability: CapabilityAction) {
  const mapping = registry[capability];
  if (!mapping) return null;
  return {
    capability,
    primary: { server: mapping.mcpServer, tool: mapping.toolName },
    fallback: mapping.fallbackServer ? { server: mapping.fallbackServer, tool: mapping.fallbackTool } : null,
    requireConfirm: mapping.requireConfirm,
    primaryAlive: isServerAlive(mapping.mcpServer),
    fallbackAlive: mapping.fallbackServer ? isServerAlive(mapping.fallbackServer) : null,
  };
}

export function listAllCapabilities(): CapabilityAction[] {
  return Object.keys(registry) as CapabilityAction[];
}

export function listReadCapabilities(): CapabilityAction[] {
  return (Object.entries(registry) as [CapabilityAction, MCPToolMapping][])
    .filter(([, m]) => !m.requireConfirm)
    .map(([k]) => k);
}

export function listWriteCapabilities(): CapabilityAction[] {
  return (Object.entries(registry) as [CapabilityAction, MCPToolMapping][])
    .filter(([, m]) => m.requireConfirm)
    .map(([k]) => k);
}

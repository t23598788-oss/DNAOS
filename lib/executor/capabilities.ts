/**
 * V6 Capabilities Registry
 *
 * ผูกกับ "ประเภทความสามารถ" ไม่ใช่แอป
 * เพิ่มแอปใหม่ = เพิ่ม Connector ไม่ต้องแก้ V6 code
 */

export type CapabilityType =
  | "location"
  | "communication"
  | "files"
  | "database"
  | "ai_models"
  | "automation"
  | "development"
  | "media";

export interface Tool {
  id: string;
  name: string;
  capability: CapabilityType;
  icon: string;
  available: boolean;
  handler: "url_scheme" | "mcp" | "api" | "supabase" | "browser";
}

export const CAPABILITIES: Record<CapabilityType, { label: string; icon: string }> = {
  location:      { label: "Location",      icon: "📍" },
  communication: { label: "Communication", icon: "💬" },
  files:         { label: "Files",         icon: "📁" },
  database:      { label: "Database",      icon: "🗄" },
  ai_models:     { label: "AI Models",     icon: "🤖" },
  automation:    { label: "Automation",    icon: "⚡" },
  development:   { label: "Development",  icon: "💻" },
  media:         { label: "Media",         icon: "📷" },
};

export const TOOLS: Tool[] = [
  // Location
  { id: "gps_current",    name: "ตำแหน่งปัจจุบัน",  capability: "location",      icon: "📍", available: true,  handler: "browser" },
  { id: "google_maps",    name: "Google Maps",       capability: "location",      icon: "🗺", available: true,  handler: "url_scheme" },
  { id: "gps_manual",     name: "ใส่พิกัดเอง",       capability: "location",      icon: "✏️", available: true,  handler: "browser" },

  // Communication
  { id: "line",           name: "LINE",              capability: "communication", icon: "💚", available: true,  handler: "url_scheme" },
  { id: "phone",          name: "โทรศัพท์",           capability: "communication", icon: "📞", available: true,  handler: "url_scheme" },
  { id: "email",          name: "Email",             capability: "communication", icon: "📧", available: false, handler: "mcp" },
  { id: "siri",           name: "Siri",              capability: "communication", icon: "🎙", available: true,  handler: "url_scheme" },

  // Files
  { id: "google_drive",   name: "Google Drive",      capability: "files",         icon: "📂", available: true,  handler: "mcp" },
  { id: "pdf_viewer",     name: "PDF",               capability: "files",         icon: "📄", available: true,  handler: "mcp" },
  { id: "photos",         name: "รูปภาพ",            capability: "files",         icon: "🖼", available: true,  handler: "browser" },
  { id: "clipboard",      name: "Clipboard",         capability: "files",         icon: "📋", available: true,  handler: "browser" },
  { id: "csv_import",     name: "Import CSV",        capability: "files",         icon: "📊", available: true,  handler: "api" },

  // Database
  { id: "supabase",       name: "Supabase",          capability: "database",      icon: "⚡", available: true,  handler: "supabase" },

  // AI Models
  { id: "openai",         name: "OpenAI GPT",        capability: "ai_models",     icon: "🧠", available: true,  handler: "api" },
  { id: "gemini",         name: "Gemini",            capability: "ai_models",     icon: "✨", available: true,  handler: "mcp" },
  { id: "claude",         name: "Claude",            capability: "ai_models",     icon: "🔵", available: true,  handler: "mcp" },

  // Automation
  { id: "mcp_tools",      name: "MCP Tools",         capability: "automation",    icon: "🔧", available: true,  handler: "mcp" },
  { id: "webhook",        name: "Webhook",           capability: "automation",    icon: "🔗", available: true,  handler: "api" },

  // Development
  { id: "github",         name: "GitHub",            capability: "development",   icon: "🐙", available: true,  handler: "mcp" },
  { id: "vscode",         name: "VS Code",           capability: "development",   icon: "📝", available: true,  handler: "url_scheme" },
  { id: "terminal",       name: "Terminal",          capability: "development",   icon: "⬛", available: true,  handler: "url_scheme" },

  // Media
  { id: "camera",         name: "กล้อง",             capability: "media",         icon: "📷", available: true,  handler: "browser" },
  { id: "microphone",     name: "ไมโครโฟน",          capability: "media",         icon: "🎤", available: true,  handler: "browser" },
  { id: "ocr",            name: "OCR",               capability: "media",         icon: "👁", available: false, handler: "api" },
];

export function getToolsByCapability(cap: CapabilityType): Tool[] {
  return TOOLS.filter((t) => t.capability === cap && t.available);
}

export function getAllAvailableTools(): Tool[] {
  return TOOLS.filter((t) => t.available);
}

export function findTool(id: string): Tool | undefined {
  return TOOLS.find((t) => t.id === id);
}

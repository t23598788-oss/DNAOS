/**
 * V6 Capabilities Registry
 *
 * ผูกกับ "ประเภทความสามารถ" ไม่ใช่แอป
 * ใช้ Official Brand Logo ไม่ใช่ emoji
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
  logo: string;
  available: boolean;
  handler: "url_scheme" | "mcp" | "api" | "supabase" | "browser";
}

export const CAPABILITIES: Record<CapabilityType, { label: string }> = {
  location:      { label: "Location" },
  communication: { label: "Communication" },
  files:         { label: "Files" },
  database:      { label: "Database" },
  ai_models:     { label: "AI Models" },
  automation:    { label: "Automation" },
  development:   { label: "Development" },
  media:         { label: "Media" },
};

// Brand SVG logos (CDN)
const L = {
  line:       "https://upload.wikimedia.org/wikipedia/commons/4/41/LINE_logo.svg",
  gmaps:      "https://upload.wikimedia.org/wikipedia/commons/a/aa/Google_Maps_icon_%282020%29.svg",
  gdrive:     "https://upload.wikimedia.org/wikipedia/commons/1/12/Google_Drive_icon_%282020%29.svg",
  github:     "https://upload.wikimedia.org/wikipedia/commons/9/91/Octicons-mark-github.svg",
  supabase:   "https://seeklogo.com/images/S/supabase-logo-DCC676FFE2-seeklogo.com.png",
  openai:     "https://upload.wikimedia.org/wikipedia/commons/0/04/ChatGPT_logo.svg",
  claude:     "https://upload.wikimedia.org/wikipedia/commons/8/8a/Claude_AI_logo.svg",
  gemini:     "https://upload.wikimedia.org/wikipedia/commons/8/8a/Google_Gemini_logo.svg",
  vscode:     "https://upload.wikimedia.org/wikipedia/commons/9/9a/Visual_Studio_Code_1.35_icon.svg",
  siri:       "https://upload.wikimedia.org/wikipedia/en/a/a0/Siri_logo.png",
  pdf:        "https://upload.wikimedia.org/wikipedia/commons/8/87/PDF_file_icon.svg",
};

export const TOOLS: Tool[] = [
  // Location
  { id: "gps_current",    name: "ตำแหน่งปัจจุบัน",  capability: "location",      logo: "📍", available: true,  handler: "browser" },
  { id: "google_maps",    name: "Google Maps",       capability: "location",      logo: L.gmaps, available: true,  handler: "url_scheme" },
  { id: "gps_manual",     name: "ใส่พิกัดเอง",       capability: "location",      logo: "✏️", available: true,  handler: "browser" },

  // Communication
  { id: "line",           name: "LINE",              capability: "communication", logo: L.line, available: true,  handler: "url_scheme" },
  { id: "phone",          name: "โทรศัพท์",           capability: "communication", logo: "📞", available: true,  handler: "url_scheme" },
  { id: "email",          name: "Email",             capability: "communication", logo: "✉️", available: false, handler: "mcp" },
  { id: "siri",           name: "Siri",              capability: "communication", logo: L.siri, available: true,  handler: "url_scheme" },

  // Files
  { id: "google_drive",   name: "Google Drive",      capability: "files",         logo: L.gdrive, available: true,  handler: "mcp" },
  { id: "pdf_viewer",     name: "PDF",               capability: "files",         logo: L.pdf, available: true,  handler: "mcp" },
  { id: "photos",         name: "รูปภาพ",            capability: "files",         logo: "🖼️", available: true,  handler: "browser" },
  { id: "clipboard",      name: "Clipboard",         capability: "files",         logo: "📋", available: true,  handler: "browser" },
  { id: "csv_import",     name: "Import CSV",        capability: "files",         logo: "📊", available: true,  handler: "api" },

  // Database
  { id: "supabase",       name: "Supabase",          capability: "database",      logo: L.supabase, available: true,  handler: "supabase" },

  // AI Models
  { id: "openai",         name: "OpenAI GPT",        capability: "ai_models",     logo: L.openai, available: true,  handler: "api" },
  { id: "gemini",         name: "Gemini",            capability: "ai_models",     logo: L.gemini, available: true,  handler: "mcp" },
  { id: "claude",         name: "Claude",            capability: "ai_models",     logo: L.claude, available: true,  handler: "mcp" },

  // Automation
  { id: "mcp_tools",      name: "MCP Tools",         capability: "automation",    logo: "🔌", available: true,  handler: "mcp" },
  { id: "webhook",        name: "Webhook",           capability: "automation",    logo: "🔗", available: true,  handler: "api" },

  // Development
  { id: "github",         name: "GitHub",            capability: "development",   logo: L.github, available: true,  handler: "mcp" },
  { id: "vscode",         name: "VS Code",           capability: "development",   logo: L.vscode, available: true,  handler: "url_scheme" },
  { id: "terminal",       name: "Terminal",          capability: "development",   logo: "⬛", available: true,  handler: "url_scheme" },

  // Media
  { id: "camera",         name: "กล้อง",             capability: "media",         logo: "📷", available: true,  handler: "browser" },
  { id: "microphone",     name: "ไมโครโฟน",          capability: "media",         logo: "🎤", available: true,  handler: "browser" },
  { id: "ocr",            name: "OCR",               capability: "media",         logo: "👁️", available: false, handler: "api" },
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

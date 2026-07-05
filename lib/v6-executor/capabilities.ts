/**
 * V6 Capability Registry
 *
 * แสดงเฉพาะ External Capability ที่ DNA OS เชื่อมต่อได้จริง
 * ไม่แสดง OS basics (Camera, Mic, Clipboard, Browser)
 * ใช้โลโก้จริง ห้ามใช้ Emoji
 * ทุกตัวมี status: connected / auth_required / offline / disabled
 */

export type CapabilityType =
  | "communication"
  | "maps"
  | "storage"
  | "database"
  | "ai"
  | "automation"
  | "development"
  | "business"
  | "social"
  | "cloud";

export type ToolStatus = "connected" | "auth_required" | "offline" | "disabled";

export interface Tool {
  id: string;
  name: string;
  capability: CapabilityType;
  logo: string;
  status: ToolStatus;
  handler: "url_scheme" | "mcp" | "api" | "supabase" | "driver";
  driver_app?: string;
  mcp_server?: string;
  last_sync?: string;
}

export const CAPABILITIES: Record<CapabilityType, { label: string }> = {
  communication: { label: "Communication" },
  maps:          { label: "Maps" },
  storage:       { label: "Storage" },
  database:      { label: "Database" },
  ai:            { label: "AI" },
  automation:    { label: "Automation" },
  development:   { label: "Development" },
  business:      { label: "Business" },
  social:        { label: "Social" },
  cloud:         { label: "Cloud" },
};

const L = {
  line:       "https://upload.wikimedia.org/wikipedia/commons/4/41/LINE_logo.svg",
  whatsapp:   "https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg",
  messenger:  "https://upload.wikimedia.org/wikipedia/commons/b/be/Facebook_Messenger_logo_2020.svg",
  telegram:   "https://upload.wikimedia.org/wikipedia/commons/8/82/Telegram_logo.svg",
  discord:    "https://assets-global.website-files.com/6257adef93867e50d84d30e2/636e0a69f118df70ad7828d4_icon_clyde_blurple_RGB.svg",
  slack:      "https://upload.wikimedia.org/wikipedia/commons/d/d5/Slack_icon_2019.svg",
  gmaps:      "https://upload.wikimedia.org/wikipedia/commons/a/aa/Google_Maps_icon_%282020%29.svg",
  gearth:     "https://upload.wikimedia.org/wikipedia/commons/e/e4/Google_Earth_icon.svg",
  gdrive:     "https://upload.wikimedia.org/wikipedia/commons/1/12/Google_Drive_icon_%282020%29.svg",
  onedrive:   "https://upload.wikimedia.org/wikipedia/commons/3/3c/Microsoft_Office_OneDrive_%282019%E2%80%93present%29.svg",
  dropbox:    "https://upload.wikimedia.org/wikipedia/commons/7/78/Dropbox_Icon.svg",
  supabase:   "https://seeklogo.com/images/S/supabase-logo-DCC676FFE2-seeklogo.com.png",
  openai:     "https://upload.wikimedia.org/wikipedia/commons/0/04/ChatGPT_logo.svg",
  claude:     "https://upload.wikimedia.org/wikipedia/commons/8/8a/Claude_AI_logo.svg",
  gemini:     "https://upload.wikimedia.org/wikipedia/commons/8/8a/Google_Gemini_logo.svg",
  github:     "https://upload.wikimedia.org/wikipedia/commons/9/91/Octicons-mark-github.svg",
  vscode:     "https://upload.wikimedia.org/wikipedia/commons/9/9a/Visual_Studio_Code_1.35_icon.svg",
  gmail:      "https://upload.wikimedia.org/wikipedia/commons/7/7e/Gmail_icon_%282020%29.svg",
  gcal:       "https://upload.wikimedia.org/wikipedia/commons/a/a5/Google_Calendar_icon_%282020%29.svg",
  pdf:        "https://upload.wikimedia.org/wikipedia/commons/8/87/PDF_file_icon.svg",
  vercel:     "https://assets.vercel.com/image/upload/front/favicon/vercel/favicon.ico",
  facebook:   "https://upload.wikimedia.org/wikipedia/commons/0/05/Facebook_Logo_%282019%29.png",
  instagram:  "https://upload.wikimedia.org/wikipedia/commons/a/a5/Instagram_icon.png",
  tiktok:     "https://upload.wikimedia.org/wikipedia/en/a/a9/TikTok_logo.svg",
  x:          "https://upload.wikimedia.org/wikipedia/commons/c/ce/X_logo_2023.svg",
};

export const TOOLS: Tool[] = [
  // Communication
  { id: "line",       name: "LINE",       capability: "communication", logo: L.line,      status: "connected",      handler: "driver",     driver_app: "line" },
  { id: "whatsapp",   name: "WhatsApp",   capability: "communication", logo: L.whatsapp,  status: "disabled",       handler: "mcp" },
  { id: "messenger",  name: "Messenger",  capability: "communication", logo: L.messenger, status: "disabled",       handler: "mcp" },
  { id: "telegram",   name: "Telegram",   capability: "communication", logo: L.telegram,  status: "disabled",       handler: "mcp" },
  { id: "discord",    name: "Discord",    capability: "communication", logo: L.discord,   status: "disabled",       handler: "mcp" },
  { id: "slack",      name: "Slack",      capability: "communication", logo: L.slack,     status: "connected",      handler: "mcp", mcp_server: "slack@openai-curated" },

  // Maps
  { id: "gmaps",      name: "Google Maps",  capability: "maps",    logo: L.gmaps,   status: "connected",      handler: "driver",     driver_app: "google maps" },
  { id: "gearth",     name: "Google Earth", capability: "maps",    logo: L.gearth,  status: "auth_required",  handler: "driver",     driver_app: "google earth" },

  // Storage
  { id: "gdrive",     name: "Google Drive", capability: "storage", logo: L.gdrive,  status: "connected",      handler: "mcp", mcp_server: "Google_Drive" },
  { id: "onedrive",   name: "OneDrive",     capability: "storage", logo: L.onedrive, status: "disabled",      handler: "mcp" },
  { id: "dropbox",    name: "Dropbox",      capability: "storage", logo: L.dropbox, status: "disabled",       handler: "mcp" },

  // Database
  { id: "supabase",   name: "Supabase",     capability: "database", logo: L.supabase, status: "connected",    handler: "supabase", mcp_server: "supabase@openai-curated" },

  // AI
  { id: "openai",     name: "OpenAI",    capability: "ai", logo: L.openai, status: "connected",      handler: "api" },
  { id: "claude",     name: "Claude",    capability: "ai", logo: L.claude, status: "connected",      handler: "mcp" },
  { id: "gemini",     name: "Gemini",    capability: "ai", logo: L.gemini, status: "connected",      handler: "mcp", mcp_server: "gemini" },

  // Automation
  { id: "mcp",        name: "MCP Tools", capability: "automation", logo: L.github,  status: "connected",      handler: "mcp" },

  // Development
  { id: "github",     name: "GitHub",    capability: "development", logo: L.github, status: "connected",      handler: "mcp", mcp_server: "github@openai-curated" },
  { id: "vscode",     name: "VS Code",   capability: "development", logo: L.vscode, status: "connected",      handler: "driver",     driver_app: "vs code" },

  // Business
  { id: "gmail",      name: "Gmail",     capability: "business", logo: L.gmail,   status: "connected",      handler: "mcp" },
  { id: "gcal",       name: "Calendar",  capability: "business", logo: L.gcal,    status: "connected",      handler: "mcp", mcp_server: "Google_Calendar" },
  { id: "pdf",        name: "PDF",       capability: "business", logo: L.pdf,     status: "connected",      handler: "mcp", mcp_server: "PDF_Viewer" },

  // Social
  { id: "facebook",   name: "Facebook",  capability: "social", logo: L.facebook,  status: "auth_required",  handler: "mcp" },
  { id: "instagram",  name: "Instagram", capability: "social", logo: L.instagram, status: "auth_required",  handler: "mcp" },
  { id: "tiktok",     name: "TikTok",    capability: "social", logo: L.tiktok,    status: "disabled",       handler: "mcp" },
  { id: "x",          name: "X",         capability: "social", logo: L.x,         status: "disabled",       handler: "mcp" },

  // Cloud
  { id: "vercel",     name: "Vercel",    capability: "cloud", logo: L.vercel,    status: "connected",      handler: "mcp", mcp_server: "vercel@openai-curated" },
];

export function getToolsByCapability(cap: CapabilityType): Tool[] {
  return TOOLS.filter((t) => t.capability === cap);
}

export function getConnectedTools(): Tool[] {
  return TOOLS.filter((t) => t.status === "connected");
}

export function findTool(id: string): Tool | undefined {
  return TOOLS.find((t) => t.id === id);
}

export function getStatusColor(status: ToolStatus): string {
  switch (status) {
    case "connected": return "#22c55e";
    case "auth_required": return "#f59e0b";
    case "offline": return "#ef4444";
    case "disabled": return "#555";
  }
}

export function getStatusLabel(status: ToolStatus): string {
  switch (status) {
    case "connected": return "Connected";
    case "auth_required": return "Authorization Required";
    case "offline": return "Offline";
    case "disabled": return "Disabled";
  }
}

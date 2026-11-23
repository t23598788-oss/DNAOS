/**
 * Visual Asset Inventory — ข้อมูลสำหรับหน้าจอ Review เท่านั้น
 *
 * ทุกแถวอ้าง source จริง (path + bytes + sha256) · ไม่มี asset ปลอม
 * รายการที่ระบบยังไม่มี asset จะเป็น state "MISSING_ASSET" / "REVIEW_REQUIRED"
 * ตามที่ทะเบียนจริงของ DNA-OS-INFRASTRUCTURE ประกาศไว้ — ไม่补齐ด้วยไอคอนที่แต่งขึ้น
 *
 * ที่มา:
 *   - DNA-OS: public/** · app/favicon.ico · src-tauri/icons/** · presentation/assets/manifest.ts
 *   - DNA-OS-INFRASTRUCTURE: connections/connection-registry/{brand-assets/**, provider-metadata.ts}
 *   - icon component: 110 ตัวที่ระบบใช้จริง (ดู iconRegistry.ts)
 *   - business module icons: app/admin/relationships/workspace.tsx :: RAIL_ITEMS
 */

export type AssetState = "PRESENT" | "UNUSED" | "DUPLICATE" | "MISSING_ASSET" | "REVIEW_REQUIRED";

export interface VisualAsset {
  key: string;
  displayName: string;
  category: "BRAND" | "APP_ICON" | "INTEGRATION" | "PWA";
  /** public URL — มีเฉพาะไฟล์ที่อยู่ใน public/ จริง (นอกนั้น null แล้วแสดง placeholder) */
  url: string | null;
  sourcePath: string;
  bytes: number | null;
  sha256Prefix: string | null;
  state: AssetState;
  usedBy: string[];
  note?: string;
}

export interface ProviderBrandEntry {
  providerId: string;
  displayName: string;
  /** ประกาศใน DNA-OS-INFRASTRUCTURE/connections/connection-registry/provider-metadata.ts */
  assetState: AssetState;
  assetRef: string | null;
  note?: string;
}

export interface BusinessModuleIconEntry {
  key: string;
  label: string;
  iconName: string;
  evidencePath: string;
}

// ── 1) BRAND / APP / PWA assets — ไฟล์จริงในเครื่อง ──────────────────────────

export const BRAND_ASSETS: VisualAsset[] = [
  {
    key: "dna-os-mark",
    displayName: "DNA OS — master mark (D สี่เหลี่ยมสีรุ้ง + NA OS)",
    category: "BRAND",
    url: "/brand/dna-os-mark-d.png",
    sourcePath: "public/brand/dna-os-mark-d.png",
    bytes: 49940,
    sha256Prefix: "e48d08e6",
    state: "PRESENT",
    usedBy: ["app/login/page.tsx", "app/admin/ui-gallery/_lib/componentHost.tsx"],
    note: "OFFICIAL master brand asset — byte-identical กับ INFRA brand-assets/dna-os/dna-os-mark-d.png (มี PROVENANCE.md)",
  },
  {
    key: "dna-os-integration-generic",
    displayName: "DNA OS — generic integration mark",
    category: "INTEGRATION",
    url: "/brand/dna-os-integration-generic.svg",
    sourcePath: "public/brand/dna-os-integration-generic.svg",
    bytes: 481,
    sha256Prefix: "91966cae",
    state: "PRESENT",
    usedBy: ["หน้าจอนี้ (คัดลอก byte-identical จาก INFRA เพื่อให้แสดงได้จริง)"],
    note: "INFRA ใช้ mark นี้กับ capability ภายใน (calculator · files · pdf · printer · computer · server)",
  },
  {
    key: "pwa-512",
    displayName: "PWA icon 512",
    category: "PWA",
    url: "/icons/icon-512.png",
    sourcePath: "public/icons/icon-512.png",
    bytes: 36229,
    sha256Prefix: "e48fa4dd",
    state: "PRESENT",
    usedBy: ["public/manifest.json", "presentation/assets/manifest.ts"],
  },
  {
    key: "pwa-192",
    displayName: "PWA icon 192",
    category: "PWA",
    url: "/icons/icon-192.png",
    sourcePath: "public/icons/icon-192.png",
    bytes: 8590,
    sha256Prefix: "5c69155e",
    state: "PRESENT",
    usedBy: ["public/manifest.json", "presentation/assets/manifest.ts"],
  },
  {
    key: "apple-touch-icon",
    displayName: "Apple touch icon",
    category: "PWA",
    url: "/icons/apple-touch-icon.png",
    sourcePath: "public/icons/apple-touch-icon.png",
    bytes: 7798,
    sha256Prefix: "cea2cd83",
    state: "PRESENT",
    usedBy: ["app/layout.tsx", "presentation/assets/manifest.ts"],
  },
  {
    key: "favicon-app",
    displayName: "favicon (app/)",
    category: "APP_ICON",
    url: null,
    sourcePath: "app/favicon.ico",
    bytes: 25931,
    sha256Prefix: "2b8ad2d3",
    state: "DUPLICATE",
    usedBy: ["Next.js ใช้ app/favicon.ico อัตโนมัติ"],
    note: "คนละภาพกับ public/favicon.ico (745 bytes) — 2 ไฟล์ทำหน้าที่เดียวกัน",
  },
  {
    key: "favicon-public",
    displayName: "favicon (public/)",
    category: "APP_ICON",
    url: "/favicon.ico",
    sourcePath: "public/favicon.ico",
    bytes: 745,
    sha256Prefix: "72200a93",
    state: "DUPLICATE",
    usedBy: ["public/manifest.json"],
    note: "คนละภาพกับ app/favicon.ico",
  },
  {
    key: "next-svg",
    displayName: "next.svg (ค่าเริ่มต้น Next.js)",
    category: "BRAND",
    url: "/next.svg",
    sourcePath: "public/next.svg",
    bytes: 1375,
    sha256Prefix: "55995dfa",
    state: "UNUSED",
    usedBy: [],
    note: "0 การอ้างอิงในโค้ด",
  },
  {
    key: "vercel-svg",
    displayName: "vercel.svg (ค่าเริ่มต้น Next.js)",
    category: "BRAND",
    url: "/vercel.svg",
    sourcePath: "public/vercel.svg",
    bytes: 128,
    sha256Prefix: "f081337b",
    state: "UNUSED",
    usedBy: [],
    note: "0 การอ้างอิงในโค้ด",
  },
  {
    key: "window-svg",
    displayName: "window.svg (ค่าเริ่มต้น Next.js)",
    category: "BRAND",
    url: "/window.svg",
    sourcePath: "public/window.svg",
    bytes: 385,
    sha256Prefix: "644768c4",
    state: "UNUSED",
    usedBy: [],
    note: "0 การอ้างอิงในโค้ด",
  },
  {
    key: "desktop-icon-set",
    displayName: "Desktop app icon set (Tauri · 29 ไฟล์หลายขนาด + .icns)",
    category: "APP_ICON",
    url: "/icons/icon-512.png",
    sourcePath: "src-tauri/icons/**",
    bytes: null,
    sha256Prefix: null,
    state: "PRESENT",
    usedBy: ["src-tauri build (แอปเดสก์ท็อป)"],
    note: "ยกตัวอย่าง 1 ขนาดบนหน้าจอ — ชุดนี้มี 5 กลุ่มที่เป็นภาพเดียวกันซ้ำ (iOS subset)",
  },
];

// ── 2) PROVIDER LOGOS — ทะเบียนจริงของ INFRA (asset_state มาจาก source) ───────

export const PROVIDER_BRANDS: ProviderBrandEntry[] = [
  { providerId: "dna-os", displayName: "DNA OS", assetState: "PRESENT", assetRef: "asset://provider-brand/dna-os/dna-os-mark-d.png" },
  { providerId: "github", displayName: "GitHub", assetState: "REVIEW_REQUIRED", assetRef: null, note: "ทะเบียนยังไม่ประกาศ official_brand_asset_ref" },
  { providerId: "digitalocean", displayName: "DigitalOcean", assetState: "REVIEW_REQUIRED", assetRef: null },
  { providerId: "supabase", displayName: "Supabase", assetState: "REVIEW_REQUIRED", assetRef: null },
  { providerId: "google", displayName: "Google Workspace", assetState: "MISSING_ASSET", assetRef: null },
  { providerId: "google-gmail", displayName: "Gmail", assetState: "MISSING_ASSET", assetRef: null },
  { providerId: "google-calendar", displayName: "Google Calendar", assetState: "MISSING_ASSET", assetRef: null },
  { providerId: "google-drive", displayName: "Google Drive", assetState: "MISSING_ASSET", assetRef: null },
  { providerId: "google-sheets", displayName: "Google Sheets", assetState: "MISSING_ASSET", assetRef: null },
  { providerId: "vercel", displayName: "Vercel", assetState: "MISSING_ASSET", assetRef: null },
  { providerId: "railway", displayName: "Railway", assetState: "MISSING_ASSET", assetRef: null },
  { providerId: "n8n", displayName: "n8n", assetState: "MISSING_ASSET", assetRef: null },
  { providerId: "line", displayName: "LINE (LINE OA)", assetState: "MISSING_ASSET", assetRef: null, note: "ยังไม่มีโลโก้ LINE ในระบบ — ต้องได้ asset ทางการก่อนจึงจะแสดงได้" },
  { providerId: "facebook", displayName: "Facebook", assetState: "MISSING_ASSET", assetRef: null },
  { providerId: "meta", displayName: "Meta", assetState: "MISSING_ASSET", assetRef: null, note: "ทะเบียนมี 2 แถวที่ใช้ provider_id เดียวกัน" },
  { providerId: "instagram", displayName: "Instagram", assetState: "MISSING_ASSET", assetRef: null },
  { providerId: "tiktok", displayName: "TikTok", assetState: "MISSING_ASSET", assetRef: null, note: "ทะเบียนมี 2 แถว" },
  { providerId: "gemini", displayName: "Gemini", assetState: "MISSING_ASSET", assetRef: null },
  { providerId: "chatgpt", displayName: "ChatGPT", assetState: "MISSING_ASSET", assetRef: null, note: "ทะเบียนมี 2 แถว" },
  { providerId: "vscode", displayName: "VS Code", assetState: "MISSING_ASSET", assetRef: null },
];

export const INTERNAL_CAPABILITY_IDENTITIES: ProviderBrandEntry[] = [
  { providerId: "calculator", displayName: "Calculator", assetState: "PRESENT", assetRef: "generic integration mark" },
  { providerId: "files", displayName: "Files", assetState: "PRESENT", assetRef: "generic integration mark" },
  { providerId: "pdf", displayName: "PDF", assetState: "PRESENT", assetRef: "generic integration mark" },
  { providerId: "printer", displayName: "Printer", assetState: "PRESENT", assetRef: "generic integration mark" },
  { providerId: "computer", displayName: "Computer", assetState: "PRESENT", assetRef: "generic integration mark" },
  { providerId: "server", displayName: "Server", assetState: "PRESENT", assetRef: "generic integration mark" },
];

// ── 3) BUSINESS MODULE ICONS — icon ที่ระบบใช้จริงต่อโมดูล ────────────────────

export const BUSINESS_MODULE_ICONS: BusinessModuleIconEntry[] = [
  { key: "relationships", label: "ข้อความ", iconName: "MessageCircle", evidencePath: "app/admin/relationships/workspace.tsx" },
  { key: "line-customers", label: "LINE", iconName: "MessageCircle", evidencePath: "app/admin/line-customers/page.tsx" },
  { key: "jobs", label: "งาน", iconName: "Briefcase", evidencePath: "app/admin/relationships/workspace.tsx" },
  { key: "partners", label: "คู่ค้า", iconName: "Building2", evidencePath: "app/admin/relationships/workspace.tsx" },
  { key: "transactions", label: "เอกสาร", iconName: "FileText", evidencePath: "app/admin/relationships/workspace.tsx" },
  { key: "debt-tracking", label: "การเงิน", iconName: "Wallet", evidencePath: "app/admin/relationships/workspace.tsx" },
  { key: "pits", label: "บ่อวัสดุ", iconName: "Mountain", evidencePath: "app/admin/relationships/workspace.tsx" },
  { key: "equipment", label: "เครื่องยนต์ / ยานพาหนะ", iconName: "Wrench", evidencePath: "app/admin/relationships/workspace.tsx" },
  { key: "finance", label: "ภาพรวมการเงิน", iconName: "BarChart3", evidencePath: "app/admin/relationships/workspace.tsx" },
  { key: "telemetry", label: "สถาปัตยกรรม", iconName: "Satellite", evidencePath: "app/admin/relationships/workspace.tsx" },
  { key: "infrastructure", label: "ค่าใช้จ่าย / เซิร์ฟเวอร์", iconName: "Server", evidencePath: "app/admin/relationships/workspace.tsx" },
  { key: "runpod", label: "Cloud GPU", iconName: "Cloud", evidencePath: "app/admin/relationships/workspace.tsx" },
  { key: "build", label: "ระบบ", iconName: "Settings", evidencePath: "app/admin/relationships/workspace.tsx" },
];

export const VISUAL_ASSET_SOURCE_NOTES: string[] = [
  "ตัวเลขนับจากไฟล์จริงในเครื่อง: 64 ไฟล์ภาพ (58 unique ตาม sha256) ใน DNA-OS + brand-assets ของ INFRA",
  "provider brand state มาจาก DNA-OS-INFRASTRUCTURE/connections/connection-registry/provider-metadata.ts (27 แถว · 20 provider_id distinct)",
  "icon component 110 ตัว = lucide-react ที่ import จริงใน 35 ไฟล์ (app/ · components/ · presentation/ · core/) ไม่ใช่ไอคอนทั้งไลบรารี",
  "business module icon มาจาก RAIL_ITEMS ที่ใช้งานจริง — ไม่ได้อนุมานจากชื่อ",
  "ห้าม补齐รายการที่ไม่มี asset ด้วยไอคอนที่แต่งขึ้น — แสดง placeholder + ชื่อ + สถานะแทน",
];

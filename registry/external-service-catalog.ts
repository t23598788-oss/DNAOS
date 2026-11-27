/**
 * DNA OS external-service directory.
 *
 * This is descriptive, non-secret metadata for navigation and provenance.
 * System connectors (DNA OS runtime) are kept separate from user-owned grants.
 * A catalog entry does not imply that a user OAuth flow is implemented.
 */
export type ServiceClass = "runtime" | "external" | "mcp";
export type UserConnectionState = "not_implemented" | "api_key" | "oauth";
export type ConnectionCategoryId = "identity" | "ai" | "channels" | "business-data" | "cloud" | "developer-protocols";

export interface ConnectionCategory {
  id: ConnectionCategoryId;
  name: string;
  description: string;
  purpose: string;
  identityOnly?: boolean;
}

export const CONNECTION_CATEGORIES: readonly ConnectionCategory[] = [
  {
    id: "identity",
    name: "บัญชีสำหรับยืนยันตัวตน",
    description: "ผูกบัญชีผู้ให้บริการเข้ากับบัญชี DNA OS ที่เข้าสู่ระบบอยู่",
    purpose: "ใช้ยืนยันว่าเป็นผู้ใช้คนเดิมและคงสิทธิ์องค์กรเดิม ไม่ได้เปิดสิทธิ์ให้ส่งข้อความหรืออ่านข้อมูลธุรกิจจากบริการนั้น",
    identityOnly: true,
  },
  {
    id: "ai",
    name: "AI API ที่ DNA OS เรียกใช้ (ตัวเลือก)",
    description: "บัญชี API ของผู้ให้บริการ AI ที่ DNA OS อาจเรียกใช้ตามการตั้งค่าขององค์กร",
    purpose: "เป็นการเชื่อมต่อขาออกจาก DNA OS ไปยัง API ของผู้ให้บริการ AI; แยกจากกรณีที่ AI ของผู้ซื้อเรียก API หรือเครื่องมือของ DNA OS โดยตรง และไม่เท่ากับการล็อกอิน ChatGPT/Gemini ของผู้ซื้อ",
  },
  {
    id: "channels",
    name: "ช่องทางลูกค้าและข้อความ",
    description: "บัญชีหรือระบบที่รับส่งข้อความและเหตุการณ์จากช่องทางลูกค้า",
    purpose: "ใช้รับเหตุการณ์จากช่องทางภายนอก แล้วส่งต่อเข้าการประมวลผลของ DNA OS ตามสิทธิ์และการเชื่อมต่อที่ตั้งไว้",
  },
  {
    id: "business-data",
    name: "ข้อมูลและระบบธุรกิจ",
    description: "บริการข้อมูล สถานที่ และฐานข้อมูลที่ปรากฏในโค้ดของระบบ",
    purpose: "ใช้เชื่อมข้อมูลอ้างอิงหรือข้อมูลธุรกิจตามขอบเขตที่ผู้ให้บริการและองค์กรอนุญาต",
  },
  {
    id: "cloud",
    name: "คลาวด์และโครงสร้างพื้นฐาน",
    description: "บริการโฮสต์ ประมวลผล และเครื่องมือจัดการระบบ",
    purpose: "ใช้กับงานระบบและทรัพยากรคลาวด์ โดยแยกบัญชีระบบออกจากบัญชีส่วนตัวของผู้ใช้",
  },
  {
    id: "developer-protocols",
    name: "เครื่องมือนักพัฒนาและโปรโตคอล",
    description: "แหล่งโค้ด เครื่องมือเชื่อมต่อ และมาตรฐานสื่อสารระหว่างระบบ",
    purpose: "ใช้เปิดทางให้นักพัฒนาเชื่อมเครื่องมือหรือบริการตามสัญญาและสิทธิ์ของแต่ละตัว",
  },
] as const;

export interface ExternalServiceCatalogEntry {
  id: string;
  name: string;
  mark: string;
  categoryId: Exclude<ConnectionCategoryId, "identity">;
  serviceClass: ServiceClass;
  description: string;
  sourceUrl: string;
  sourceLabel: string;
  codePaths: string[];
  userConnection: UserConnectionState;
}

export const EXTERNAL_SERVICE_CATALOG: readonly ExternalServiceCatalogEntry[] = [
  {
    id: "digitalocean-runtime",
    name: "DigitalOcean",
    mark: "DO",
    categoryId: "cloud",
    serviceClass: "runtime",
    description: "ชั้นประมวลผลเป้าหมายของ DNA OS; ในโค้ดมี AI Inference adapter ใน Worker/IDE แต่ยังไม่ใช่เส้นทางหลักของ AI Gateway สำหรับผู้ใช้ทั่วไป",
    sourceUrl: "https://docs.digitalocean.com/",
    sourceLabel: "เอกสาร DigitalOcean",
    codePaths: ["app/api/admin/ide/_lib/workerAdapters/digitalOceanWorkerAdapter.ts", "registry/ai-adapter-registry.json", "app/api/admin/digitalocean"],
    userConnection: "not_implemented",
  },
  {
    id: "cloudflare-workers-bindings-mcp",
    name: "Cloudflare Workers Bindings MCP",
    mark: "CF",
    categoryId: "cloud",
    serviceClass: "mcp",
    description: "ปลั๊กอิน MCP สำหรับเครื่องมือ Workers และ resource bindings ของบัญชี Cloudflare",
    sourceUrl: "https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/",
    sourceLabel: "แหล่งปลั๊กอินและเอกสารทางการ",
    codePaths: [],
    userConnection: "not_implemented",
  },
  {
    id: "openai-api",
    name: "OpenAI API",
    mark: "OA",
    categoryId: "ai",
    serviceClass: "external",
    description: "การเชื่อมต่อขาออกจาก DNA OS ไปยัง OpenAI API; แยกจากบัญชี ChatGPT ของผู้ซื้อและจาก AI ภายนอกที่เรียก DNA OS API",
    sourceUrl: "https://platform.openai.com/docs/",
    sourceLabel: "เอกสาร OpenAI API",
    codePaths: ["services/ai", "services/ai-connection"],
    userConnection: "api_key",
  },
  {
    id: "anthropic-api",
    name: "Anthropic API",
    mark: "AN",
    categoryId: "ai",
    serviceClass: "external",
    description: "การเชื่อมต่อขาออกจาก DNA OS ไปยัง Anthropic API ด้วยสิทธิ์ที่องค์กรอนุมัติ; ไม่ใช่การเชื่อมบัญชี AI ของผู้ซื้อ",
    sourceUrl: "https://docs.anthropic.com/en/api/getting-started",
    sourceLabel: "เอกสาร Anthropic API",
    codePaths: ["services/ai", "services/ai/bridge-claude.ts"],
    userConnection: "api_key",
  },
  {
    id: "google-gemini-api",
    name: "Google Gemini API",
    mark: "G",
    categoryId: "ai",
    serviceClass: "external",
    description: "การเชื่อมต่อขาออกจาก DNA OS ไปยัง Gemini API; แยกจาก Google Sign-in และจาก AI ภายนอกที่เรียก DNA OS API",
    sourceUrl: "https://ai.google.dev/gemini-api/docs",
    sourceLabel: "เอกสาร Gemini API",
    codePaths: ["services/ai", "services/ai/adapters.ts"],
    userConnection: "api_key",
  },
  {
    id: "github",
    name: "GitHub",
    mark: "GH",
    categoryId: "developer-protocols",
    serviceClass: "external",
    description: "เชื่อมบัญชี GitHub ของผู้ใช้ผ่าน OAuth; token เก็บแยกบัญชีในระบบหลังบ้าน",
    sourceUrl: "https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps",
    sourceLabel: "เอกสาร GitHub OAuth",
    codePaths: ["engines/connectors/providers/github.ts", "app/api/connectors/oauth"],
    userConnection: "oauth",
  },
  {
    id: "line",
    name: "LINE Official Account",
    mark: "LINE",
    categoryId: "channels",
    serviceClass: "external",
    description: "ตั้งค่า Webhook URL, Channel Secret และ Channel access token แยกตามบัญชี DNA OS ได้",
    sourceUrl: "https://developers.line.biz/en/docs/",
    sourceLabel: "เอกสาร LINE Developers",
    codePaths: ["app/account/connections/LineConnectionDetail.tsx", "app/api/account/connections/line/route.ts", "supabase/migrations/20261126000001_line_channel_account_ownership.sql", "engines/connectors/providers/line.ts", "engines/connect/accounts.ts"],
    userConnection: "api_key",
  },
  {
    id: "google-maps",
    name: "Google Maps Platform",
    mark: "GM",
    categoryId: "business-data",
    serviceClass: "external",
    description: "มีการค้นหาสถานที่และระยะทางในระบบ; ยังไม่รองรับ credential แยกตามผู้ใช้",
    sourceUrl: "https://developers.google.com/maps/documentation",
    sourceLabel: "เอกสาร Google Maps Platform",
    codePaths: ["engines/place-discovery.ts", "registry/PROVIDER_DIRECTORY.json"],
    userConnection: "not_implemented",
  },
  {
    id: "gmail",
    name: "Gmail · บัญชีระบบ",
    mark: "GM",
    categoryId: "channels",
    serviceClass: "runtime",
    description: "บัญชีกลางของ DNA OS สำหรับงานอีเมลภายใน; ผู้ใช้ไม่ต้องเชื่อม Gmail ส่วนตัว",
    sourceUrl: "https://developers.google.com/gmail/api",
    sourceLabel: "เอกสาร Gmail API",
    codePaths: ["app/api/internal/gmail/token/route.ts", "supabase/functions/_shared/gmail-client.ts"],
    userConnection: "not_implemented",
  },
  {
    id: "supabase",
    name: "Supabase",
    mark: "SB",
    categoryId: "business-data",
    serviceClass: "external",
    description: "บริการฐานข้อมูลและยืนยันตัวตนของระบบ; หน้านี้ไม่เปิดให้บัญชีผู้ใช้เชื่อมโปรเจกต์ส่วนตัว",
    sourceUrl: "https://supabase.com/docs",
    sourceLabel: "เอกสาร Supabase",
    codePaths: ["services/supabase", "supabase/migrations"],
    userConnection: "not_implemented",
  },
  {
    id: "vercel",
    name: "Vercel",
    mark: "V",
    categoryId: "cloud",
    serviceClass: "external",
    description: "มี adapter สำหรับสถานะและ deployment ฝั่งระบบ; ยังไม่แยกการอนุญาตตามผู้ใช้",
    sourceUrl: "https://vercel.com/docs",
    sourceLabel: "เอกสาร Vercel",
    codePaths: ["engines/integration-gateway/adapters/vercel.ts", "app/api/deploy/route.ts"],
    userConnection: "not_implemented",
  },
  {
    id: "runpod",
    name: "RunPod",
    mark: "RP",
    categoryId: "ai",
    serviceClass: "external",
    description: "มีตัวควบคุม Pod สำหรับสั่งเริ่ม หยุด และอ่านสถานะ GPU; ยังไม่ได้ต่อเข้ากับตัวเฝ้างาน AI หลัก",
    sourceUrl: "https://docs.runpod.io/",
    sourceLabel: "เอกสาร RunPod",
    codePaths: ["local-runtime/runpod-controller.mjs", "registry/COMPUTE_RESOURCE_REGISTRY.json", "registry/PROVIDER_DIRECTORY.json"],
    userConnection: "not_implemented",
  },
  {
    id: "openclaw",
    name: "OpenClaw + Pinto",
    mark: "OC",
    categoryId: "channels",
    serviceClass: "external",
    description: "มี bridge สำหรับช่องทางมือถือระดับระบบ; ยังไม่ใช่การเชื่อมบัญชีส่วนตัวของผู้ใช้",
    sourceUrl: "https://github.com/openclaw/openclaw",
    sourceLabel: "โค้ดต้นทาง OpenClaw",
    codePaths: ["app/api/internal/openclaw/command/route.ts", "supabase/functions/openclaw-webhook"],
    userConnection: "not_implemented",
  },
  {
    id: "facebook-messenger",
    name: "Facebook Pages · Messenger",
    mark: "f",
    categoryId: "channels",
    serviceClass: "external",
    description: "มีท่อรับ webhook ของเพจ ตรวจลายเซ็น แล้วส่งเหตุการณ์เข้า Integration Gateway แบบ Observe พร้อมตอบรับ webhook; การผูกเพจรายบัญชีและการส่งข้อความหาลูกค้ายังแยกเป็นขั้นถัดไป",
    sourceUrl: "https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-pages",
    sourceLabel: "เอกสาร Meta Webhooks for Pages",
    codePaths: ["app/api/gateway/observe/meta/route.ts", "engines/integration-gateway/adapters/meta.ts", "engines/integration-gateway/event-bus/bus.ts", "public/docs/integrations/facebook-messenger.md"],
    userConnection: "not_implemented",
  },
  {
    id: "railway",
    name: "Railway",
    mark: "RW",
    categoryId: "cloud",
    serviceClass: "external",
    description: "มี Connect contract สำหรับระบบ; การเชื่อมบัญชีของผู้ใช้รายคนยังต้องแยก credential",
    sourceUrl: "https://docs.railway.com/",
    sourceLabel: "เอกสาร Railway",
    codePaths: ["engines/connectors/providers/railway.ts", "engines/domains/railway-binding.ts"],
    userConnection: "not_implemented",
  },
  {
    id: "kodchat",
    name: "Kob Chat",
    mark: "KC",
    categoryId: "channels",
    serviceClass: "external",
    description: "มี adapter และ webhook integration ระดับระบบ; ยังไม่รองรับการเชื่อมบัญชีผู้ขายรายคน",
    sourceUrl: "",
    sourceLabel: "ดูจุดอ้างอิงในซอร์สโค้ด",
    codePaths: ["engines/connectors/providers/kodchat.ts", "engines/integration-gateway/adapters/kodchat.ts"],
    userConnection: "not_implemented",
  },
  {
    id: "mcp-protocol",
    name: "MCP servers",
    mark: "MCP",
    categoryId: "developer-protocols",
    serviceClass: "mcp",
    description: "MCP เป็นมาตรฐานเชื่อมเครื่องมือ ไม่ใช่ผู้ให้บริการรายเดียว; การเชื่อมแต่ละ server ต้องตรวจ OAuth และสิทธิ์แยกกัน",
    sourceUrl: "https://modelcontextprotocol.io/",
    sourceLabel: "เอกสาร Model Context Protocol",
    codePaths: ["engines/connectors/contract.ts", "engines/connectors/registry.ts"],
    userConnection: "not_implemented",
  },
  {
    id: "sip",
    name: "SIP services",
    mark: "SIP",
    categoryId: "developer-protocols",
    serviceClass: "external",
    description: "SIP เป็นมาตรฐานสื่อสาร ไม่ใช่ผู้ให้บริการ; ยังไม่พบ connector สำหรับบัญชีผู้ใช้ในระบบ",
    sourceUrl: "https://www.rfc-editor.org/rfc/rfc3261",
    sourceLabel: "มาตรฐาน SIP (RFC 3261)",
    codePaths: ["registry/PROVIDER_DIRECTORY.json"],
    userConnection: "not_implemented",
  },
];

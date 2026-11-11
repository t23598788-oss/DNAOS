/**
 * registry/developer-portal-spec.ts
 *
 * The single, machine-readable source for the DNA OS Developer Portal.
 *
 * Two surfaces read this file and never keep their own copy:
 *   - app/admin/docs/page.tsx            (human portal: sidebar + spec detail)
 *   - app/api/v1/developer-portal/route.ts (JSON index for AI agents / connectors)
 *
 * Every endpoint below was read from its real route handler, and every registry
 * reference is a real file in registry/. Adding a new endpoint means adding it
 * here once; both surfaces update together.
 */

export const PORTAL_SPEC_VERSION = "1.0";

export type HttpMethod = "GET" | "POST" | "OPTIONS";
export type ParamLocation = "header" | "path" | "query" | "body";

export interface ParamSpec {
  name: string;
  location: ParamLocation;
  type: string;
  required: boolean;
  description: string;
  example?: string;
}

export interface EndpointSpec {
  id: string;
  method: HttpMethod;
  path: string;
  auth: string;
  summary: string;
  params: ParamSpec[];
  requestSample?: string;
  responseSample: string;
  verification: string[];
  registryRefs: string[];
}

export interface TableSpec {
  columns: string[];
  rows: string[][];
}

export interface CodeSpec {
  language: string;
  content: string;
}

export interface SectionSpec {
  id: string;
  heading: string;
  lead?: string;
  paragraphs?: string[];
  bullets?: string[];
  table?: TableSpec;
  code?: CodeSpec;
  endpoints?: EndpointSpec[];
}

export interface DocSpec {
  slug: string;
  category: string;
  title: string;
  titleEn: string;
  summary: string;
  sections: SectionSpec[];
}

export interface CategorySpec {
  id: string;
  icon: string;
  title: string;
  titleEn: string;
  summary: string;
}

export interface EndpointIndexEntry {
  method: HttpMethod;
  path: string;
  auth: string;
  summary: string;
  doc: string;
  section: string;
}

export const CATEGORIES: CategorySpec[] = [
  {
    id: "system",
    icon: "🏛️",
    title: "สถาปัตยกรรมและเลเยอร์หลัก",
    titleEn: "System Architecture & Core Layers",
    summary:
      "โครงสร้างเลเยอร์ ทิศทางการพึ่งพา ลำดับการทำงานของคำขอ และ Registry ที่เป็นแหล่งความจริงเดียวของระบบ",
  },
  {
    id: "engines",
    icon: "⚙️",
    title: "เครื่องยนต์ธุรกิจและการคำนวณ",
    titleEn: "Business Engines & Pricing",
    summary:
      "สัญญาของเครื่องยนต์ราคา ภาษี ต้นทุน และเส้นทาง dispatch ที่แปลง command เป็นผลลัพธ์ธุรกิจจริง",
  },
  {
    id: "api",
    icon: "🔌",
    title: "สเปกการเชื่อมต่อและโครงสร้างข้อมูล",
    titleEn: "API Endpoints & Request Schemas",
    summary:
      "Endpoint จริงทั้งหมด พร้อม header, body schema, ตัวอย่าง JSON, รหัสข้อผิดพลาด และขั้นตอนทดสอบ",
  },
  {
    id: "integrations",
    icon: "💬",
    title: "การเชื่อมต่อ LINE, Bot และ Mini App",
    titleEn: "Integrations & Mini Apps",
    summary:
      "Webhook ของ LINE, MCP Server สำหรับ AI agents, และวงจรชีวิตของ Connector ที่ผูกกับ Provider Registry",
  },
  {
    id: "settings",
    icon: "🔐",
    title: "การจัดการคีย์ ระบบสิทธิ์ และเกณฑ์ความปลอดภัย",
    titleEn: "Settings & Security",
    summary:
      "ตัวแปรสภาพแวดล้อม ระดับสิทธิ์ของบัญชีและ token ขอบเขตข้อมูล และเกณฑ์ deploy-gate ที่บังคับใช้ก่อนทุก release",
  },
];

const p = (
  name: string,
  location: ParamLocation,
  type: string,
  required: boolean,
  description: string,
  example?: string,
): ParamSpec => ({ name, location, type, required, description, example });

// ─────────────────────────────────────────────────────────────────────────────
// Category: system
// ─────────────────────────────────────────────────────────────────────────────

const systemOverview: DocSpec = {
  slug: "architecture-overview",
  category: "system",
  title: "ภาพรวมสถาปัตยกรรมระบบ",
  titleEn: "Architecture Overview",
  summary:
    "DNA OS แบ่งเป็น 8 เลเยอร์ที่พึ่งพาได้ทางเดียว (UI → API → Engine → Core → Services) โดยมี Registry เป็นแหล่งความจริงกลางที่ทุกเลเยอร์อ่าน",
  sections: [
    {
      id: "layers",
      heading: "เลเยอร์หลักและความรับผิดชอบ",
      lead: "ทุกโมดูลต้องประกาศเลเยอร์ของตนใน registry/module-registry.json และถูกตรวจซ้ำโดย architecture book ในทุกการคอมไพล์",
      table: {
        columns: ["เลเยอร์", "พาธ", "ความรับผิดชอบ", "Registry ที่อ้างอิง"],
        rows: [
          ["UI / Presentation", "app/, components/, presenter/", "หน้าเว็บ, shell, การแสดงผล และการเรียก API ผ่าน route handler", "portals.json, architecture.json"],
          ["API / Gateway", "app/api/, gateway/", "รับคำขอ, ตรวจสิทธิ์, แปลง payload, เรียก engine ผ่าน dispatcher", "command-registry.json, permissions.json"],
          ["Business Engines", "engines/", "คำนวณราคา ภาษี ต้นทุน ระยะทาง เอกสาร และตรวจ business rule", "command-registry.json, business-coverage.json"],
          ["Cognitive", "cognitive/", "Intent → Plan → Execute → Reflect สำหรับงานที่ต้องใช้เหตุผล", "intent-dictionary.json, decisions.json"],
          ["Core", "core/", "Config loader, execution engine, workspace composer, authority context", "CONSTITUTION.json, constraints.json"],
          ["Services", "services/", "ขอบเขต I/O: Supabase, Realtime, AI bridge, token store", "services.json, infrastructure.json"],
          ["Plugins & Drivers", "plugins/", "ไดรเวอร์ LINE, Chrome, GitHub, macOS และ platform runtime", "drivers.json, PROVIDER_DIRECTORY.json"],
          ["Registry", "registry/", "แหล่งความจริงเดียวของ command, module, capability, schema และสิทธิ์", "architecture-book.json, dependency-graph.json"],
        ],
      },
    },
    {
      id: "direction",
      heading: "ทิศทางการพึ่งพา (Dependency Direction)",
      lead: "กราฟการพึ่งพาถูกบังคับด้วย registry/dependency-graph.json และตรวจใน pre-commit ทุกครั้ง",
      bullets: [
        "UI เรียกได้เฉพาะ route handler ของตัวเอง ไม่ import engine โดยตรง",
        "Route handler เรียก engine ผ่าน engines/validation/dispatcher.ts เท่านั้น เพื่อให้ registry gate และ Rule 72 ทำงานทุกเส้นทาง",
        "Engine อ่านค่าตั้งต้นจาก core/config-loader (ตาราง app_configs) ไม่มีค่าคงที่ซ่อนอยู่ในโค้ด",
        "Presenter สรุปผลที่คำนวณเสร็จแล้วเท่านั้น และไม่ import engines",
        "Services เป็นชั้นเดียวที่แตะ Supabase โดยตรง",
        "Registry เป็นอ่านอย่างเดียว (read-only) สำหรับ runtime ทุกชั้น",
      ],
      code: {
        language: "text",
        content: `app/ (UI)
  └─ app/api/ (route handler)
       └─ engines/validation/dispatcher.ts  ── registry/command-registry.json
            └─ engines/*                    ── core/config-loader ── app_configs
                 └─ services/supabase/*      ── PostgreSQL + RLS
                      └─ presenter/* (สรุปผล)
registry/*  ← อ่านโดยทุกชั้น ห้ามเขียนจาก runtime`,
      },
    },
    {
      id: "contracts",
      heading: "สัญญาข้อมูลกลาง (Core Contracts)",
      lead: "โครงสร้างข้อมูลที่ทุกเลเยอร์ใช้ร่วมกัน ประกาศไว้ที่ registry/schemas.json",
      table: {
        columns: ["Contract", "ฟิลด์บังคับ", "ฟิลด์เสริม", "ใช้ที่ไหน"],
        rows: [
          ["Command", "version, command", "args", "POST /api/v1/query, dispatcher"],
          ["Event", "id, type, source, timestamp", "data, traceId", "event bus, business_events"],
          ["DriverResponse", "success, command, timestamp", "data, error", "plugins/drivers/*"],
          ["AgentCall", "driver, command", "args", "cognitive/executor"],
          ["DocumentData", "type, items", "company, customer, events, payment, debt", "engines/documents/*"],
        ],
      },
      code: {
        language: "json",
        content: `{
  "version": 1,
  "command": "debt.list",
  "args": {}
}`,
      },
    },
  ],
};

const runtimeFlow: DocSpec = {
  slug: "runtime-flow",
  category: "system",
  title: "ลำดับการทำงานของคำขอ",
  titleEn: "Request Lifecycle",
  summary:
    "ทุกคำขอเดินผ่าน 7 ขั้นตอนเดียวกัน ตั้งแต่ auth guard จนถึง presenter ทำให้ตรวจสอบย้อนกลับได้ด้วย request_id เดียว",
  sections: [
    {
      id: "steps",
      heading: "เจ็ดขั้นตอนมาตรฐาน",
      bullets: [
        "1. Auth guard — requireAuth / requireAuthPage ตรวจ session และระดับสิทธิ์ (ADMIN_TIER)",
        "2. Parse & validate — route handler ตรวจ JSON, header และ query parameter",
        "3. Registry gate — dispatcher ตรวจว่าคำสั่งมีจริงใน registry/command-registry.json",
        "4. Policy gate — Rule 72 บังคับให้ write command ต้องยืนยันจากมนุษย์ผ่าน /admin UI",
        "5. Data scope — resolveTokenDataScope จำกัดขอบเขตข้อมูลตามบัญชีผู้ถือ token",
        "6. Execute — engine คำนวณโดยอ่านค่าตั้งต้นจาก app_configs ผ่าน core/config-loader",
        "7. Respond — presenter จัดรูปแบบผลลัพธ์พร้อม request_id และ capability context",
      ],
    },
    {
      id: "trace",
      heading: "ตัวอย่างการเดินทางของคำขอ",
      code: {
        language: "text",
        content: `POST /api/v1/query
  header  X-DNA-Token: <token>
  body    { "command": "debt.list", "args": {} }
    ↓
services/supabase/api-tokens.ts   validateApiToken()        → token record
core/auth/session.ts              profiles.role ∈ admin_tier → ผ่าน
engines/authority/session-scope   resolveTokenDataScope()   → company scope
engines/validation/dispatcher.ts  registry gate + Rule 72   → allow (read)
cognitive/debts                   query invoice_debts       → rows
app/api/v1/query/route.ts         JSON + request_id         → 200`,
      },
    },
    {
      id: "statuses",
      heading: "รหัสสถานะที่ระบบใช้",
      table: {
        columns: ["Status", "ความหมาย", "สิ่งที่ client ควรทำ"],
        rows: [
          ["200", "คำสั่งสำเร็จและคืนข้อมูล", "อ่านฟิลด์ data"],
          ["400", "body ไม่ใช่ JSON หรือไม่ได้ระบุ command", "แก้ payload ตาม schema"],
          ["401", "ไม่มี token หรือ token ไม่ถูกต้อง/ถูก revoke", "สร้าง token ใหม่ที่ /admin/api-tokens"],
          ["403", "token ไม่มีสิทธิ์ หรือคำสั่งต้องยืนยันจากมนุษย์", "ใช้ /admin UI สำหรับ write command"],
          ["503", "เซิร์ฟเวอร์ยังไม่พร้อมใช้งาน token store", "ตรวจการตั้งค่า SUPABASE_SERVICE_ROLE_KEY"],
        ],
      },
    },
    {
      id: "invariants",
      heading: "หลักประกันที่ไม่เปลี่ยน",
      bullets: [
        "ทุกคำสั่งภายนอกต้องผ่าน registry gate — คำสั่งที่ไม่มีใน registry จะไม่ถูก execute",
        "write command ไม่ถูกเปิดให้ external AI เรียกตรง (Rule 72)",
        "สิทธิ์ถูกประเมินใหม่ทุกคำขอจาก profiles.role ไม่เชื่อสถานะฝั่ง client",
        "ทุก response ประกอบด้วย request_id เพื่อใช้ trace ข้ามชั้น",
        "การอ่านค่าตั้งต้นที่หายไปจะหยุดด้วย [CONFIG MISSING] ไม่คืนค่าเดา",
      ],
    },
  ],
};

const registryMap: DocSpec = {
  slug: "registry-map",
  category: "system",
  title: "แผนที่ Registry กลาง",
  titleEn: "Central Registry Map",
  summary:
    "Registry แต่ละไฟล์มีเจ้าของชัดเจนและมี endpoint หรือ runtime เดียวที่อ่านมัน AI agent ใช้ตารางนี้เพื่อเลือกแหล่งข้อมูลก่อนเขียนโค้ดเชื่อมต่อ",
  sections: [
    {
      id: "map",
      heading: "ไฟล์ registry และผู้ใช้งานจริง",
      table: {
        columns: ["Registry", "ความจริงที่เก็บ", "อ่านโดย", "เข้าถึงผ่าน"],
        rows: [
          ["command-registry.json", "คำสั่งทั้งหมด: owner, layer, input, output, requires_confirmation", "dispatcher, /api/v1/spec", "GET /api/v1/spec, GET /api/v1/mcp/registry/commands"],
          ["module-registry.json", "ทุกโมดูล: layer, purpose, exports, access, status", "architecture book, IDE, /api/v1/modules", "GET /api/v1/modules"],
          ["capability-registry.json", "CapabilityId และ OwnerModule ที่ผูกกับ command", "composer, /api/v1/capabilities", "GET /api/v1/capabilities"],
          ["schemas.json", "สัญญาข้อมูล Command / Event / DriverResponse / AgentCall", "ทุกเลเยอร์", "import ตรงจาก registry"],
          ["permissions.json", "role_tiers (admin_tier ฯลฯ) และสิทธิ์รายบทบาท", "core/auth/session.ts", "requireAuth(ADMIN_TIER)"],
          ["drivers.json", "ไดรเวอร์ฮาร์ดแวร์และแพลตฟอร์ม", "plugins, /api/v1/drivers", "GET /api/v1/drivers"],
          ["commands/workflows.json", "Workflow Registry ที่ executor อ่านจริง", "core/executor/engine.ts", "GET /api/v1/workflows"],
          ["CONSTITUTION.json", "Iron Rules และหลักการออกแบบ", "/api/v1/constitution, governance", "GET /api/v1/constitution"],
          ["mcp-planned-manifest.json", "สัญญา HTTP ของเครื่องมือ MCP และสถานะ integration", "dna-os-mcp-server", "GET /api/v1/mcp/manifest"],
          ["PROVIDER_DIRECTORY.json", "Provider ที่รองรับและสถานะการเชื่อมต่อ", "connectors, admin console", "/admin/connectors"],
          ["connector-lifecycle.json", "กฎวงจรชีวิตของ connector และ failure flow", "connector center", "/admin/connectors"],
          ["architecture.json", "รายชื่อเลเยอร์และโมดูลของแต่ละเลเยอร์", "architecture book, portal", "registry/architecture-book.json"],
        ],
      },
    },
    {
      id: "consumption",
      heading: "รูปแบบการอ่าน registry สำหรับ agent",
      lead: "โหลดผ่าน HTTP เพื่อไม่ผูกกับโครงสร้างไฟล์ภายใน หรือ import ตรงเมื่อเขียนโค้ดใน repository นี้",
      code: {
        language: "ts",
        content: `// ภายใน repository
import commandRegistry from "@/registry/command-registry.json";

const readCommands = Object.entries(commandRegistry.commands)
  .filter(([, c]) => !c.requires_confirmation)
  .map(([name, c]) => ({ name, owner: c.owner, output: c.output }));

// ภายนอกรายการคำสั่งทั้งหมด (tool schema พร้อมใช้กับ LLM)
const spec = await fetch("/api/v1/spec").then((r) => r.json());`,
      },
    },
    {
      id: "rules",
      heading: "กฎการใช้งาน Registry",
      bullets: [
        "หนึ่งความจริง หนึ่งไฟล์ — ห้ามคัดลอกข้อมูล registry ไปเก็บซ้ำในโค้ดหรือเอกสาร",
        "เพิ่ม endpoint ใหม่ต้องเพิ่มใน spec นี้ไฟล์เดียว เพื่อให้ทั้งหน้าเว็บและ JSON index ตรงกัน",
        "ค่า config เชิงธุรกิจอยู่ในตาราง app_configs ไม่ใช่ค่าคงที่ในซอร์สโค้ด",
        "ทุกโมดูลใหม่ต้องลงทะเบียนใน module-registry.json ก่อน commit (pre-commit ตรวจอัตโนมัติ)",
        "Registry integrity gate ตรวจความสอดคล้อง Source ↔ Registry ↔ Git ในทุกคอมมิต",
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Category: engines
// ─────────────────────────────────────────────────────────────────────────────

const pricingEngine: DocSpec = {
  slug: "pricing-engine",
  category: "engines",
  title: "เครื่องยนต์คำนวณราคา",
  titleEn: "Pricing Engine",
  summary:
    "engines/pricing.ts คำนวณต้นทุนสึกหรอ กำไร ค่าธรรมเนียมระบบ ค่าด่วน และ VAT โดยอ่านอัตราทั้งหมดจาก app_configs",
  sections: [
    {
      id: "formula",
      heading: "สูตรการคำนวณ",
      lead: "ต้นทุนสึกหรอคิดจากค่าน้ำมันจริงเท่านั้น (ไม่รวมค่าแรงคนขับ เพราะคนขับเป็นผู้รับเหมาอิสระ) จากนั้นจึงบวกกำไร ค่าด่วน และ VAT",
      code: {
        language: "ts",
        content: `wearCost      = fuel_cost × (wear_percent / 100)
totalWithWear = total_cost + wearCost
markup        = totalWithWear × (markup_percent / 100)
systemFee     = totalWithWear × (system_fee_percent / 100)
urgentFee     = is_urgent ? totalWithWear × (urgent_fee_percent / 100) : 0
profit        = markup − systemFee
sellingExVAT  = totalWithWear + markup + urgentFee
vat           = sellingExVAT × vat_rate      // vat_rate เก็บเป็นเศษส่วน เช่น 0.07
sellingPrice  = sellingExVAT + vat
pricePerTrip  = trips > 0 ? sellingPrice / trips : sellingPrice`,
      },
    },
    {
      id: "config",
      heading: "คีย์ตั้งต้นใน app_configs",
      lead: "ทุกอัตราต้องมีอยู่ในฐานข้อมูลจริง หากคีย์ใดหายไป core/config-loader จะหยุดด้วย [CONFIG MISSING] แทนการคืนค่าเดา",
      table: {
        columns: ["คีย์", "ชนิด", "ความหมาย", "ตัวอย่าง"],
        rows: [
          ["pricing-markup-percent", "number (%)", "กำไรที่บวกเพิ่มจากต้นทุนรวมหลังสึกหรอ", "15"],
          ["system-fee-percent", "number (%)", "ค่าธรรมเนียมระบบ หักจากกำไร", "3"],
          ["urgent-fee-percent", "number (%)", "ค่าบริการงานด่วน ใช้เมื่อ is_urgent = true", "10"],
          ["wear-percent", "number (%)", "อัตราสึกหรอ คิดจากค่าน้ำมัน", "5"],
          ["vat-rate", "number (fraction)", "อัตรา VAT เก็บเป็นเศษส่วน", "0.07"],
        ],
      },
    },
    {
      id: "contract",
      heading: "สัญญาอินพุตและเอาต์พุต",
      code: {
        language: "json",
        content: `// PricingInput
{
  "total_cost": 18500,
  "material_cost": 12000,
  "fuel_cost": 6500,
  "trips": 3,
  "is_urgent": true
}

// PricingResult
{
  "wear_cost": 325,
  "selling_price_ex_vat": 22022.5,
  "vat": 1541.58,
  "selling_price": 23564.08,
  "profit": 2536.13,
  "system_fee": 564.75,
  "urgent_fee": 1882.5,
  "price_per_trip": 7854.69,
  "audit": { "engine": "pricing", "input": {}, "rules": {}, "computed": {} }
}`,
      },
    },
    {
      id: "verify",
      heading: "ขั้นตอนตรวจสอบ",
      bullets: [
        "ตรวจว่าคีย์ครบ: select key, value from app_configs where key in ('pricing-markup-percent','system-fee-percent','urgent-fee-percent','wear-percent','vat-rate');",
        "เรียก calcPricing ด้วยอินพุตตัวอย่าง แล้วเทียบผลกับสูตรด้านบนทีละบรรทัด",
        "ยืนยันว่า audit.rules.formula ในผลลัพธ์สะท้อนอัตราที่อ่านมาจริง",
        "รัน npx tsc --noEmit เพื่อยืนยันสัญญา PricingInput / PricingResult",
      ],
    },
  ],
};

const dispatchContract: DocSpec = {
  slug: "dispatch-contract",
  category: "engines",
  title: "สัญญาของ Dispatcher",
  titleEn: "Dispatcher Contract",
  summary:
    "engines/validation/dispatcher.ts เป็นประตูเดียวที่แปลง command เป็นการเรียก engine โดยตรวจ registry และกฎความปลอดภัยก่อนทุกครั้ง",
  sections: [
    {
      id: "entry",
      heading: "รายการ command ใน registry",
      lead: "ทุกคำสั่งประกาศ owner, layer, input, output และ requires_confirmation — ตัวอย่างจริงของ debt.list",
      code: {
        language: "json",
        content: `{
  "debt.list": {
    "owner": "cognitive/debts",
    "layer": "cognitive",
    "input": {},
    "output": "InvoiceDebt[]",
    "description": "แสดงรายการหนี้ค้างชำระ (OPEN)",
    "description_th": "แสดงรายการหนี้ที่ยังค้างชำระ (สถานะ OPEN)",
    "requires_confirmation": false
  }
}`,
      },
      table: {
        columns: ["ฟิลด์", "ชนิด", "ความหมาย"],
        rows: [
          ["owner", "string", "โมดูลเจ้าของคำสั่ง ใช้ resolve capability context"],
          ["layer", "string", "เลเยอร์ที่คำสั่งสังกัด"],
          ["input", "object", "แผนที่ชื่อพารามิเตอร์ → ชนิด; เติม ? ท้ายชื่อเมื่อไม่บังคับ"],
          ["output", "string", "ชนิดผลลัพธ์ที่ผู้เรียกได้รับ"],
          ["requires_confirmation", "boolean", "true = write command ปิดสำหรับ external AI (Rule 72)"],
        ],
      },
    },
    {
      id: "modes",
      heading: "โหมดการเรียกและผลลัพธ์",
      table: {
        columns: ["โหมด", "เส้นทาง", "ผลลัพธ์"],
        rows: [
          ["Read ผ่าน HTTP", "POST /api/v1/query (token)", "dispatch(command, args, false) → data"],
          ["Read ผ่าน UI", "/admin UI (session)", "dispatch(command, args, false) → presenter"],
          ["Write ผ่าน UI", "/admin UI + การยืนยันของมนุษย์", "dispatch(command, args, true) เมื่อได้รับอนุมัติ"],
          ["Read ผ่าน MCP", "POST /api/v1/mcp/business/dispatch", "คำสั่ง read ที่อยู่ใน whitelist เท่านั้น"],
        ],
      },
      code: {
        language: "json",
        content: `// สำเร็จ
{ "ok": true, "command": "debt.list", "user": "owner@example.com", "data": [], "capability": { "owner_module": "cognitive/debts", "capability_ids": [] } }

// ถูกปฏิเสธเพราะต้องยืนยัน
{ "ok": false, "command": "debt.create", "error": "requires human confirmation", "requires_confirmation": true }`,
      },
    },
    {
      id: "verify",
      heading: "ขั้นตอนตรวจสอบ",
      bullets: [
        "ยืนยันว่าคำสั่งที่ไม่มีใน registry ถูกปฏิเสธก่อนถึง engine",
        "ยืนยันว่า write command คืน requires_confirmation = true และ HTTP 403",
        "ตรวจว่า response มี capability.owner_module ตรงกับ owner ใน registry",
        "ทดสอบผ่าน /playground ด้วย token จริงเพื่อดูผลแบบครบวงจร",
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Category: api
// ─────────────────────────────────────────────────────────────────────────────

const queryEndpoint: DocSpec = {
  slug: "query-endpoint",
  category: "api",
  title: "เรียกคำสั่งธุรกิจ",
  titleEn: "Runtime Query",
  summary:
    "POST /api/v1/query คือท่อหลักสำหรับ AI ภายนอกและ connector รับ command พร้อม args แล้วคืนข้อมูลที่ผ่านการตรวจสิทธิ์และขอบเขตข้อมูลแล้ว",
  sections: [
    {
      id: "endpoint",
      heading: "สเปก endpoint",
      endpoints: [
        {
          id: "query",
          method: "POST",
          path: "/api/v1/query",
          auth: "X-DNA-Token header หรือ ?token= (token ออกที่ /admin/api-tokens)",
          summary:
            "Execute read command ผ่าน dispatcher พร้อมตรวจ role ระดับ admin tier และจำกัดขอบเขตข้อมูลตามบัญชีผู้ถือ token",
          params: [
            p("X-DNA-Token", "header", "string", false, "API token ของบัญชีที่อยู่ใน admin tier (ใช้แทน query param ได้)", "dna_xxxxxxxx"),
            p("token", "query", "string", false, "ทางเลือกสำหรับ client ที่ไม่สามารถตั้ง header ได้", "dna_xxxxxxxx"),
            p("command", "body", "string", true, "ชื่อคำสั่งใน registry รองรับรูปแบบ OpenAI double-underscore เช่น debt__list", "debt.list"),
            p("args", "body", "object", false, "พารามิเตอร์ของคำสั่ง ตาม input ใน registry", "{}"),
          ],
          requestSample: `curl -X POST https://<host>/api/v1/query \\
  -H "Content-Type: application/json" \\
  -H "X-DNA-Token: $DNA_OS_API_TOKEN" \\
  -d '{"command":"debt.list","args":{}}'`,
          responseSample: `{
  "ok": true,
  "command": "debt.list",
  "user": "owner@example.com",
  "data": [],
  "capability": { "owner_module": "cognitive/debts", "capability_ids": [] }
}`,
          verification: [
            "เรียกโดยไม่ใส่ token → 401 และ error ระบุให้สร้าง token ที่ /admin/api-tokens",
            "เรียกด้วย token ที่ถูก revoke → 401",
            "เรียก write command เช่น debt.create → 403 พร้อม requires_confirmation = true",
            "เรียก read command → 200 พร้อมฟิลด์ data และ capability",
            "เรียกด้วย command ที่ไม่มีใน registry → 400 พร้อม violations",
            "ส่ง body ที่ไม่ใช่ JSON → 400",
          ],
          registryRefs: ["registry/command-registry.json", "registry/permissions.json", "registry/capability-registry.json"],
        },
      ],
    },
    {
      id: "cors",
      heading: "CORS และการเรียกจากเบราว์เซอร์",
      bullets: [
        "OPTIONS /api/v1/query คืน 204 พร้อม Allow-Origin: * และอนุญาต header Content-Type, X-DNA-Token",
        "ฝั่ง client ต้องแนบ token ใน header ทุกคำขอ ไม่มี cookie-based flow สำหรับ endpoint นี้",
        "แนะนำให้เรียกจาก server-side หรือ proxy ของคุณเองเพื่อไม่ให้ token ปรากฏในเบราว์เซอร์",
      ],
    },
  ],
};

const discoveryEndpoints: DocSpec = {
  slug: "discovery-endpoints",
  category: "api",
  title: "Endpoint ค้นหาโครงสร้างระบบ",
  titleEn: "Discovery Endpoints",
  summary:
    "ชุด endpoint แบบอ่านอย่างเดียวที่เปิดให้ทุก client ใช้ค้นหา command, module, capability, driver, workflow และกฎรัฐธรรมนูญของระบบ",
  sections: [
    {
      id: "overview",
      heading: "ภาพรวม",
      paragraphs: [
        "ทุก endpoint ในหมวดนี้เป็น GET, ไม่ต้องใช้ token และมี Cache-Control 300 วินาที (constitution 3600 วินาที) เพื่อให้ agent โหลดโครงสร้างระบบซ้ำได้โดยไม่สร้างภาระกับฐานข้อมูล",
        "ใช้ /api/v1/spec เป็นจุดเริ่มต้นเมื่อต้องต่อ LLM tool-use เพราะคืน tool schema ที่กรอง deprecated และ write command ออกแล้ว",
      ],
      table: {
        columns: ["Endpoint", "คืนอะไร", "ใช้เมื่อ"],
        rows: [
          ["GET /api/v1/spec", "tool schema รูปแบบ OpenAI/Claude + _dna_command", "สร้าง tool ให้ LLM เรียก DNA OS"],
          ["GET /api/v1/modules", "โมดูลทั้งหมดพร้อม layer, purpose, exports, access", "หาเจ้าของฟีเจอร์หรือโมดูลที่ต้องเรียก"],
          ["GET /api/v1/capabilities", "existence.json + capability registry + composition plan", "วางแผนประกอบ capability หลายตัว"],
          ["GET /api/v1/drivers", "ไดรเวอร์ฮาร์ดแวร์และแพลตฟอร์ม", "ตรวจว่ามีไดรเวอร์สำหรับอุปกรณ์ที่ต้องการ"],
          ["GET /api/v1/workflows", "workflow registry ที่ executor อ่านจริง", "สร้าง automation ตาม workflow ที่มีอยู่"],
          ["GET /api/v1/constitution", "Iron Rules และหลักการออกแบบ", "ตรวจข้อกำหนดก่อนออกแบบ connector"],
          ["GET /api/v1/developer-portal", "สเปกพอร์ทัลนี้ทั้งหมดในรูป JSON", "ให้ agent อ่านสเปกแล้วเขียนโค้ดเชื่อมต่อ"],
        ],
      },
    },
    {
      id: "spec",
      heading: "Tool specification",
      endpoints: [
        {
          id: "spec",
          method: "GET",
          path: "/api/v1/spec",
          auth: "ไม่ต้องใช้ token (public)",
          summary:
            "คืนรายการ tool ทั้งหมดที่ external AI เรียกได้ พร้อม JSON Schema ของพารามิเตอร์และชื่อคำสั่งดั้งเดิมในฟิลด์ _dna_command",
          params: [],
          responseSample: `{
  "schema_version": "1.0",
  "system": "DNA OS",
  "query_endpoint": "/api/v1/query",
  "auth": "Header: X-DNA-Token: <your-token>",
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "debt__list",
        "description": "แสดงรายการหนี้ค้างชำระ (OPEN) | layer: cognitive | output: InvoiceDebt[]",
        "parameters": { "type": "object", "properties": {}, "required": [] },
        "_dna_command": "debt.list"
      }
    }
  ]
}`,
          verification: [
            "curl -s /api/v1/spec | jq '.tools | length' → ต้องมากกว่า 0",
            "ยืนยันว่าไม่มี tool ใดมี _dna_command ที่เป็น write command",
            "นำ tool แรกไปเรียก POST /api/v1/query ด้วยชื่อใน _dna_command แล้วต้องได้ 200",
          ],
          registryRefs: ["registry/command-registry.json"],
        },
        {
          id: "capabilities",
          method: "GET",
          path: "/api/v1/capabilities",
          auth: "ไม่ต้องใช้ token (public)",
          summary:
            "คืน existence.json และข้อมูล capability registry พร้อม composition plan เมื่อระบุ capability ที่ต้องการ",
          params: [
            p("resolve", "query", "string (comma-separated)", false, "รายการ CapabilityId ที่ต้องการให้ composer ประกอบเป็นแผน", "cap.x,cap.y"),
            p("application_id", "query", "string", false, "ขอบเขตแอปพลิเคชันของ composition plan", "api.v1.capabilities"),
            p("workspace_id", "query", "string", false, "ขอบเขต workspace ของ composition plan", "default"),
          ],
          responseSample: `{
  "schema_version": "1.0",
  "capability_registry": {
    "source": "registry/capability-registry.json",
    "version": 1,
    "checksum": "..."
  },
  "composition_plan": null
}`,
          verification: [
            "เรียกโดยไม่ใส่ resolve → composition_plan เป็น null และได้ registry summary",
            "เรียกด้วย resolve=<id> → ได้ CompositionPlan ที่อ้างอิง capability จริง",
            "ยืนยันว่า checksum เปลี่ยนเมื่อ registry เปลี่ยน",
          ],
          registryRefs: ["registry/existence.json", "registry/capability-registry.json"],
        },
        {
          id: "modules",
          method: "GET",
          path: "/api/v1/modules",
          auth: "ไม่ต้องใช้ token (public)",
          summary: "คืนรายการโมดูลทั้งหมดพร้อม layer, owner, exports และสถานะ",
          params: [],
          responseSample: `{
  "schema_version": "1.0",
  "source": "registry/module-registry.json",
  "total": 1079,
  "modules": [
    { "path": "engines/pricing.ts", "owner": "engines", "layer": "engines", "purpose_th": "คำนวณราคา", "exports": ["calcPricing"], "status": "active" }
  ]
}`,
          verification: [
            "curl -s /api/v1/modules | jq '.total' → ตรงกับจำนวน entry ใน module-registry.json",
            "ตรวจว่า path ที่ต้องการค้นหาปรากฏในผลลัพธ์",
          ],
          registryRefs: ["registry/module-registry.json"],
        },
      ],
    },
  ],
};

const tokenEndpoints: DocSpec = {
  slug: "api-tokens",
  category: "api",
  title: "การออกและจัดการ API Token",
  titleEn: "API Token Management",
  summary:
    "Token ถูกออกโดยผู้ดูแลระบบเท่านั้น ผ่าน endpoint ที่ต้องมี session ระดับ admin tier และผูกกับบัญชีผู้ใช้จริงในระบบ",
  sections: [
    {
      id: "endpoints",
      heading: "สเปก endpoint",
      endpoints: [
        {
          id: "list-tokens",
          method: "GET",
          path: "/api/admin/api-tokens",
          auth: "Session ระดับ ADMIN_TIER",
          summary: "คืนรายการ token ของบัญชีที่ล็อกอินอยู่",
          params: [],
          responseSample: `{
  "tokens": [
    { "id": "...", "label": "contractor-runtime", "scopes": ["read"], "created_at": "2026-11-11T00:00:00Z", "revoked_at": null }
  ]
}`,
          verification: [
            "เรียกด้วย session ผู้ใช้ทั่วไป → ถูกปฏิเสธด้วย auth guard",
            "เรียกด้วย session ผู้ดูแล → 200 และเห็นเฉพาะ token ของตน",
          ],
          registryRefs: ["registry/permissions.json", "services/supabase/api-tokens.ts"],
        },
        {
          id: "create-token",
          method: "POST",
          path: "/api/admin/api-tokens",
          auth: "Session ระดับ ADMIN_TIER",
          summary: "ออก token ใหม่โดยเลือก scope จาก allow-list ของระบบ",
          params: [
            p("label", "body", "string", false, "ชื่อเรียกของ token เพื่อให้ผู้ดูแลแยกแยะ", "contractor-runtime"),
            p("scopes", "body", "string[]", false, "ขอบเขตสิทธิ์: read, governance:read, governance:propose", '["read"]'),
          ],
          requestSample: `curl -X POST https://<host>/api/admin/api-tokens \\
  -H "Content-Type: application/json" \\
  --cookie "session=<admin-session>" \\
  -d '{"label":"contractor-runtime","scopes":["read"]}'`,
          responseSample: `{
  "token": {
    "id": "...",
    "label": "contractor-runtime",
    "scopes": ["read"],
    "token": "dna_xxxxxxxxxxxxxxxx"
  }
}`,
          verification: [
            "ส่ง scope ที่ไม่อยู่ใน allow-list → 400 พร้อมรายการ allowed",
            "ส่ง label ว่าง → ใช้ค่า default",
            "นำ token ที่ได้ไปเรียก POST /api/v1/query → 200",
          ],
          registryRefs: ["registry/permissions.json", "services/supabase/api-tokens.ts"],
        },
      ],
    },
    {
      id: "scope-rules",
      heading: "กฎของ scope",
      table: {
        columns: ["Scope", "อนุญาต", "หมายเหตุ"],
        rows: [
          ["read", "เรียก read command ผ่าน /api/v1/query", "ขอบเขตข้อมูลยังถูกจำกัดตามบัญชีผู้ถือ token"],
          ["governance:read", "อ่านสถานะ governance และ proposal", "ไม่สามารถอนุมัติ"],
          ["governance:propose", "ส่งข้อเสนอเข้าคิวให้มนุษย์อนุมัติ", "การอนุมัติต้องทำผ่าน /admin UI"],
        ],
      },
      bullets: [
        "client ไม่สามารถกำหนด scope เองได้ — มีเพียง route นี้ที่อ่านค่าดังกล่าวและต้องผ่าน session ผู้ดูแล",
        "token ที่ถูก revoke จะถูกปฏิเสธทันทีในคำขอถัดไป",
        "role ของบัญชีถูกตรวจใหม่ทุกคำขอ หากถูกถอดออกจาก admin tier token จะใช้ไม่ได้ทันที",
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Category: integrations
// ─────────────────────────────────────────────────────────────────────────────

const lineWebhook: DocSpec = {
  slug: "line-webhook",
  category: "integrations",
  title: "LINE Webhook และ Mini App",
  titleEn: "LINE Messaging Integration",
  summary:
    "supabase/functions/line-webhook-v2 รับ event จาก LINE ตรวจลายเซ็น x-line-signature แล้วกระจายงานตามชนิด event ก่อนตอบ ACK ภายในเวลาที่ LINE กำหนด",
  sections: [
    {
      id: "endpoint",
      heading: "สเปก webhook",
      endpoints: [
        {
          id: "line-webhook",
          method: "POST",
          path: "$SUPABASE_URL/functions/v1/line-webhook-v2",
          auth: "ลายเซ็น x-line-signature (HMAC-SHA256 ของ channel secret) — ฟังก์ชันตั้ง verify_jwt = false",
          summary:
            "รับ LINE webhook event ทุกชนิด (message, follow, unfollow, postback, location, image, file, audio, group) และส่งต่อไปยัง handler ที่รับผิดชอบ",
          params: [
            p("x-line-signature", "header", "string (base64)", true, "HMAC-SHA256 ของ raw body ด้วย channel secret"),
            p("destination", "body", "string", true, "LINE user/group id ของบัญชีที่รับ event ใช้เลือก credential ของร้านนั้น"),
            p("events", "body", "array", true, "รายการ event ตามสเปก LINE Messaging API"),
            p("events[].type", "body", "string", true, "message | follow | unfollow | postback | join | leave", "message"),
            p("events[].message.type", "body", "string", false, "text | image | file | audio | location", "text"),
            p("events[].replyToken", "body", "string", false, "token สำหรับตอบกลับภายในเวลาที่กำหนด"),
          ],
          requestSample: `curl -X POST "$SUPABASE_URL/functions/v1/line-webhook-v2" \\
  -H "Content-Type: application/json" \\
  -H "x-line-signature: <base64-hmac>" \\
  -d '{
    "destination": "Uxxxxxxxxxxxxxxxx",
    "events": [{
      "type": "message",
      "replyToken": "xxxxxxxx",
      "source": { "userId": "Uxxxxxxxxxxxxxxxx", "type": "user" },
      "message": { "type": "text", "id": "1", "text": "ยอดค้างชำระ" }
    }]
  }'`,
          responseSample: `{ "ok": true }`,
          verification: [
            "ยืนยันว่า verify_jwt = false ใน supabase/config.toml สำหรับฟังก์ชันนี้ เพื่อให้ LINE เรียกได้โดยไม่มี Supabase JWT",
            "ตั้งค่า LINE_CHANNEL_SECRET และ LINE_CHANNEL_ACCESS_TOKEN ใน secrets ของโปรเจกต์",
            "ส่งคำขอที่ลายเซ็นไม่ถูกต้อง → 401 และไม่มีการประมวลผล event",
            "ส่งคำขอที่ลายเซ็นถูกต้อง → 200 {\"ok\":true} และ event ถูกบันทึกในตาราง line_events",
            "ทดสอบ event text ที่เป็นคำสั่งคนขับ เช่น eta 82-1234 → ต้องได้รับการตอบกลับผ่าน reply API",
          ],
          registryRefs: ["registry/communication/line.registry.json", "supabase/functions/line-webhook-v2", "registry/PROVIDER_DIRECTORY.json"],
        },
      ],
    },
    {
      id: "pipeline",
      heading: "ลำดับการประมวลผล event",
      bullets: [
        "ตรวจลายเซ็นจาก raw body ก่อน parse เพื่อป้องกัน payload ปลอม",
        "เลือก channel secret และ access token ตาม destination ผ่าน connect_external_account_credentials",
        "แปลง event เป็น handler เฉพาะทาง: follow, unfollow, text, location, driver, postback, image, file, audio, group",
        "ประมวลผล event พร้อมกันและส่งงานเบื้องหลังผ่าน EdgeRuntime.waitUntil() เพื่อตอบ 200 ทันที",
        "บันทึก event ลง line_events เพื่อให้ admin console และ analytics ตรวจย้อนหลังได้",
      ],
    },
    {
      id: "mini-app",
      heading: "การเชื่อมต่อ Mini App",
      bullets: [
        "Mini App ที่ฝังใน LINE ใช้ LIFF token เพื่อระบุผู้ใช้ แล้วเรียกข้อมูลผ่าน endpoint ของ DNA OS ด้วย token ที่ระบบออกให้",
        "ห้ามฝัง channel access token หรือ service role key ฝั่ง client เด็ดขาด — ให้ proxy ผ่าน route handler ของคุณ",
        "ผลลัพธ์ที่แสดงใน Mini App ต้องมาจาก read command เดียวกับที่ /api/v1/query ใช้ เพื่อให้ตัวเลขตรงกับระบบหลัก",
      ],
    },
  ],
};

const mcpIntegration: DocSpec = {
  slug: "mcp-server",
  category: "integrations",
  title: "MCP Server สำหรับ AI Agent",
  titleEn: "MCP Server",
  summary:
    "dna-os-mcp-server เป็น protocol adapter ที่แปลง MCP tool call เป็น HTTP request ไปยัง endpoint ของ DNA OS โดยไม่ถือ business logic ของตัวเอง",
  sections: [
    {
      id: "contract",
      heading: "สัญญาเครื่องมือ MCP",
      lead: "สัญญาทั้งหมดประกาศใน registry/mcp-planned-manifest.json ซึ่งเป็นไฟล์ที่ยึด HTTP contract ก่อนเครื่องมือถูกเลื่อนสถานะเป็น active",
      table: {
        columns: ["MCP tool", "HTTP endpoint", "ลักษณะงาน", "สถานะ"],
        rows: [
          ["contractor.task.claim", "POST /api/v1/mcp/contractor/task-claim", "รับงานจากคิวและสร้าง JobContract", "active"],
          ["contractor.evidence.submit", "POST /api/v1/mcp/contractor/evidence-submit", "ส่งหลักฐานและตรวจ reference", "active"],
          ["contractor.status", "GET /api/v1/mcp/contractor/status?ownerId=", "อ่านสถานะงาน (read-only)", "active"],
          ["business.dispatch", "POST /api/v1/mcp/business/dispatch", "execute read command ที่อยู่ใน whitelist", "active"],
          ["architecture.system_summary", "GET /api/v1/mcp/architecture/summary", "สรุปสถาปัตยกรรมและกฎรัฐธรรมนูญ", "active"],
          ["architecture.get_dependency_graph", "GET /api/v1/mcp/architecture/dependency-graph", "กราฟการพึ่งพา", "active"],
          ["registry.list_modules", "GET /api/v1/modules", "รายการโมดูล", "active"],
          ["registry.list_commands", "GET /api/v1/mcp/registry/commands", "รายการคำสั่งดิบจาก registry", "active"],
          ["runtime.query", "POST /api/v1/query", "passthrough ไปยัง dispatcher", "planned"],
          ["governance.status", "GET /api/v1/mcp/governance/status", "สถานะ governance", "active"],
          ["governance.registry_proposals", "GET /api/v1/mcp/governance/registry-proposals", "ข้อเสนอที่รออนุมัติ", "active"],
          ["governance.deploy_approval_status", "GET /api/v1/mcp/governance/deploy-approval-status", "สถานะการอนุมัติ deploy", "active"],
          ["governance.session_proposals", "GET /api/v1/mcp/governance/session-proposals", "ข้อเสนอของ session", "active"],
          ["governance.impact", "GET /api/v1/mcp/governance/impact/[evidenceEventId]", "ผลกระทบของหลักฐานหนึ่งรายการ", "active"],
        ],
      },
    },
    {
      id: "config",
      heading: "การตั้งค่าฝั่ง client",
      code: {
        language: "json",
        content: `{
  "mcpServers": {
    "dna-os": {
      "command": "node",
      "args": ["dna-os-mcp-server/dist/index.js"],
      "env": {
        "DNA_OS_BASE_URL": "https://<host>",
        "DNA_OS_API_TOKEN": "<token จาก /admin/api-tokens>"
      }
    }
  }
}`,
      },
      bullets: [
        "Server นี้ไม่มี allow-list ของโมดูลภายใน — เข้าถึงสถานะ DNA OS ผ่าน HTTP ตาม manifest เท่านั้น",
        "เครื่องมือที่ต้องใช้ token ต้องได้รับ DNA_OS_API_TOKEN จากผู้ดูแลระบบ",
        "การยืนยัน write command ยังคงเกิดขึ้นที่ dispatcher ฝั่ง DNA OS ไม่ใช่ที่ MCP client",
      ],
    },
  ],
};

const connectorsDoc: DocSpec = {
  slug: "connectors",
  category: "integrations",
  title: "Connector และ Provider Registry",
  titleEn: "Connectors & Providers",
  summary:
    "Connector ทุกตัวอ้างอิง Provider ที่ประกาศใน registry/PROVIDER_DIRECTORY.json และเดินตามวงจรชีวิตที่กำหนดใน registry/connector-lifecycle.json",
  sections: [
    {
      id: "lifecycle",
      heading: "วงจรชีวิตของ connector",
      bullets: [
        "ประกาศ provider และ capability ที่รองรับใน PROVIDER_DIRECTORY.json ก่อนสร้าง connector",
        "ลงทะเบียน connector พร้อม credential ที่เก็บในที่ปลอดภัย ไม่เขียนค่าลงซอร์สโค้ด",
        "ทดสอบการเชื่อมต่อผ่านปุ่ม Test ของ /admin/connectors ซึ่งเรียก tester จริง",
        "เปิดใช้งานเมื่อทดสอบผ่าน และบันทึกเหตุการณ์วงจรชีวิตลงตาราง connectors",
        "เมื่อล้มเหลว ระบบทำตาม failure_flow ใน connector-lifecycle.json: error, auto_disable, log, notify_status",
      ],
    },
    {
      id: "surfaces",
      heading: "จุดเชื่อมต่อที่ผู้ใช้เห็น",
      table: {
        columns: ["Surface", "หน้าที่", "แหล่งข้อมูล"],
        rows: [
          ["/admin/connectors", "ศูนย์ควบคุม connector: Test / Enable / Remove และประวัติเหตุการณ์", "ตาราง connectors + WORKER_ADAPTER_REGISTRY + Integration Gateway"],
          ["/admin/god-view", "มุมมองรวมสถานะระบบและ override ที่ต้องมีสิทธิ์", "registry + runtime state"],
          ["/admin/roles", "จัดการบทบาทและระดับสิทธิ์", "registry/permissions.json + profiles"],
          ["/admin/rules", "ดูและรันกฎ governance", "registry/GOVERNANCE_REGISTRY.json"],
          ["/admin/line-customers", "ผูกบัญชี LINE กับ partner และดูประวัติลูกค้า", "line_events + partners"],
        ],
      },
    },
    {
      id: "credentials",
      heading: "การจัดเก็บ credential",
      bullets: [
        "credential ของ provider เก็บในฐานข้อมูลหรือ secret store ของแพลตฟอร์ม ไม่เก็บใน registry ที่ commit ลง git",
        "เอกสารนี้แสดงเฉพาะชื่อตัวแปรและตำแหน่งที่ระบบอ่านค่า ไม่แสดงค่าใด ๆ",
        "ห้ามส่ง secret กลับใน response ของ API ทุกตัว",
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Category: settings
// ─────────────────────────────────────────────────────────────────────────────

const environmentKeys: DocSpec = {
  slug: "environment-keys",
  category: "settings",
  title: "ตัวแปรสภาพแวดล้อม",
  titleEn: "Environment Variables",
  summary:
    "รายการคีย์ที่ระบบอ่านจริง พร้อมขอบเขตการใช้งาน ค่าจริงเก็บใน .env.local ระหว่างพัฒนา และใน environment ของแพลตฟอร์มเมื่อขึ้น production",
  sections: [
    {
      id: "keys",
      heading: "คีย์ที่ระบบใช้งาน",
      table: {
        columns: ["ตัวแปร", "ขอบเขต", "ใช้ที่ไหน", "หมายเหตุ"],
        rows: [
          ["NEXT_PUBLIC_SUPABASE_URL", "public", "client และ server", "URL ของโปรเจกต์ Supabase production"],
          ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "public", "client", "คีย์สาธารณะสำหรับอ่านตาม RLS"],
          ["SUPABASE_SERVICE_ROLE_KEY", "server only", "token store, admin queries, deploy-gate", "ห้ามส่งไป client เด็ดขาด"],
          ["NEXT_PUBLIC_APP_URL", "public", "canonical URL, sitemap, structured data", "ถ้าไม่ตั้ง ระบบจะไม่สร้าง hostname เอง"],
          ["LINE_CHANNEL_SECRET", "server only", "line-webhook-v2", "ใช้ตรวจลายเซ็นของ event"],
          ["LINE_CHANNEL_ACCESS_TOKEN", "server only", "line-webhook-v2", "ใช้ตอบกลับผ่าน Messaging API"],
          ["EQUIPMENT_TELEMETRY_SECRET", "server only", "app/api/internal/equipment/telemetry", "bearer secret สำหรับ ingestion อุปกรณ์"],
        ],
      },
    },
    {
      id: "rules",
      heading: "ข้อปฏิบัติ",
      bullets: [
        "ค่าจริงอยู่ใน .env.local (ไม่ถูก commit) หรือ environment ของแพลตฟอร์มเท่านั้น",
        "ไฟล์เอกสารและ registry ระบุได้เฉพาะชื่อตัวแปร ไม่ระบุค่า",
        "เมื่อคีย์ service role หาย ระบบจะคืน 503 พร้อมข้อความบอกผู้ดูแล ไม่เดาค่าแทน",
        "ห้ามใช้ NEXT_PUBLIC_ นำหน้าคีย์ที่ให้สิทธิ์เขียนหรือข้าม RLS",
        "ตรวจความพร้อมทั้งชุดด้วย npm run verify-env ก่อน deploy",
      ],
    },
  ],
};

const accessControl: DocSpec = {
  slug: "access-control",
  category: "settings",
  title: "ระบบสิทธิ์และขอบเขตข้อมูล",
  titleEn: "Access Control & Data Scope",
  summary:
    "สิทธิ์ถูกตัดสินจาก profiles.role ทุกคำขอ โดยเทียบกับ role_tiers ใน registry/permissions.json และขอบเขตข้อมูลถูกจำกัดตามบัญชีผู้ถือ token",
  sections: [
    {
      id: "tiers",
      heading: "ระดับสิทธิ์",
      table: {
        columns: ["ระดับ", "แหล่งประกาศ", "ใช้กับ", "ผลเมื่อไม่ผ่าน"],
        rows: [
          ["ADMIN_TIER", "registry/permissions.json → role_tiers.admin_tier", "หน้า /admin, /api/admin/*, token ภายนอก", "401 หรือ 403"],
          ["Session ผู้ใช้ทั่วไป", "core/auth/session.ts", "พอร์ทัล user/partner", "redirect ไปหน้า login"],
          ["API token", "services/supabase/api-tokens.ts", "/api/v1/query", "401 เมื่อ revoke, 403 เมื่อ role หลุดจาก admin tier"],
          ["Worker contract", "app/api/admin/ide/_lib/workerContract.ts", "/api/v1/mcp/contractor/*", "ปฏิเสธงานที่ไม่อยู่ในสัญญา"],
        ],
      },
    },
    {
      id: "data-scope",
      heading: "ขอบเขตข้อมูล",
      bullets: [
        "resolveTokenDataScope แปลงโปรไฟล์ของผู้ถือ token เป็น DataScope ก่อน execute ทุกคำสั่ง",
        "runWithDataScope ครอบการเรียก dispatcher เพื่อให้ engine เห็นเฉพาะข้อมูลในขอบเขต",
        "RLS ในฐานข้อมูลเป็นชั้นป้องกันที่สอง ไม่ใช่ชั้นเดียว",
        "ตารางสำคัญเปิด RLS และกำหนด policy สำหรับ service role และ admin workspace แยกกัน",
      ],
    },
    {
      id: "secrets",
      heading: "การจัดการคีย์",
      bullets: [
        "คีย์ service role ใช้ได้เฉพาะฝั่ง server และไม่ถูก log",
        "ระบบ log เฉพาะขนาดและรูปแบบของ token ไม่บันทึกค่าหรือ prefix",
        "การหมุนคีย์ทำได้โดยอัปเดต environment แล้วรีสตาร์ท service โดยไม่ต้องแก้โค้ด",
        "Vault ของระบบรองรับการเขียน/อ่าน/ลบคีย์ผ่าน RPC ที่ต้องใช้ service client",
      ],
    },
  ],
};

const deployGate: DocSpec = {
  slug: "deploy-gate",
  category: "settings",
  title: "เกณฑ์การปล่อยระบบ (Deploy Gate)",
  titleEn: "Deploy Gate Criteria",
  summary:
    "ทุก release ต้องผ่าน deploy-gate ซึ่งตรวจสภาพแวดล้อม หลักฐาน Dev Loop สถานะสุขภาพ และความสอดคล้องของเลขเวอร์ชันก่อนอนุญาตให้ build",
  sections: [
    {
      id: "criteria",
      heading: "เกณฑ์ที่ต้องผ่าน",
      table: {
        columns: ["เกณฑ์", "สิ่งที่ตรวจ", "ผลเมื่อไม่ผ่าน"],
        rows: [
          ["Environment", "คีย์ที่จำเป็นครบและอ่านได้", "NOT READY พร้อมระบุคีย์ที่ขาด"],
          ["Dev Loop evidence", "อ่าน dev_loop_check_results ได้จริงและไม่มีผล fail", "NOT READY พร้อมเหตุผลของ path ที่ fail"],
          ["Registry proposals", "ไม่มีข้อเสนอสถานะ pending", "NOT READY พร้อมรายการที่รออนุมัติ"],
          ["Release chain", "package.json เป็น semver และ CURRENT_STATE อยู่ใน CHANGELOG", "NOT READY เมื่อหลักฐานหายหรือเลขเวอร์ชันผิด"],
          ["Health & governance", "DNA_OS_HEALTH.json และ governance summary", "NOT READY เมื่อต่ำกว่าเกณฑ์"],
        ],
      },
    },
    {
      id: "run",
      heading: "วิธีรันและการอ่านผล",
      code: {
        language: "bash",
        content: `# ตรวจก่อน build (prebuild เรียกอัตโนมัติ)
npm run deploy-gate

# ผลที่ผ่าน
DNA OS Health Score: 100 / 100
PASSED: 8 / 8
FAILED: 0
READY

# ผลที่ไม่ผ่าน
Deploy Blocked — Dev Loop Pipeline
  - Dev Loop evidence query failed: <reason>`,
      },
      bullets: [
        "เกณฑ์นี้ออกแบบแบบ fail-closed: หากอ่านหลักฐานไม่ได้ ระบบถือว่าไม่ผ่านและหยุดทันที",
        "คิวรีที่คืน error, โยน exception, คืน dataset ว่าง หรือคืน null จะถูกนับเป็นหลักฐานไม่ครบทั้งหมด",
        "ทุกครั้งที่ gate ผ่าน จะมีการบันทึกหลักฐานการตรวจไว้ใน registry/VALIDATION_RESULTS.json",
        "การอนุมัติ deploy ของมนุษย์ยังต้องทำผ่าน governance flow ก่อนปล่อยจริง",
      ],
    },
    {
      id: "verify",
      heading: "ขั้นตอนยืนยันก่อนปล่อย",
      bullets: [
        "รัน npm run verify-env และต้องได้ exit 0",
        "รัน npm run deploy-gate และต้องเห็น READY",
        "รัน npx tsc --noEmit และต้องไม่มีข้อผิดพลาด",
        "รัน npm run build และต้องคอมไพล์ทุกหน้าสำเร็จ",
        "ตรวจ smoke test เส้นทางหลัก: /, /products, /admin/docs และ /api/v1/developer-portal",
      ],
    },
  ],
};

export const DOCS: DocSpec[] = [
  systemOverview,
  runtimeFlow,
  registryMap,
  pricingEngine,
  dispatchContract,
  queryEndpoint,
  discoveryEndpoints,
  tokenEndpoints,
  lineWebhook,
  mcpIntegration,
  connectorsDoc,
  environmentKeys,
  accessControl,
  deployGate,
];

export function docsForCategory(categoryId: string): DocSpec[] {
  return DOCS.filter((doc) => doc.category === categoryId);
}

export function findDoc(slug: string | undefined): DocSpec | undefined {
  if (!slug) return undefined;
  return DOCS.find((doc) => doc.slug === slug);
}

export const ENDPOINT_INDEX: EndpointIndexEntry[] = DOCS.flatMap((doc) =>
  doc.sections.flatMap((section) =>
    (section.endpoints ?? []).map((endpoint) => ({
      method: endpoint.method,
      path: endpoint.path,
      auth: endpoint.auth,
      summary: endpoint.summary,
      doc: doc.slug,
      section: section.id,
    })),
  ),
);

import permissions from "@/registry/permissions.json";

/**
 * SURFACE / CAPABILITY-ACTION POLICY — the API + runtime half of the
 * Business ⇄ Developer control-surface split (owner directive 2026-10-12).
 *
 *  - A pure resolver that reads ONE existing authority:
 *    registry/permissions.json#capability_actions (the same single-registry
 *    pattern route_access / api_access / capability_access already use).
 *  - It decides only ONE thing: may this HTTP request perform a
 *    developer-plane ACTION from the caller's current SURFACE?
 *
 * NOT: a second identity/session system (who is logged in is still decided
 * only by core/auth/session.ts + requireAuth/requireAuthPage) · NOT a second
 * permission registry (every list lives in registry/permissions.json only) ·
 * NOT an AI-provider check (separation is by capability + action, never by
 * provider name).
 *
 * AUTHORITY MODEL (already in the system, not invented here):
 *  - dna-os-step2/control/owner-surface-separation/surface.ts —
 *    STRICT_OPERATIONAL_DEVELOPMENT_SURFACE_SEPARATION_V1: "Authority domains
 *    are routing/exposure, not chat policy"; operational surface cannot modify
 *    source (operationalModifySource → false) and source READ ≠ source WRITE
 *    (sourceReadIsNotWrite). This module wires that model into the API edge.
 *  - Surfaces are ROUTING only. Actually changing source still goes through
 *    the pre-existing chain unchanged: requireAuth(ADMIN_TIER) →
 *    app/api/admin/ide/_lib/fsSecurity.ts → review/build/deploy gates →
 *    scripts/deploy-gate.ts. Nothing here grants, replaces or widens it.
 *
 * SURFACE RESOLUTION (fail-closed):
 *  - cookie `dna_os_surface=development` → DEVELOPMENT surface
 *  - anything else (absent, unknown, tampered) → OPERATIONAL = Business
 *    Workspace = DENY on every developer-plane write action.
 *  - The cookie is written ONLY by middleware.ts and only as a side effect of
 *    opening a workspace entry URL (page navigation, never an API call), so
 *    an API caller cannot mint its own surface.
 */

export type SurfaceId = "operational" | "development";

/** Single cookie name — written by middleware.ts, read here and there only. */
export const SURFACE_COOKIE = "dna_os_surface";

interface CapabilityActionRegistry {
  default_surface?: string;
  write_methods?: string[];
  surfaces?: Record<string, { entry_urls?: string[]; cookie_value?: string; th?: string }>;
  deny?: Record<string, { prefixes: string[]; th?: string; authority?: string }>;
  allow?: Record<string, { prefixes: string[]; th?: string; authority?: string }>;
  sandbox?: SandboxRegistry;
}

/** AI SANDBOX ISOLATION (owner directive 2026-10-15, ต่อจาก unified outbound):
 *  สอง Runtime Boundary — OWNER AI กับ SALES AI — อ่านจาก registry เดียวกัน
 *  นี้ (ไม่ใช่ registry คู่ขนาน) โดย dispatcher เป็นจุดบังคับเดียว ทุกสาย AI
 *  เดิน dispatch ผ่าน engines/validation/dispatcher.ts แล้วตรวจจากที่นี่ */
export type SandboxId = "owner" | "sales";

interface SandboxRegistry {
  authority?: string;
  fail_closed?: boolean;
  sandboxes?: Record<string, SandboxDefinition>;
}

export interface SandboxDefinition {
  th?: string;
  /** command prefixes ที่สาย AI sandbox นี้เรียกได้ (whitelist — ที่ไม่อยู่ = DENY) */
  allow_prefixes?: string[];
  /** command prefixes ที่ DENY หนักเสมอ แม้ match allow (defense-in-depth) */
  deny_prefixes?: string[];
}

const REGISTRY = permissions as typeof permissions & {
  capability_actions?: CapabilityActionRegistry;
};

function capabilityActions(): CapabilityActionRegistry {
  const policy = REGISTRY.capability_actions;
  if (!policy || !policy.deny || !policy.write_methods) {
    // Fail closed: a missing/unreadable policy never opens a developer write.
    return { write_methods: ["POST", "PUT", "PATCH", "DELETE"], deny: {}, allow: {} };
  }
  return policy;
}

/** Fail-closed surface resolution — anything that is not explicitly the
 *  DEVELOPMENT surface is the OPERATIONAL (Business) surface. */
export function resolveSurface(cookieValue: string | undefined | null): SurfaceId {
  const policy = capabilityActions();
  const development = policy.surfaces?.development?.cookie_value ?? "development";
  return cookieValue === development ? "development" : "operational";
}

/** Workspace entry URLs that switch the caller's surface (page navigation
 *  only). Returns the target surface for a page path, or null when the path
 *  is not a workspace entry — API calls and ordinary pages never switch. */
export function surfaceForPagePath(pathname: string): SurfaceId | null {
  const policy = capabilityActions();
  for (const [id, def] of Object.entries(policy.surfaces ?? {})) {
    if ((def.entry_urls ?? []).some((url) => pathname === url || pathname.startsWith(url + "/"))) {
      return id === "development" ? "development" : "operational";
    }
  }
  return null;
}

export interface SurfaceDecision {
  allowed: boolean;
  /** capability action that produced the decision ("" when none matched) */
  action: string;
  surface: SurfaceId;
  reason: string;
  code?: string;
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : prefix + "/");
}

/**
 * The one decision function: does `method` on `pathname` require the
 * DEVELOPMENT surface (developer-plane action), and does the caller have it?
 *
 * Reads (GET/HEAD) are never blocked here — operational source READ is
 * explicitly allowed by the existing authority (sourceReadIsNotWrite) and the
 * Business Workspace keeps every shared capability it uses today.
 */
export function decideSurfaceAction(input: {
  pathname: string;
  method: string;
  surface: SurfaceId;
}): SurfaceDecision {
  const { pathname, method, surface } = input;
  const policy = capabilityActions();
  const writeMethods = (policy.write_methods ?? []).map((m) => m.toUpperCase());
  const upperMethod = method.toUpperCase();

  // Read path: allowed on both surfaces (business keeps CLI/shared reads).
  if (!writeMethods.includes(upperMethod)) {
    return { allowed: true, action: "", surface, reason: "read-only method — both surfaces allowed" };
  }

  for (const [action, rule] of Object.entries(policy.deny ?? {})) {
    if (rule.prefixes.some((prefix) => matchesPrefix(pathname, prefix))) {
      if (surface === "development") {
        return {
          allowed: true,
          action,
          surface,
          reason: "DEVELOPMENT surface — เดินเข้า existing source authority chain เดิม (requireAuth + fsSecurity + review/build/deploy gate)",
        };
      }
      return {
        allowed: false,
        action,
        surface,
        code: "SURFACE_ACTION_DENIED",
        reason: `${action} สงวนไว้สำหรับ Developer Workspace — Business surface ไม่มีสิทธิ์นี้ (เปิด /developer เพื่อสลับ surface)`,
      };
    }
  }

  return { allowed: true, action: "", surface, reason: "ไม่ได้อยู่ในชุด developer-plane action" };
}

/** ตัวจับคู่สำหรับคำสั่ง registry (รูปแบบ "module.action") — prefix เช่น
 *  "material." จับ "material.quote" และทุกคำสั่งใต้โมดูลเดียวกัน
 *  (ไม่อนุญาต string เดียว match ผิดโมดูล — ต้องไม่ใช่ '/'-path rule เดิม) */
function commandMatchesPrefix(command: string, prefix: string): boolean {
  return command === prefix || command.startsWith(prefix);
}

/** ─────────────────────────────────────────────────────────────────────
 *  CHAT SURFACE POLICY (owner directive 2026-10-18, SURFACE: ADMIN_CHAT)
 *  ชุดนโยบายสิทธิ์ของสายแชทผู้ดูแล — อ่านจาก registry เดียวกันนี้ที่เดียว
 *  (registry/permissions.json#capability_actions.chat) ไม่มีสายขนาน
 *  · fail-closed: deny ชนะเสมอ (deny_wins) · สิ่งที่ไม่ได้อนุญาตมา
 *    ชัดเจนเป็น ALLOW/CONDITIONAL ห้ามทำ · CONDITIONAL ผ่านได้เฉพาะผ่าน
 *    flow ยืนยันเดิม (confirm_token) — ฟังก์ชันนี้แค่บอกสถานะ ไม่แทนที่
 *    gate ยืนยันของ pipeline เดิม
 *  ───────────────────────────────────────────────────────────────────── */
export type ChatPolicyAction = "allow" | "conditional" | "deny";

export interface ChatCapabilityDecision {
  allowed: boolean;
  action: ChatPolicyAction;
  capability: string;
  /** true เมื่อ CONDITIONAL — ต้องมีการยืนยันจริงจากเจ้าของ (flow เดิม) ก่อนจึงจะลงมือ */
  requiresConfirmation: boolean;
  reason: string;
}

interface ChatSurfaceDef {
  allow?: string[];
  conditional?: string[];
  conditional_rule?: string;
  deny?: string[];
  deny_map?: Record<string, string[]>;
}

interface ChatPolicyRegistry {
  authority?: string;
  fail_closed?: boolean;
  deny_wins?: boolean;
  surfaces?: Record<string, ChatSurfaceDef>;
}

function chatRegistry(): { chat?: ChatPolicyRegistry } {
  const policy = REGISTRY.capability_actions as
    | (CapabilityActionRegistry & { chat?: ChatPolicyRegistry })
    | undefined;
  return { chat: policy?.chat };
}

export const ADMIN_CHAT_SURFACE = "ADMIN_CHAT";

/** ตัดสินสิทธิ์ capability เดียวของ ADMIN_CHAT — อ่าน registry ไฟล์เดียว */
export function decideChatCapability(input: {
  surface?: string;
  capability: string;
  /** CONDITIONAL เท่านั้น: คำสั่งนี้ผ่าน flow ยืนยันของ pipeline แล้วหรือยัง */
  confirmed?: boolean;
}): ChatCapabilityDecision {
  const surface = input.surface ?? ADMIN_CHAT_SURFACE;
  const def = chatRegistry().chat?.surfaces?.[surface];
  if (!def) {
    return {
      allowed: false,
      action: "deny",
      capability: input.capability,
      requiresConfirmation: false,
      reason: `surface "${surface}" ยังไม่ประกาศใน registry/permissions.json#capability_actions.chat — ปฏิเสธ (fail-closed ห้ามเดา)`,
    };
  }
  if ((def.deny ?? []).includes(input.capability)) {
    return {
      allowed: false,
      action: "deny",
      capability: input.capability,
      requiresConfirmation: false,
      reason: `ADMIN_CHAT DENY: "${input.capability}" สงวนไว้นอกสายแชท — แชทผู้ดูแลสั่งจอ/หน้าต่าง/เบราว์เซอร์/เดสก์ท็อปไม่ได้`,
    };
  }
  if ((def.conditional ?? []).includes(input.capability)) {
    return input.confirmed
      ? {
          allowed: true,
          action: "conditional",
          capability: input.capability,
          requiresConfirmation: true,
          reason: `ADMIN_CHAT CONDITIONAL: "${input.capability}" ผ่านการยืนยันจริงแล้ว — เดิน flow เดิมต่อได้`,
        }
      : {
          allowed: false,
          action: "conditional",
          capability: input.capability,
          requiresConfirmation: true,
          reason: `ADMIN_CHAT CONDITIONAL: "${input.capability}" ต้องรอการยืนยันจริงจากเจ้าของ (ผ่าน flow ยืนยันเดิมก่อน)`,
        };
  }
  if ((def.allow ?? []).includes(input.capability)) {
    return {
      allowed: true,
      action: "allow",
      capability: input.capability,
      requiresConfirmation: false,
      reason: `ADMIN_CHAT ALLOW: "${input.capability}"`,
    };
  }
  return {
    allowed: false,
    action: "deny",
    capability: input.capability,
    requiresConfirmation: false,
    reason: `ADMIN_CHAT DENY: "${input.capability}" ไม่อยู่ใน allow/conditional ของ surface นี้ (deny-wins, fail-closed)`,
  };
}

/** ผลของการบังคับชุด directive บน response ของ pipeline */
export interface ChatDirectiveEnforcement {
  response: Record<string, unknown>;
  denied: string[];
}

/**
 * จุดบังคับจริงบน /api/chat — ตัดทุก ClientDirective ที่ DENY ออกจาก
 * response ก่อน route จะตอบ แล้วเปลี่ยนเป็นข้อความนโยบาย (ผู้ใช้เห็นเลยว่า
 * แชทใบนี้สั่งอะไรไม่ได้) · คืน response เดิมเมื่อไม่มีอะไรละเมิด
 */
export function enforceChatDirectivePolicy(
  response: Record<string, unknown>,
  surface = ADMIN_CHAT_SURFACE,
): ChatDirectiveEnforcement {
  const def = chatRegistry().chat?.surfaces?.[surface];
  const denyMap = def?.deny_map ?? {};
  const denied = new Set<string>();
  const cleaned = { ...response };
  for (const [capability, fields] of Object.entries(denyMap)) {
    for (const field of fields) {
      if (cleaned[field] !== undefined && cleaned[field] !== null) {
        delete cleaned[field];
        denied.add(capability);
      }
    }
  }
  if (denied.size === 0) return { response, denied: [] };
  const deniedList = [...denied];
  const sender = response.sender ?? "ai";
  const typed = typeof sender === "string" ? sender : "ai";
  return {
    response: {
      ...cleaned,
      sender: typed,
      type: "text",
      chat_policy_denied: deniedList,
      text: `ADMIN_CHAT surface: ปฏิเสธคำสั่ง ${deniedList.join(", ")} — แชทผู้ดูแลอ่าน/แสดงข้อมูลได้เท่านั้น สั่งจอ หน้าต่าง เบราว์เซอร์ หรือเดสก์ท็อปไม่ได้`,
    },
    denied: deniedList,
  };
}

/** Fail-closed: sandbox ที่ไม่รู้จัก/ประกาศไม่ครบ = DENY เสมอ (ไม่เดา)
 *  'owner' ยังไม่ถูกทำโทษ — Owner AI เป็นขอบเขตทั้งระบบที่มีอยู่เดิม;
 *  ผ่านการแยกเป็นสายมาตั้งแต่ requireAuth(ADMIN_TIER) ทุกจุด */
export function decideSandboxCommand(input: {
  command: string;
  sandbox: SandboxId;
}): { allowed: boolean; sandbox: SandboxId; reason: string } {
  const { command, sandbox } = input;
  if (sandbox === "owner") {
    return { allowed: true, sandbox, reason: "OWNER AI sandbox — บอบเบอร์เขต Owner เต็มรูปตาม requireAuth(ADMIN_TIER) เดิม" };
  }
  const def = REGISTRY.capability_actions?.sandbox?.sandboxes?.sales;
  if (!def || !(def.allow_prefixes ?? []).length) {
    return { allowed: false, sandbox, reason: `sandbox "${sandbox}" ยังไม่ประกาศใน registry/permissions.json — ปฏิเสธ (fail-closed, ห้ามเดา)` };
  }
  for (const prefix of def.deny_prefixes ?? []) {
    if (commandMatchesPrefix(command, prefix)) {
      return { allowed: false, sandbox, reason: `SALES_SANDBOX_DENY: command "${command}" ตรง deny "${prefix}" — Owner/finance tools สงวนไว้สาย OWNER AI เดิม` };
    }
  }
  for (const prefix of def.allow_prefixes ?? []) {
    if (commandMatchesPrefix(command, prefix)) {
      return { allowed: true, sandbox, reason: `SALES_SANDBOX_ALLOW: "${command}" อยู่ในชุดเครื่องมือขายที่ registry อนุญาต` };
    }
  }
  return { allowed: false, sandbox, reason: `SALES_SANDBOX_DENY: "${command}" ไม่อยู่ใน allow-list ของ sandbox ขาย (whitelist fail-closed)` };
}

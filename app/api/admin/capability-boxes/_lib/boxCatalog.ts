/**
 * Capability Box Catalog — read-only join ของระบบที่มีอยู่จริงเท่านั้น
 *
 * แหล่งข้อมูล (มีอยู่แล้วทั้งหมด — ไฟล์นี้ไม่สร้าง registry/resolver ใหม่):
 *   - registry/command-registry.json      → commands (identity · input · output · requires_confirmation
 *                                            · query_constraints · capability_actions)
 *   - registry/capability-registry.json   → 202 capabilities (frozen · checksum-locked runtime authority)
 *   - registry/connector-lifecycle.json   → 5 ขั้น install ที่เป็น LAW ของ DNA OS
 *   - core/workspace/applicationRegistry.ts → composition ที่ประกาศไว้ (application → panels → presenterId)
 *
 * Identity Binding (STEP 5 ของ CAPABILITY_BOX_RUNTIME_INVENTORY.md) — ใช้คีย์เดิมที่มีอยู่:
 *   command-registry.commands[].owner  ↔  capability-registry.capabilities[].OwnerModule
 *   เจอ = "resolved" · ไม่เจอ = "no_capability" (รายงานตรง ไม่เดา ไม่สร้าง capability ใหม่)
 *
 * ห้าม: สร้าง registry ใหม่ · เดา mapping · แต่งตัวเลขธุรกิจ · แตะ Canvas (FROZEN) ·
 *       แตะ execution system (dispatch/dispatchAction/execute/executePlan มีอยู่แล้ว)
 *
 * หมายเหตุ: `requires_confirmation` ใน command-registry = presence ของคีย์ (ไม่ใช่ boolean เสมอ)
 * → ถือว่ามีคีย์ = ต้องยืนยัน (fail-closed) แล้วให้ `dispatch()` ตัดสินจริงอีกชั้น
 */
import commandRegistry from "@/registry/command-registry.json";
import capabilityRegistry from "@/registry/capability-registry.json";
import connectorLifecycle from "@/registry/connector-lifecycle.json";
import { APPLICATIONS } from "@/core/workspace/applicationRegistry";

export type BoxKind = "business_read" | "business_write" | "capability_action";
export type BoxMappingStatus = "resolved" | "no_capability";

export interface BoxCapabilityLink {
  capabilityId: string;
  exportName: string;
  category: string;
  executionType: string;
  mutability: string;
  status: string;
}

export interface BoxConnectLink {
  /** identity ของ connect/tool ที่ command นี้จะถูกส่งไป (เช่น line-mcp-server/send_line_notify) */
  primary: string;
  fallback: string | null;
  /** status ที่ทะเบียนประกาศไว้เอง (ส่วนใหญ่คือ "stub" = ยังไม่ต่อจริง) */
  status: string;
  /** owner ที่ทะเบียนประกาศ (เช่น v6-executor/capability-manager) */
  declaredOwner: string | null;
}

export interface BoxQueryConstraint {
  table: string;
  filters: Record<string, unknown>;
}

export interface CapabilityBox {
  boxId: string;
  kind: BoxKind;
  layer: string;
  /** ชื่อโมดูลตามที่ทะเบียน *ประกาศ* — ไม่ใช่ผลจากการ parse source (ดู note ใน catalog) */
  ownerModule: string;
  input: Record<string, unknown>;
  output: string;
  requiresConfirmation: boolean;
  description: string;
  descriptionTh: string | null;
  queryConstraint: BoxQueryConstraint | null;
  capability: BoxCapabilityLink | null;
  mappingStatus: BoxMappingStatus;
  connect: BoxConnectLink | null;
}

export interface BoxCatalogSummary {
  commandsTotal: number;
  readCommands: number;
  writeCommands: number;
  mappedToCapability: number;
  noCapability: number;
  capabilityActions: number;
  connectLinked: number;
}

export interface CapabilityBoxCatalog {
  sourceOfTruth: string;
  installFlow: { stages: string[]; enforcedBy: string | null; standard: string | null; status: string | null };
  summary: BoxCatalogSummary;
  boxes: CapabilityBox[];
  /** ความจริงที่ต้องอ่านคู่กันเสมอ (ห้ามตีความตัวเลขนี้ผิด) */
  notes: string[];
  presentations: {
    applications: { id: string; name: string; boardType: string; panels: { presenterId: string; title: string }[] }[];
    presenterIds: string[];
    note: string;
  };
}

interface RawCommand {
  owner?: string;
  layer?: string;
  input?: Record<string, unknown>;
  output?: string;
  description?: string;
  description_th?: string;
  requires_confirmation?: boolean;
}

interface RawCapability {
  CapabilityId: string;
  OwnerModule: string;
  ExportName: string;
  Category: string;
  ExecutionType: string;
  Mutability: string;
  Status: string;
}

interface RawCapabilityAction {
  owner?: string;
  layer?: string;
  primary?: string;
  fallback?: string;
  description?: string;
  requires_confirmation?: boolean;
  status?: string;
}

const commandTable = (commandRegistry as { commands: Record<string, RawCommand> }).commands ?? {};
const constraintTable = (commandRegistry as { query_constraints?: Record<string, unknown> }).query_constraints ?? {};
const actionTable = (commandRegistry as { capability_actions?: Record<string, unknown> }).capability_actions ?? {};
const capabilities = (capabilityRegistry as { capabilities: RawCapability[] }).capabilities ?? [];

/** OwnerModule → capability[] — view ในหน่วยความจำ (ไม่ใช่ registry) */
const capabilitiesByOwner = capabilities.reduce<Map<string, RawCapability[]>>((map, cap) => {
  const list = map.get(cap.OwnerModule) ?? [];
  list.push(cap);
  map.set(cap.OwnerModule, list);
  return map;
}, new Map());

function isRealKey(key: string): boolean {
  return !key.startsWith("_");
}

function pickCapability(ownerModule: string): RawCapability | null {
  const list = capabilitiesByOwner.get(ownerModule);
  if (!list || list.length === 0) return null;
  // 1 โมดูลมีได้หลาย capability (1:N) — เลือกตัวแรกแบบ deterministic ตามลำดับในทะเบียน
  // และคืน OwnerModule/ExportName ไว้ให้ผู้เรียกตรวจต่อ ไม่ตัดสินแทน
  return list[0];
}

export function buildCapabilityBoxCatalog(): CapabilityBoxCatalog {
  const boxes: CapabilityBox[] = [];
  const summary: BoxCatalogSummary = {
    commandsTotal: 0,
    readCommands: 0,
    writeCommands: 0,
    mappedToCapability: 0,
    noCapability: 0,
    capabilityActions: 0,
    connectLinked: 0,
  };

  for (const boxId of Object.keys(commandTable).filter(isRealKey).sort()) {
    const def = commandTable[boxId];
    const ownerModule = def.owner ?? "";
    // fail-closed: มีค่าเป็น false เท่านั้นจึงถือว่า read · ค่าอื่น/ไม่มีคีย์ = ต้องยืนยัน
    const requiresConfirmation = def.requires_confirmation !== false;
    const cap = pickCapability(ownerModule);
    const rawConstraint = constraintTable[boxId];
    const rawAction = actionTable[boxId] as RawCapabilityAction | undefined;

    const connect: BoxConnectLink | null =
      rawAction && rawAction.primary
        ? {
            primary: rawAction.primary,
            fallback: rawAction.fallback ?? null,
            status: rawAction.status ?? "unknown",
            declaredOwner: rawAction.owner ?? null,
          }
        : null;

    const queryConstraint: BoxQueryConstraint | null =
      rawConstraint && typeof rawConstraint === "object" && "table" in (rawConstraint as object)
        ? {
            table: String((rawConstraint as { table: unknown }).table),
            filters: (rawConstraint as { filters?: Record<string, unknown> }).filters ?? {},
          }
        : null;

    boxes.push({
      boxId,
      kind: requiresConfirmation ? "business_write" : "business_read",
      layer: def.layer ?? "unknown",
      ownerModule,
      input: def.input ?? {},
      output: def.output ?? "",
      requiresConfirmation,
      description: def.description ?? "",
      descriptionTh: def.description_th ?? null,
      queryConstraint,
      capability: cap
        ? {
            capabilityId: cap.CapabilityId,
            exportName: cap.ExportName,
            category: cap.Category,
            executionType: cap.ExecutionType,
            mutability: cap.Mutability,
            status: cap.Status,
          }
        : null,
      mappingStatus: cap ? "resolved" : "no_capability",
      connect,
    });

    summary.commandsTotal += 1;
    if (requiresConfirmation) summary.writeCommands += 1;
    else summary.readCommands += 1;
    if (cap) summary.mappedToCapability += 1;
    else summary.noCapability += 1;
    if (connect) summary.connectLinked += 1;
  }

  // capability_actions = command↔connect/tool ที่ทะเบียนประกาศไว้ (คนละตระกูลกับ commands)
  for (const actionId of Object.keys(actionTable).filter(isRealKey).sort()) {
    const action = actionTable[actionId] as RawCapabilityAction;
    if (!action.primary) continue;
    boxes.push({
      boxId: actionId,
      kind: "capability_action",
      layer: action.layer ?? "unknown",
      ownerModule: action.owner ?? "",
      input: {},
      output: "",
      requiresConfirmation: action.requires_confirmation === true,
      description: action.description ?? "",
      descriptionTh: null,
      queryConstraint: null,
      capability: null,
      mappingStatus: "no_capability",
      connect: {
        primary: action.primary,
        fallback: action.fallback ?? null,
        status: action.status ?? "unknown",
        declaredOwner: action.owner ?? null,
      },
    });
    summary.capabilityActions += 1;
    summary.connectLinked += 1;
  }

  const applications = APPLICATIONS.map((app) => ({
    id: app.id,
    name: app.name,
    boardType: app.boardType as string,
    panels: app.panels.map((panel) => ({ presenterId: panel.presenterId as string, title: panel.title })),
  }));

  const presenterIds = Array.from(new Set(applications.flatMap((app) => app.panels.map((p) => p.presenterId))));

  return {
    sourceOfTruth:
      "registry/command-registry.json + registry/capability-registry.json + registry/connector-lifecycle.json + core/workspace/applicationRegistry.ts (read-only join — no new registry, no fabricated entry)",
    installFlow: {
      stages: (connectorLifecycle as { stages?: string[] }).stages ?? [],
      enforcedBy: (connectorLifecycle as { enforced_programmatically_by?: string }).enforced_programmatically_by ?? null,
      standard: (connectorLifecycle as { standard?: string }).standard ?? null,
      status: (connectorLifecycle as { status?: string }).status ?? null,
    },
    summary,
    boxes,
    notes: [
      "ownerModule คือค่าที่ทะเบียน *ประกาศ* (command-registry.commands[].owner) ไม่ใช่ผลจากการ parse source — " +
        "บางรายการเป็นชื่อที่ไม่ใช่ไฟล์จริง เช่น \"engines/validation/resolver\" หรือ \"engines/business\" จึงเทียบกับ " +
        "capability-registry.OwnerModule ได้เพียงบางรายการ (นี่คือช่องว่าง identity ที่รายงานไว้ใน CAPABILITY_BOX_RUNTIME_INVENTORY.md STEP 5)",
      "การรู้ว่ากล่องใด 'มี handler จริง' ต้องถามตอน Run — POST /api/admin/capability-boxes/run จะคืน violations จาก dispatch() เอง " +
        "(catalog ไม่อ้างว่า runnable เพราะ isRegistered() ของ dispatcher ตรวจ command-registry ซึ่งเป็นไฟล์เดียวกับที่ catalog อ่าน)",
      "capability_action = command↔connect/tool ที่ทะเบียน declare ไว้เอง (ส่วนใหญ่ status=stub = ยังไม่ต่อจริง) " +
        "ไม่ใช่หลักฐานว่ามีการเชื่อมแล้ว",
    ],
    presentations: {
      applications,
      presenterIds,
      note:
        "presenterId มาจาก core/workspace/applicationRegistry.ts (composition ที่ประกาศไว้จริง) — " +
        "ตัวที่ยังไม่มี Presenter จริง core/workspace/gateway/presenterMap.ts จะคืน null ให้ผู้เรียกจัดการเอง. " +
        "ห้ามอนุมาน presenter จาก command เพราะ command ที่ owner=services/supabase/queries.ts มี 7 presenter ใช้โมดูลเดียวกัน (1:N)",
    },
  };
}

export function findBox(boxId: string): CapabilityBox | null {
  return buildCapabilityBoxCatalog().boxes.find((box) => box.boxId === boxId) ?? null;
}


/**
 * BUSINESS WORKSPACE — Connect capabilities → BusinessDisplayModel
 * (LINE P5 · owner D4=ก + display-first directive, 2026-09-24)
 *
 * REWIRE, not a new system: shape แต่ "ข้อเท็จจริงของ contract ที่ declare
 * ไว้แล้ว" จาก engines/connectors/registry (findContract /
 * listConnectContractIds — provider-neutral ตัวเดียวกับ /admin/connectors)
 * · ไม่มี DB · ไม่มี fetch · ไม่มี credential · ไม่มี health claim: มีแถว
 * contract = "declare ไว้" ห้ามแปลว่า "ต่ออยู่/ทำงานอยู่" (กติกา toolBindings)
 * — สถานะ credential ดูต่อที่หน้าเดิม /admin/connectors ที่ binding.route เปิด
 *
 * Owner 2026-09-24 (display-first): เส้นทางข้อความ/รูป/แชตของ LINE ไม่ถูกแตะ
 * — เปลี่ยนแค่รูปการแสดงผล · label_key แสดงตามตัวแบบเดียวกับ
 * app/admin/connectors/page.tsx (ไม่มีตัว resolve ภาษาในระบบ ไม่แปลเอง)
 *
 * Consumer: app/workspace/page.tsx — ผู้เรียกเดียว (server component) ·
 * ห้าม import จาก client component
 */
import { findContract, listConnectContractIds } from "@/engines/connectors/registry";
import type { CapabilityMetadata } from "@/engines/connectors/contract";
import type { BusinessDisplayModel, FieldRow } from "@/app/admin/ui-gallery/_lib/businessDisplayModel";
import type { OpenTarget } from "./businessTools";

export const CONNECT_TABLE_TARGET_ID = "connect-table";
const providerTargetId = (id: string) => `connect:${id}`;

/** presentation-layer mapping เฉพาะ — identifiers ของ contract ไม่ถูกแปล/ดัดแปลง */
const DIRECTION_TH: Record<string, string> = {
  INBOUND: "ขาเข้า",
  OUTBOUND: "ขาออก",
  BIDIRECTIONAL: "สองทาง",
};

function field(label: string, value: string, tone?: FieldRow["tone"]): FieldRow {
  return { kind: "field", id: `cf-${label}`, label, value, ...(tone ? { tone } : {}) };
}

interface ContractFacts {
  providerId: string;
  authModes: string[];
  approval: string;
  capabilities: CapabilityMetadata[];
}

/** อ่านแต่ static contract facts — ไม่เรียก detect/inspect (ต้องมี runtime deps) */
function contractFacts(): ContractFacts[] {
  return listConnectContractIds().map((providerId) => {
    const contract = findContract(providerId);
    return {
      providerId,
      authModes: contract ? [...contract.authModes] : [],
      approval: contract?.approvalRequirement ?? "—",
      capabilities: contract ? contract.capabilityMetadata() : [],
    };
  });
}

export function buildConnectListModel(facts: ContractFacts[]): BusinessDisplayModel {
  const capabilityCount = facts.reduce((sum, f) => sum + f.capabilities.length, 0);
  return {
    id: "left-connections-live",
    title: "การเชื่อมต่อ",
    domain: "Connect Core · contract ที่ declare ไว้ (ไม่ใช่สถานะ health สด)",
    blocks: [
      {
        kind: "lines",
        id: "conn-summary",
        items: [
          { kind: "text", id: "conn-count", text: `ผู้ให้บริการใน Connect registry: ${facts.length} ราย` },
          { kind: "text", id: "conn-caps", text: `capability ที่ declare ไว้: ${capabilityCount} รายการ` },
          {
            kind: "text",
            id: "conn-source",
            text: "ที่มา: engines/connectors registry — สถานะ credential/health ดูที่หน้าจัดการเดิม",
            tone: "muted",
          },
        ],
      },
      facts.length === 0
        ? { kind: "lines", id: "conn-empty", items: [{ kind: "text", id: "conn-empty-1", text: "ยังไม่มี contract ใน registry" }] }
        : {
            kind: "tree",
            id: "conn-providers",
            items: facts.map((f) => ({
              kind: "tree" as const,
              id: providerTargetId(f.providerId),
              label: f.providerId,
              depth: 0,
            })),
          },
    ],
  };
}

export function buildConnectTargets(facts: ContractFacts[]): Record<string, OpenTarget> {
  const targets: Record<string, OpenTarget> = {
    [CONNECT_TABLE_TARGET_ID]: {
      id: CONNECT_TABLE_TARGET_ID,
      title: "ตารางผู้ให้บริการ",
      model: {
        id: "right-connect-table",
        title: "Connect providers",
        domain: "Table → DataTable · contract facts เท่านั้น",
        blocks: [
          {
            kind: "table",
            id: "conn-table",
            columns: [
              { key: "provider", label: "provider" },
              { key: "auth", label: "authModes" },
              { key: "approval", label: "approval" },
              { key: "caps", label: "capabilities" },
            ],
            rows: facts.map((f) => [f.providerId, f.authModes.join(", ") || "—", f.approval, String(f.capabilities.length)]),
          },
        ],
      },
    },
  };

  for (const f of facts) {
    targets[providerTargetId(f.providerId)] = {
      id: providerTargetId(f.providerId),
      title: f.providerId,
      model: {
        id: `right-${providerTargetId(f.providerId)}`,
        title: f.providerId,
        domain: "Connect contract · declared facts only",
        blocks: [
          {
            kind: "fields",
            id: `cf-${f.providerId}`,
            fields: [
              field("providerId", f.providerId),
              field("authModes", f.authModes.join(", ") || "—"),
              field("approvalRequirement", f.approval, f.approval === "OWNER_REQUIRED" ? "warning" : undefined),
              field("credential / health", "ดูที่ /admin/connectors (หน้าเดิม)", "muted"),
            ],
          },
          {
            kind: "lines",
            id: `caps-${f.providerId}`,
            items:
              f.capabilities.length === 0
                ? [{ kind: "text" as const, id: `caps-${f.providerId}-none`, text: "contract นี้ไม่ declare capability" }]
                : f.capabilities.map((c) => ({
                    kind: "text" as const,
                    id: `cap-${f.providerId}-${c.id}`,
                    text: `${c.id} · ${DIRECTION_TH[c.direction] ?? c.direction} · ${c.label_key}`,
                  })),
          },
        ],
      },
    };
  }
  return targets;
}

/** server-only entry (รูปเดียวกับ loadPartnerWorkspace) — ไม่มี I/O นอก registry ใน process */
export async function loadConnectWorkspace(): Promise<{
  listModel: BusinessDisplayModel;
  targets: Record<string, OpenTarget>;
  rowCount: number;
}> {
  const facts = contractFacts();
  return {
    listModel: buildConnectListModel(facts),
    targets: buildConnectTargets(facts),
    rowCount: facts.length,
  };
}

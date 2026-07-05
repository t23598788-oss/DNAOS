/** Board — แปลงผลลัพธ์เป็น UI response */

import type { ExecutionOutput } from "../evaluation";
import type { Hypothesis } from "../hypothesis";
import type { ReflectionOutput } from "../reflection";
import type { WorldState } from "../state";

export interface BoardResponse {
  sender: "ai";
  type: "workspace" | "text";
  text: string;
  workspace?: { sections: BoardSection[] };
  next_actions?: string[];
  debug?: Record<string, unknown>;
}

interface BoardSection {
  type: string;
  title?: string;
  items?: Array<{ title?: string; subtitle?: string | null; label?: string; value?: string }>;
}

export function composeBoard(
  worldState: WorldState,
  hypotheses: Hypothesis[],
  executionResults: ExecutionOutput[],
  reflectionOutput: ReflectionOutput,
  turnCount: number,
): BoardResponse {
  const entities = worldState.entities;
  const sections: BoardSection[] = [];

  const customerEntities = entities.filter((e) => e.type === "customer" || e.type === "partner");
  if (customerEntities.length === 1) {
    const customer = customerEntities[0];
    sections.push({
      type: "info",
      title: customer.name,
      items: Object.entries(customer.attributes)
        .filter(([key]) => key !== "resolved")
        .map(([key, value]) => ({ label: key, value: String(value ?? "-") })),
    });
  } else if (customerEntities.length > 1) {
    sections.push({
      type: "list",
      title: `${customerEntities.length} ราย`,
      items: customerEntities.map((entity) => ({
        title: entity.name,
        subtitle: String(entity.attributes.phone ?? ""),
      })),
    });
  }

  addEntityList(sections, "debt", "หนี้", entities);
  addEntityList(sections, "document", "เอกสาร", entities);
  addEntityList(sections, "job", "งาน", entities);
  addEntityList(sections, "material", "วัสดุ", entities);

  for (const result of executionResults) {
    if (result.tool.includes(".create") && result.success && result.data) {
      const data = result.data as Record<string, unknown>;
      const html = data.html as string | undefined;
      const presenter = data.presenter as Record<string, string> | undefined;
      if (html) {
        sections.push({
          type: "document",
          title: presenter?.title ?? String(data.document_number ?? "เอกสาร"),
          html,
          subtitle: presenter?.summary ?? null,
          document_id: String(data.document_id ?? data.id ?? ""),
          document_number: String(data.document_number ?? ""),
        } as any);
      }
    }
  }

  const warnings = worldState.constraints.filter((c) => c.severity === "blocking" || c.severity === "warning");
  if (warnings.length) {
    sections.push({
      type: "warnings",
      items: warnings.map((constraint) => ({
        title: constraint.description,
        subtitle: constraint.resolution,
      })),
    });
  }

  return {
    sender: "ai",
    type: "workspace",
    text: reflectionOutput.summary,
    workspace: { sections },
    next_actions: [
      ...hypotheses.slice(0, 4).map((h) => h.description),
      ...executionResults.filter((r) => r.tool.includes(".create") && r.success).map(() => "ส่ง LINE"),
    ],
    debug: {
      entities: entities.length,
      constraints: worldState.constraints.length,
      hypotheses: hypotheses.length,
      execution_steps: executionResults.length,
      transitions: reflectionOutput.state_transitions.length,
      completeness: worldState.data_completeness,
      focus: worldState.suggested_focus,
      turn: turnCount,
    },
  };
}

function addEntityList(
  sections: BoardSection[],
  type: "debt" | "document" | "job" | "material",
  label: string,
  entities: WorldState["entities"],
) {
  const matched = entities.filter((entity) => entity.type === type);
  if (!matched.length) return;

  sections.push({
    type: type === "material" ? "grid" : "list",
    title: `${label} (${matched.length})`,
    items: matched.map((entity) => ({
      title: entity.name,
      subtitle: describeEntity(entity.attributes),
    })),
  });
}

function describeEntity(attributes: Record<string, unknown>): string {
  const amount = attributes.outstanding ?? attributes.principal ?? attributes.amount;
  if (amount !== undefined) return `${Number(amount).toLocaleString("th-TH")} บาท`;
  return String(attributes.status ?? attributes.job_status ?? "");
}

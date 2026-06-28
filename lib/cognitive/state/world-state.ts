/**
 * World State — รวมทุกอย่างเป็นสถานะของโลก
 *
 * Pure Function
 * รวม entities + graph + timeline + constraints → WorldState
 */

import type { Entity, ResourceGraph, Timeline, Constraint, WorldState, SituationInput } from "./types";

export function buildWorldState(
  input: SituationInput,
  entities: Entity[],
  graph: ResourceGraph,
  timeline: Timeline,
  constraints: Constraint[],
): WorldState {

  const primaryEntity = entities.find(e =>
    e.type === "customer" && e.name === input.who
  ) ?? entities.find(e => e.type === "customer") ?? null;

  const totalFields = 5;
  let filledFields = 0;
  if (input.who) filledFields++;
  if (input.who_id) filledFields++;
  if (input.what) filledFields++;
  if (input.action) filledFields++;
  if (entities.length > 0) filledFields++;
  const completeness = filledFields / totalFields;

  const hasBlocking = constraints.some(c => c.severity === "blocking");

  let focus = "general";
  if (input.action === "create") focus = "creation";
  else if (input.intent_type === "workflow") focus = "workflow";
  else if (input.intent_type === "transport") focus = "transport";
  else if (constraints.some(c => c.type === "overdue_payment")) focus = "debt_collection";
  else if (primaryEntity) focus = "review";

  return {
    id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    created_at: new Date().toISOString(),
    objective_id: input.objective_id,

    primary_entity: primaryEntity,
    entities,
    graph,
    timeline,
    constraints,

    context: {
      who: input.who,
      who_id: input.who_id,
      what: input.what,
      action: input.action,
      intent_type: input.intent_type,
      session_history: input.session_history,
    },

    data_completeness: Math.round(completeness * 100) / 100,
    has_blocking_constraints: hasBlocking,
    suggested_focus: focus,
  };
}

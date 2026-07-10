/**
 * Situation Builder — สร้าง World State จาก Objective + DB data
 *
 * Pure Function — รับ SituationInput → คืน WorldState
 * ไม่เรียก DB เอง (db_results ถูกส่งมาจากภายนอก)
 */

import type { SituationInput, WorldState } from "../state/types";
import { extractEntities } from "./entity-extractor";
import { extractEvents } from "./event-extractor";
import { buildResourceGraph } from "../state/resource-graph";
import { buildTimeline } from "../state/timeline";
import { checkConstraints } from "../state/constraint-engine";
import { buildWorldState } from "../state/world-state";

export function buildSituation(input: SituationInput): WorldState {
  // 1. ดึง Entity จากข้อมูล
  const entities = extractEntities(input);

  // 2. ดึง Events จาก Entity
  const events = extractEvents(entities);

  // 3. สร้าง Resource Graph
  const graph = buildResourceGraph(entities);

  // 4. สร้าง Timeline
  const timeline = buildTimeline(events);

  // 5. ตรวจ Constraints
  const constraints = checkConstraints(entities, events);

  // 6. รวมเป็น World State
  return buildWorldState(input, entities, graph, timeline, constraints);
}

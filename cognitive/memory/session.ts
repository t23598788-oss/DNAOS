/**
 * Memory / Session State — เก็บ State Transition ไม่ใช่แค่ Cache
 *
 * ตอบคำถามได้:
 *   - ตอนนี้โลกของระบบเป็นอย่างไร
 *   - อะไรเปลี่ยนจากเมื่อกี้
 *   - อะไรคือสถานะล่าสุด
 *   - อะไรถูกยกเลิกแล้ว
 *   - อะไรยังดำเนินอยู่
 */

import type { Entity, WorldState } from "../state/types";
import type { ReflectionOutput, StateTransition, MemoryUpdate } from "../reflection/engine";

// ═══════════════════════════════════════
// SESSION MEMORY — Stateful (ตัวเดียวที่มี state)
// ═══════════════════════════════════════

export interface SessionMemory {
  who: string | null;
  who_id: string | null;
  current_goal: string | null;
  previous_goals: string[];
  previous_actions: string[];
  pending_actions: string[];
  cancelled_actions: string[];
  known_entities: Entity[];
  state_transitions: StateTransition[];
  last_results: Record<string, unknown>;
  turn_count: number;
  started_at: string;
  updated_at: string;
}

let _memory: SessionMemory = createFreshMemory();

function createFreshMemory(): SessionMemory {
  return {
    who: null, who_id: null, current_goal: null,
    previous_goals: [], previous_actions: [], pending_actions: [],
    cancelled_actions: [], known_entities: [], state_transitions: [],
    last_results: {}, turn_count: 0,
    started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
}

// ── Read ──

export function getMemory(): Readonly<SessionMemory> {
  return { ..._memory };
}

export function isStale(): boolean {
  const fiveMin = 5 * 60 * 1000;
  return Date.now() - new Date(_memory.updated_at).getTime() > fiveMin;
}

// ── Reset ──

export function resetMemory(): SessionMemory {
  _memory = createFreshMemory();
  return getMemory();
}

export function newSession(who: string): SessionMemory {
  _memory = { ...createFreshMemory(), who, started_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  return getMemory();
}

// ── Apply Reflection ──

export function applyReflection(reflection: ReflectionOutput): SessionMemory {
  for (const update of reflection.memory_updates) {
    applyUpdate(update);
  }

  for (const entity of reflection.resolved_entities) {
    if (!_memory.known_entities.some(e => e.id === entity.id)) {
      _memory.known_entities.push(entity);
    }
  }

  _memory.state_transitions.push(...reflection.state_transitions);
  _memory.turn_count++;
  _memory.updated_at = new Date().toISOString();

  return getMemory();
}

function applyUpdate(update: MemoryUpdate) {
  const m = _memory as any;
  switch (update.action) {
    case "set":
      m[update.key] = update.value;
      break;
    case "add":
      if (Array.isArray(m[update.key])) m[update.key].push(update.value);
      break;
    case "remove":
      if (Array.isArray(m[update.key])) m[update.key] = m[update.key].filter((v: any) => v !== update.value);
      break;
    case "clear":
      if (Array.isArray(m[update.key])) m[update.key] = [];
      else m[update.key] = null;
      break;
  }
}

// ── Enrich WorldState ──

export function enrichWithMemory(worldState: WorldState): WorldState {
  const mem = _memory;
  const entities = [...worldState.entities];
  const events = [...worldState.timeline.events];

  for (const known of mem.known_entities) {
    if (!entities.some(e => e.id === known.id)) {
      entities.push({ ...known, source: "session" });
    }
  }

  let primaryEntity = worldState.primary_entity;
  if (!primaryEntity && mem.who && mem.who_id) {
    primaryEntity = entities.find(e => e.id === mem.who_id) ?? null;
  }

  for (const pending of mem.pending_actions) {
    events.push({
      id: `evt-pending-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`,
      type: "document_created",
      description: pending,
      entities: [],
      timestamp: null,
      status: "planned",
    });
  }

  const context = {
    ...worldState.context,
    who: worldState.context.who ?? mem.who,
    who_id: worldState.context.who_id ?? mem.who_id,
    session_history: [...mem.previous_goals, ...worldState.context.session_history],
  };

  let filled = 0;
  if (context.who) filled++;
  if (context.who_id) filled++;
  if (context.what) filled++;
  if (context.action) filled++;
  if (entities.length > 0) filled++;

  return {
    ...worldState,
    primary_entity: primaryEntity,
    entities,
    timeline: { ...worldState.timeline, events },
    context,
    data_completeness: Math.round((filled / 5) * 100) / 100,
  };
}

// ── Query: ตอบคำถามเกี่ยวกับสถานะโลก ──

export function whatChanged(): StateTransition[] {
  return _memory.state_transitions.slice(-10);
}

export function whatIsPending(): string[] {
  return _memory.pending_actions;
}

export function whatWasCancelled(): string[] {
  return _memory.cancelled_actions;
}

export function whatIsCurrentGoal(): string | null {
  return _memory.current_goal;
}

export function cancelPending(action: string): void {
  _memory.pending_actions = _memory.pending_actions.filter(a => a !== action);
  _memory.cancelled_actions.push(action);
  _memory.updated_at = new Date().toISOString();
}

export function executePending(action: string): void {
  _memory.pending_actions = _memory.pending_actions.filter(a => a !== action);
  _memory.previous_actions.push(action);
  _memory.updated_at = new Date().toISOString();
}

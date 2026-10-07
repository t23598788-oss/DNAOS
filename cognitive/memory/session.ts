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

function createFreshMemory(): SessionMemory {
  return {
    who: null, who_id: null, current_goal: null,
    previous_goals: [], previous_actions: [], pending_actions: [],
    cancelled_actions: [], known_entities: [], state_transitions: [],
    last_results: {}, turn_count: 0,
    started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
}

// Owner fix 2026-10-08 (a91d8b0 review): the old shared `"__default__"`
// bucket meant ANY caller that passed a null/empty sessionKey landed in the
// SAME memory as every other user in the process — two admins (or an admin
// and a bridge channel) silently shared goals/entities/pending actions. That
// is forbidden now: a session key is REQUIRED, callers derive it server-side
// from the authenticated identity (e.g. `u:<auth.id>:<key>` in
// app/api/chat/route.ts, `u:<auth.id>:command` in app/api/command/route.ts,
// `line:<lineUserId>` for LINE bridges). Fail closed instead of sharing.
const SESSION_TTL_MS = 30 * 60 * 1000; // unbounded growth guard — old sessions are just abandoned conversations
const _sessions = new Map<string, SessionMemory>();

function keyOf(sessionKey?: string | null): string {
  const key = sessionKey?.trim();
  if (!key) {
    throw new Error(
      "session key required — memory must be scoped per user/session (owner 2026-10-08: ห้ามใช้ __default__ ร่วมระหว่างผู้ใช้)",
    );
  }
  return key;
}

function getOrCreate(sessionKey?: string | null): SessionMemory {
  const key = keyOf(sessionKey);
  sweepStale();
  let mem = _sessions.get(key);
  if (!mem) {
    mem = createFreshMemory();
    _sessions.set(key, mem);
  }
  return mem;
}

function sweepStale(): void {
  const now = Date.now();
  for (const [key, mem] of _sessions) {
    if (now - new Date(mem.updated_at).getTime() > SESSION_TTL_MS) _sessions.delete(key);
  }
}

// ── Read ──

export function getMemory(sessionKey?: string | null): Readonly<SessionMemory> {
  return { ...getOrCreate(sessionKey) };
}

export function isStale(sessionKey?: string | null): boolean {
  const fiveMin = 5 * 60 * 1000;
  return Date.now() - new Date(getOrCreate(sessionKey).updated_at).getTime() > fiveMin;
}

// ── Reset ──

export function resetMemory(sessionKey?: string | null): SessionMemory {
  const key = keyOf(sessionKey);
  _sessions.set(key, createFreshMemory());
  return getMemory(key);
}

export function newSession(who: string, sessionKey?: string | null, whoId?: string | null): SessionMemory {
  const key = keyOf(sessionKey);
  _sessions.set(key, { ...createFreshMemory(), who, who_id: whoId ?? null, started_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  return getMemory(key);
}

// ── Apply Reflection ──

export function applyReflection(reflection: ReflectionOutput, sessionKey?: string | null): SessionMemory {
  const mem = getOrCreate(sessionKey);

  for (const update of reflection.memory_updates) {
    applyUpdate(mem, update);
  }

  for (const entity of reflection.resolved_entities) {
    if (!mem.known_entities.some(e => e.id === entity.id)) {
      mem.known_entities.push(entity);
    }
  }

  mem.state_transitions.push(...reflection.state_transitions);
  mem.turn_count++;
  mem.updated_at = new Date().toISOString();

  return getMemory(sessionKey);
}

function applyUpdate(mem: SessionMemory, update: MemoryUpdate) {
  const m = mem as any;
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

export function enrichWithMemory(worldState: WorldState, sessionKey?: string | null): WorldState {
  const mem = getOrCreate(sessionKey);
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

export function whatChanged(sessionKey?: string | null): StateTransition[] {
  return getOrCreate(sessionKey).state_transitions.slice(-10);
}

export function whatIsPending(sessionKey?: string | null): string[] {
  return getOrCreate(sessionKey).pending_actions;
}

export function whatWasCancelled(sessionKey?: string | null): string[] {
  return getOrCreate(sessionKey).cancelled_actions;
}

export function whatIsCurrentGoal(sessionKey?: string | null): string | null {
  return getOrCreate(sessionKey).current_goal;
}

export function cancelPending(action: string, sessionKey?: string | null): void {
  const mem = getOrCreate(sessionKey);
  mem.pending_actions = mem.pending_actions.filter(a => a !== action);
  mem.cancelled_actions.push(action);
  mem.updated_at = new Date().toISOString();
}

export function executePending(action: string, sessionKey?: string | null): void {
  const mem = getOrCreate(sessionKey);
  mem.pending_actions = mem.pending_actions.filter(a => a !== action);
  mem.previous_actions.push(action);
  mem.updated_at = new Date().toISOString();
}

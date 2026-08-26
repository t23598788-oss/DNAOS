/**
 * หน้าที่: ประตูสองบานของการเกิด capability
 *
 *   `evaluateCreationContract`  — ก่อนเขียนโค้ดบรรทัดแรก field ที่จำเป็นต้อง
 *                                 ครบ ถ้า UNKNOWN = บล็อก
 *   `evaluateCompletionGate`    — หลังเขียนแล้ว ตรวจกับของจริง: มี source จริง,
 *                                 input ต่อจริง, output มีผู้บริโภคจริง, router
 *                                 เลือกได้จริง, runtime เรียกได้จริง, มี identity
 *                                 ใน Registry จริง, verification ผ่านจริง
 *
 * ไม่มีบานไหนถาม AI และไม่มีบานไหนยอมให้ "จะต่อทีหลัง"
 *
 * Input: `CapabilityCreationContract` และของจริงในระบบ
 * Output: `evaluateCreationContract`, `evaluateCompletionGate`, `buildPreWritePacket`
 * Dependency ที่อนุญาต: Node built-ins, ./types.ts และ contract สาธารณะของ
 * system-read-paths / registry-database / runtime-control / machine-observation
 * — **ทั้งหมด reuse ห้ามเขียน resolver ใหม่**
 * สิ่งที่ห้ามแตะ:
 * - ห้ามให้ผ่านด้วย "ไฟล์มีอยู่" — การมีไฟล์คือเงื่อนไขที่อ่อนที่สุดในนี้
 * - ห้ามยอมรับ trigger ที่แปลว่า "ให้ Agent จำไว้ว่าต้องเรียก"
 * - ห้ามยอมรับ output ที่ปลายทางเป็นไฟล์รายงานที่ไม่มีผู้อ่านจริง
 * - ห้ามคืน OPERATIONAL ถ้ายังไม่มีหลักฐานว่ามันถูกเรียกจาก runtime จริง
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { dependencyKey } from "../work-continuation/contract";
import {
  LIFECYCLE_ORDER, REQUIRED_CONTRACT_FIELDS, REQUIRED_NONEMPTY_LISTS, TRIGGER_CLASSES, UNKNOWN,
  type CapabilityCreationContract, type CapabilityLifecycleState, type CreationGateResult,
  type MissingConnection, type PreWritePacket,
} from "./types";

const REPO_ROOT = process.env.CAPABILITY_CREATION_REPO_ROOT ?? process.cwd();


// ─────────────────────────────────────────────────────────────────────────────
// GATE 1 — before any file is written
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ตรวจว่าสัญญาการเกิดครบหรือยัง
 *
 * `resource_id`/`capability_id`/`service_id` ไม่ถูกบังคับที่นี่ เพราะ Registry
 * เป็นผู้มอบให้ตอน REGISTERED ซึ่งเกิดหลังจากนี้ — การบังคับให้มีตั้งแต่ตอนนี้
 * คือการบังคับให้ใครสักคนแต่งเลขขึ้นมาเอง
 */
export function evaluateCreationContract(contract: CapabilityCreationContract): CreationGateResult {
  const missing: MissingConnection[] = [];
  const satisfied: { check: string; evidence: string }[] = [];

  for (const field of REQUIRED_CONTRACT_FIELDS) {
    const value = contract[field];
    if (typeof value !== "string" || value.trim() === "" || value === UNKNOWN) {
      missing.push({
        kind: "CONTRACT_FIELD",
        detail: `${String(field)} is ${value === UNKNOWN ? "UNKNOWN" : "empty or absent"}`,
        blocked_on: dependencyKey("contract_field", String(field)),
        required_input: null, required_resource: null, required_evidence: null,
        next_action: `resolve ${String(field)} from a deterministic source before any file is written`,
      });
    }
  }
  for (const field of REQUIRED_NONEMPTY_LISTS) {
    const value = contract[field];
    if (!Array.isArray(value) || value.length === 0) {
      missing.push({
        kind: "CONTRACT_FIELD",
        detail: `${String(field)} is empty — an empty list here is not a claim, it is an unanswered question`,
        blocked_on: dependencyKey("contract_field", String(field)),
        required_input: null, required_resource: null, required_evidence: null,
        next_action: `state at least one entry for ${String(field)}`,
      });
    }
  }
  if (contract.trigger_type !== UNKNOWN && !TRIGGER_CLASSES.includes(contract.trigger_type)) {
    missing.push({
      kind: "INPUT",
      detail: `trigger_type "${contract.trigger_type}" is not one of the declared trigger classes — a capability whose only caller is an Agent that remembers to call it has no trigger`,
      blocked_on: dependencyKey("contract_field", "trigger_type"), required_input: null, required_resource: null, required_evidence: null,
      next_action: "name a real trigger class, or connect a real one",
    });
  }
  if (missing.length === 0) {
    satisfied.push({ check: "every required contract field is answered", evidence: `${REQUIRED_CONTRACT_FIELDS.length} fields + ${REQUIRED_NONEMPTY_LISTS.length} lists` });
    satisfied.push({ check: "trigger_type is a declared trigger class", evidence: String(contract.trigger_type) });
  }
  return {
    capability_name: contract.capability_name,
    state: missing.length === 0 ? "RESOLVED" : "BLOCKED",
    missing, satisfied,
    reason: missing.length === 0
      ? "the creation contract is complete — writing may be authorized"
      : `${missing.length} required answer(s) missing; creation is BLOCKED, not deferred`,
  };
}

/** Packet ที่ Agent ได้รับ สร้างจากสัญญาที่ผ่าน GATE 1 แล้วเท่านั้น */
export function buildPreWritePacket(
  contract: CapabilityCreationContract,
  reuse: { components_to_reuse: readonly string[]; forbidden_components: readonly string[]; exact_files_allowed: readonly string[]; forbidden_write_scope: readonly string[] },
): PreWritePacket {
  return {
    work_id: contract.work_id,
    capability_root: contract.capability_root,
    allowed_write_scope: [contract.capability_root],
    forbidden_write_scope: reuse.forbidden_write_scope,
    exact_files_allowed: reuse.exact_files_allowed,
    input_contract: contract.input_contract,
    output_contract: contract.output_contract,
    trigger: `${contract.trigger_type} via ${contract.input_source} (owner ${contract.trigger_owner})`,
    consumer: `${contract.output_consumer} -> ${contract.output_destination}`,
    components_to_reuse: reuse.components_to_reuse,
    forbidden_components: reuse.forbidden_components,
    runtime_owner: `${contract.runtime_type} / ${contract.execution_owner}`,
    verification_commands: contract.verification_commands,
    registration_requirements: [
      "the Registry must issue resource_id and capability_id — never mint one here",
      "the Duplicate Gate decides NEW vs EXTEND_EXISTING vs DUPLICATE",
    ],
    instruction: "Implement only this bounded capability.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GATE 2 — after the code exists
// ─────────────────────────────────────────────────────────────────────────────

/** True when any file under `root` (outside its own tests) contains `needle`. */
function referencedOutside(needle: string, excludeRoot: string): { found: boolean; where: string } {
  const skip = new Set([".git", "node_modules", ".next", "dist", "local-runtime"]);
  const stack = [REPO_ROOT];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const entry of entries) {
      if (skip.has(entry)) continue;
      const full = join(dir, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { stack.push(full); continue; }
      if (!entry.endsWith(".ts")) continue;
      const rel = full.slice(REPO_ROOT.length + 1);
      // a capability referencing itself proves nothing, and neither does its own test
      if (rel.startsWith(excludeRoot)) continue;
      let body: string;
      try { body = readFileSync(full, "utf8"); } catch { continue; }
      if (body.includes(needle)) return { found: true, where: rel };
    }
  }
  return { found: false, where: "" };
}

export interface CompletionGateInput {
  contract: CapabilityCreationContract;
  /** The symbol a caller would import to reach this capability. */
  entry_symbol: string;
  /** Real runtime evidence that this capability was actually invoked, if any. */
  runtime_invocation_evidence: string | null;
  /** Real registry identity, if the Registry has issued one. */
  registered: { resource_id: string; capability_id: string } | null;
  /** Result of really running the declared verification, if it was run. */
  verification: { ran: boolean; passed: boolean; detail: string };
}

/**
 * ตรวจ capability ที่เขียนเสร็จแล้วกับของจริง แล้วคืนสถานะที่แท้จริงของมัน
 *
 * ลำดับการตรวจสำคัญ: ทุกอย่างขึ้นกับ "มี source จริง" ก่อน แล้วจึงไล่ตาม
 * LIFECYCLE_ORDER สถานะที่คืนคือ **ขั้นสุดท้ายที่ผ่านจริง** ไม่ใช่ขั้นที่ตั้งใจไว้
 */
export function evaluateCompletionGate(input: CompletionGateInput): CreationGateResult {
  const { contract } = input;
  const missing: MissingConnection[] = [];
  const satisfied: { check: string; evidence: string }[] = [];
  let reached: CapabilityLifecycleState = "PROPOSED";
  const advance = (state: CapabilityLifecycleState): void => {
    if (LIFECYCLE_ORDER.indexOf(state) > LIFECYCLE_ORDER.indexOf(reached)) reached = state;
  };

  // 1 — source exists
  const rootFull = resolve(REPO_ROOT, contract.capability_root);
  const contractFile = join(rootFull, "contract.ts");
  const sourceExists = existsSync(rootFull) && existsSync(contractFile);
  if (!sourceExists) {
    missing.push({ kind: "REGISTRATION", detail: `${contract.capability_root}/contract.ts does not exist — there is nothing to connect`, blocked_on: dependencyKey("path", `${contract.capability_root}/contract.ts`), required_input: null, required_resource: null, required_evidence: null, next_action: "write the capability's public contract first" });
    return { capability_name: contract.capability_name, state: "PROPOSED", missing, satisfied, reason: "no source" };
  }
  satisfied.push({ check: "source exists behind a public contract", evidence: `${contract.capability_root}/contract.ts` });
  advance("RESOLVED");

  // 2 — registered identity
  if (input.registered === null) {
    missing.push({ kind: "REGISTRATION", detail: "the Registry has issued no resource_id/capability_id for this capability", blocked_on: dependencyKey("registry", contract.capability_root), required_input: null, required_resource: contract.capability_name, required_evidence: null, next_action: "run the existing registration pipeline (Candidate -> Duplicate Gate -> Registry Writer)" });
  } else {
    satisfied.push({ check: "registry identity exists", evidence: `${input.registered.resource_id} / ${input.registered.capability_id}` });
    advance("REGISTERED");
  }

  // 3 — INPUT: something real calls it
  const trigger = contract.trigger_type;
  const inputConnected = trigger !== UNKNOWN && TRIGGER_CLASSES.includes(trigger) && contract.input_source !== UNKNOWN && contract.input_source.trim() !== "";
  const callerFound = referencedOutside(input.entry_symbol, contract.capability_root);
  if (!inputConnected) {
    missing.push({ kind: "INPUT", detail: "INPUT_NOT_CONNECTED — no declared trigger class and real input source", blocked_on: dependencyKey("trigger", contract.capability_root), required_input: contract.input_type, required_resource: null, required_evidence: null, next_action: "connect a real trigger; an Agent remembering to call it is not one" });
  } else if (!callerFound.found) {
    missing.push({ kind: "INPUT", detail: `IMPLEMENTED_NOT_REACHABLE — nothing outside ${contract.capability_root} references ${input.entry_symbol}, so the declared trigger cannot actually reach it`, blocked_on: dependencyKey("caller", `${contract.capability_root}#${input.entry_symbol}`), required_input: contract.input_type, required_resource: null, required_evidence: null, next_action: `add the real call from ${contract.input_source}` });
  } else {
    satisfied.push({ check: "input is connected and really reachable", evidence: `${trigger} via ${contract.input_source}; called from ${callerFound.where}` });
    advance("INPUT_CONNECTED");
  }

  // 4 — OUTPUT: someone real consumes the result
  const consumer = contract.output_consumer;
  const consumerIsDeadEnd = consumer === UNKNOWN || consumer.trim() === "" || /^report|\.md$|\.txt$/i.test(consumer);
  if (consumerIsDeadEnd) {
    missing.push({ kind: "OUTPUT", detail: `OUTPUT_UNCONSUMED — "${consumer}" is not a real consumer. A report file nobody reads is a dead end, not an output.`, blocked_on: dependencyKey("consumer", contract.capability_root), required_input: null, required_resource: null, required_evidence: null, next_action: "name the capability, store, pipeline or stage that really receives this result" });
  } else {
    const consumerExists = existsSync(resolve(REPO_ROOT, consumer.split("#")[0]));
    if (!consumerExists) {
      missing.push({ kind: "OUTPUT", detail: `OUTPUT_UNCONSUMED — the declared consumer "${consumer}" does not exist on disk`, blocked_on: dependencyKey("consumer", consumer.split("#")[0]), required_input: null, required_resource: null, required_evidence: null, next_action: "point output_consumer at something that really exists" });
    } else {
      satisfied.push({ check: "output has a real consumer", evidence: `${consumer} -> ${contract.output_destination}` });
      advance("OUTPUT_CONNECTED");
    }
  }

  // 5 — ROUTING: the caller found above is the routing proof
  if (callerFound.found && inputConnected) {
    satisfied.push({ check: "routing exists: an event reaches this capability without a person invoking it", evidence: `${contract.input_source} -> ${callerFound.where} -> ${input.entry_symbol}` });
    advance("ROUTABLE");
  } else {
    missing.push({ kind: "ROUTING", detail: "ROUTING_MISSING — there is no path from a real event to this capability", blocked_on: dependencyKey("routing", contract.capability_root), required_input: null, required_resource: null, required_evidence: null, next_action: "register the capability with the existing router, or call it from the real trigger owner" });
  }

  // 6 — RUNTIME invocation
  if (contract.invocation_method === UNKNOWN || contract.invocation_method.trim() === "") {
    missing.push({ kind: "RUNTIME", detail: "no invocation method declared", blocked_on: dependencyKey("runtime", contract.capability_root), required_input: null, required_resource: null, required_evidence: null, next_action: "declare how a runtime invokes this" });
  } else {
    satisfied.push({ check: "an invocation method is declared", evidence: contract.invocation_method });
    advance("INVOKABLE");
  }

  // 7 — RUNTIME PROOF: it really ran
  if (input.runtime_invocation_evidence === null) {
    missing.push({ kind: "VERIFICATION", detail: "IMPLEMENTED_NOT_RUNTIME_PROVEN — tests are not a runtime path; nothing shows this capability was invoked by a real runtime", blocked_on: dependencyKey("runtime_evidence", contract.capability_root), required_input: null, required_resource: null, required_evidence: contract.runtime_proof, next_action: `produce the declared runtime proof: ${contract.runtime_proof}` });
  } else {
    satisfied.push({ check: "a real runtime invoked it", evidence: input.runtime_invocation_evidence });
    advance("RUNTIME_PROVEN");
  }

  // 8 — VERIFICATION really ran and really passed
  if (!input.verification.ran) {
    missing.push({ kind: "VERIFICATION", detail: "the declared verification was never run", blocked_on: dependencyKey("verification", contract.capability_root), required_input: null, required_resource: null, required_evidence: contract.verification_commands.join(" && "), next_action: `run: ${contract.verification_commands.join(" && ")}` });
  } else if (!input.verification.passed) {
    missing.push({ kind: "VERIFICATION", detail: `verification ran and FAILED: ${input.verification.detail}`, blocked_on: dependencyKey("verification", contract.capability_root), required_input: null, required_resource: null, required_evidence: null, next_action: "fix the failure; a failing verification never promotes" });
  } else {
    satisfied.push({ check: "the declared verification really ran and really passed", evidence: input.verification.detail });
  }

  const operational = missing.length === 0;
  if (operational) reached = "OPERATIONAL";

  // The reported state names the honest failure, not just "not finished".
  const state: CapabilityLifecycleState = operational
    ? "OPERATIONAL"
    : missing.some((m) => m.kind === "INPUT" || m.kind === "ROUTING")
      ? "IMPLEMENTED_NOT_REACHABLE"
      : missing.some((m) => m.detail.startsWith("IMPLEMENTED_NOT_RUNTIME_PROVEN"))
        ? "IMPLEMENTED_NOT_RUNTIME_PROVEN"
        : reached;

  return {
    capability_name: contract.capability_name,
    state, missing, satisfied,
    reason: operational
      ? "every connection is real and proven — OPERATIONAL"
      : `INCOMPLETE: ${missing.map((m) => m.kind).join(", ")} — highest state actually reached is ${reached}`,
  };
}

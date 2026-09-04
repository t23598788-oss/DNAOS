/**
 * หน้าที่: `runPreExecutionPlan()` — ทำความเข้าใจคำขอของ Owner แล้วเก็บบริบทที่
 * จำเป็นด้วยตัวเองก่อน จึงค่อยเลือกทรัพยากร (Owner, PHASE 2-5).
 *
 * ทุก step ที่ปรากฏบนหน้าจอเกิดจากการกระทำจริงที่นี่ และถูกบันทึกลงสโตร์ "ทันทีที่
 * มันเกิด" ไม่ใช่ตอนจบ — หน้าจอจึงเห็นความคืบหน้าจริง ไม่มี progress ปลอมสักตัว
 * ถ้าขั้นไหนไม่ได้ทำอะไรจริง มันจะไม่มี step
 *
 * การเลือกทรัพยากรไม่เคยอ่านชื่อ provider: มันถามว่า "งานนี้ต้องการความสามารถอะไร"
 * แล้วให้ทะเบียน + execution-profile ตอบว่าใครให้ได้ ชื่อที่โผล่บนจอมาจาก
 * presentation metadata ของทรัพยากรที่ถูกเลือกแล้วเท่านั้น
 *
 * รอบนี้ตัววางแผน "ไม่เรียก Agent" — มันเตรียมบริบทและชี้ว่าขั้นถัดไปคือใคร
 * การลงมือจริงยังเป็นของเส้นทางเดิม เพื่อไม่ให้ routing ที่ใช้งานอยู่เปลี่ยน
 *
 * Input: ข้อความของ Owner + command_id.
 * Output: `runPreExecutionPlan` -> `PreExecutionPlan`.
 * Dependency ที่อนุญาต: ./store.ts, ./types.ts, ./presentation.ts,
 * ../../software/execution-profile/contract.ts, node:crypto, node:fs, node:path.
 * สิ่งที่ห้ามแตะ: ห้ามสร้าง step ที่ไม่มีการกระทำจริง, ห้าม hardcode ชื่อ provider
 * ในการเลือก, ห้ามเรียก Agent จากไฟล์นี้.
 */

import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { latestProfiles, resolveAccountingRequirement } from "../../software/execution-profile/contract";
import { resolveResources } from "../../software/execution-profile/shadow-resolver";
import { listCapabilities as listRoutableCapabilities } from "../command-router/capability-registry";
import { iconForAction, presentationFor } from "./presentation";
import { savePlan } from "./store";
import type { CapabilityPlanEntry, PlanStep, PreExecutionPlan, ActionKind } from "./types";

const CANON = "software/registry-database/data/canonical";
const now = (): string => new Date().toISOString();

function readJsonl<T>(rel: string): readonly T[] {
  let text: string;
  try { text = readFileSync(join(process.cwd(), rel), "utf8"); } catch { return []; }
  const rows: T[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try { rows.push(JSON.parse(line) as T); } catch { /* ข้าม */ }
  }
  return rows;
}

/**
 * ตัวเขียนแผนแบบสะสม — บันทึกทุกครั้งที่ step เปลี่ยนสถานะ
 * นี่คือสิ่งที่ทำให้หน้าจอเห็นของจริงระหว่างทาง ไม่ใช่ตอนจบ
 */
class PlanWriter {
  private readonly steps: PlanStep[] = [];
  constructor(private plan: PreExecutionPlan) {}

  begin(action: ActionKind, headline: string, detail: Record<string, unknown> = {}, parent: string | null = null, iconKey?: string): PlanStep {
    const step: PlanStep = {
      step_id: `step-${randomUUID().slice(0, 8)}`,
      parent_step_id: parent,
      action, headline, status: "RUNNING",
      icon_key: iconKey ?? iconForAction(action),
      started_at: now(), ended_at: null, detail, blocked_reason: null,
    };
    this.steps.push(step);
    this.flush();
    return step;
  }

  finish(step: PlanStep, status: PlanStep["status"], detail: Record<string, unknown> = {}, blockedReason: string | null = null): void {
    const index = this.steps.findIndex((s) => s.step_id === step.step_id);
    if (index < 0) return;
    this.steps[index] = { ...this.steps[index]!, status, ended_at: now(), detail: { ...this.steps[index]!.detail, ...detail }, blocked_reason: blockedReason };
    if (status === "BLOCKED") this.plan = { ...this.plan, blocked_at_step_id: step.step_id };
    this.flush();
  }

  patch(patch: Partial<PreExecutionPlan>): void {
    this.plan = { ...this.plan, ...patch };
    this.flush();
  }

  done(): PreExecutionPlan {
    this.plan = { ...this.plan, running: false, updated_at: now() };
    this.flush();
    return this.current();
  }

  current(): PreExecutionPlan { return { ...this.plan, steps: [...this.steps], updated_at: now() }; }
  private flush(): void { savePlan(this.current()); }
}

/**
 * หาว่าคำขอนี้เกี่ยวกับ "ระบบ" ไหน โดยเทียบกับชื่อ capability ที่ทะเบียนมีจริง
 *
 * ไม่ใช่การเดาจากคำ: ผู้เข้าชิงทุกตัวคือ canonical_name ที่ลงทะเบียนไว้แล้ว
 * ถ้าไม่มีตัวไหนถูกเอ่ยถึงเลย ก็ตอบว่าไม่ทราบ ไม่ใช่เลือกตัวที่ใกล้ที่สุด
 */
/**
 * ระบุระบบที่คำสั่งพูดถึง
 *
 * เดิมเทียบเฉพาะ canonical_name ซึ่งเป็นภาษาอังกฤษล้วนทั้ง 124 ตัว คำสั่งที่
 * เจ้าของพิมพ์เป็นภาษาไทยจึงไม่มีทางตรงเลยแม้แต่คำเดียว — SUBJECT_RESOLUTION
 * จึง BLOCKED ทุกครั้งที่เจ้าของสั่งงานด้วยภาษาของตัวเอง
 *
 * ตอนนี้ใช้ match_keyword_sets ที่ command-router ประกาศไว้อยู่แล้วเป็นทางหลัก
 * — เป็นกลไกเดิมที่ออกแบบมาเพื่อการนี้ ไม่ได้สร้างการจับคู่ชุดใหม่ และไม่มี
 * การเดาความหมาย: capability ที่ไม่ประกาศคำไว้ ก็ยังจับคู่ไม่ได้ตามเดิม
 *
 * ทะเบียนถูกอ่านแบบแถวล่าสุดชนะ และนับเฉพาะที่ยัง REGISTERED — รายการที่ถูก
 * ถอนทะเบียน (RETIRED) ต้องไม่ถูกเสนอเป็นประธานของงาน
 */
function resolveSubject(text: string): { subject: string | null; matched: string[] } {
  const lower = text.toLocaleLowerCase();
  const matched: string[] = [];

  // 1. คำที่ capability ประกาศไว้เองว่ารับเรื่องอะไร — ชุดหนึ่งตรงต่อเมื่อ "ทุกคำ" ในชุดปรากฏ
  for (const cap of listRoutableCapabilities()) {
    for (const set of cap.match_keyword_sets) {
      if (set.length > 0 && set.every((k) => lower.includes(k.toLocaleLowerCase()))) {
        if (!matched.includes(cap.capability_id)) matched.push(cap.capability_id);
        break;
      }
    }
  }

  // 2. ชื่อ canonical ที่ถูกเอ่ยตรง ๆ — ยังใช้ได้สำหรับคำสั่งภาษาอังกฤษ
  const latest = new Map<string, { canonical_name?: string; status?: string }>();
  for (const row of readJsonl<{ capability_id?: string; canonical_name?: string; status?: string }>(`${CANON}/capabilities.jsonl`)) {
    if (typeof row.capability_id === "string") latest.set(row.capability_id, row);
  }
  const names: string[] = [];
  for (const row of latest.values()) {
    if (row.status !== "REGISTERED") continue;
    if (typeof row.canonical_name === "string" && row.canonical_name.length > 3) names.push(row.canonical_name);
  }
  for (const n of names.filter((n) => lower.includes(n.toLocaleLowerCase())).sort((a, b) => b.length - a.length)) {
    if (!matched.includes(n)) matched.push(n);
  }

  return { subject: matched[0] ?? null, matched };
}

/** ที่อยู่ของซอร์สที่ทะเบียนชี้ให้ สำหรับ capability ที่เกี่ยวข้อง */
function sourceLocationsFor(capabilityNames: readonly string[]): string[] {
  const capIds = new Set<string>();
  for (const row of readJsonl<{ capability_id: string; canonical_name?: string }>(`${CANON}/capabilities.jsonl`)) {
    if (row.canonical_name && capabilityNames.includes(row.canonical_name)) capIds.add(row.capability_id);
  }
  const resourceIds = new Set<string>();
  for (const row of readJsonl<{ resource_id: string; capability_id: string }>(`${CANON}/resource_capabilities.jsonl`)) {
    if (capIds.has(row.capability_id)) resourceIds.add(row.resource_id);
  }
  const locations = new Set<string>();
  for (const row of readJsonl<{ resource_id: string; source_location?: string | null }>(`${CANON}/resources.jsonl`)) {
    if (resourceIds.has(row.resource_id) && row.source_location) locations.add(row.source_location.replace(/\/+$/, ""));
  }
  return [...locations];
}

/**
 * ความสามารถที่งานนี้ต้องการ — อนุมานจากสิ่งที่ทะเบียนรู้ ไม่ใช่จากชื่อเครื่องมือ
 *
 * กฎ: ทุกคำขอต้องอ่านความรู้ของระบบก่อนเสมอ (`registry lookup`) และถ้าคำขอพูดถึง
 * การตรวจ/หาสาเหตุ จะต้องอ่านซอร์สด้วย ส่วนความสามารถเฉพาะเรื่อง (เช่นบัญชี)
 * มาจากคำประกาศความต้องการที่ execution-profile ถืออยู่แล้ว
 */
function deriveRequiredCapabilities(text: string, subject: string | null): { capability: string; why: string }[] {
  const lower = text.toLocaleLowerCase();
  const wanted: { capability: string; why: string }[] = [];
  const inspecting = /ทำไม|ตรวจ|หาสาเหตุ|ดูว่า|วิเคราะห์|why|inspect|analy/i.test(lower);
  if (inspecting) {
    wanted.push({ capability: "workspace_file_read", why: "คำขอเป็นการตรวจสอบ จึงต้องอ่านไฟล์ที่เกี่ยวข้องก่อน" });
    wanted.push({ capability: "source_analysis", why: "ต้องสรุปสิ่งที่อ่านได้ให้เป็นข้อสรุป" });
  }
  if (/บัญชี|accounting/i.test(lower)) {
    const requirement = resolveAccountingRequirement();
    wanted.push({ capability: requirement.required_capability, why: "งานบัญชีประกาศความต้องการนี้ไว้ใน execution-profile" });
  }
  if (/ทดสอบ|test/i.test(lower)) wanted.push({ capability: "test_execution", why: "คำขอระบุให้ทดสอบ" });
  if (/แก้ไข|เขียนไฟล์|modify|write/i.test(lower)) wanted.push({ capability: "workspace_file_write", why: "คำขอระบุให้แก้ไขไฟล์" });
  if (wanted.length === 0 && subject !== null) {
    wanted.push({ capability: "workspace_file_read", why: `คำขออ้างถึง "${subject}" จึงต้องอ่านของจริงก่อนตอบ` });
  }
  return wanted;
}

export async function runPreExecutionPlan(commandId: string, ownerText: string): Promise<PreExecutionPlan> {
  const base: PreExecutionPlan = {
    plan_id: `plan-${randomUUID()}`, command_id: commandId, owner_text: ownerText,
    subject: null, intent: null, target_system: null,
    known_context: [], required_information: [], capability_plan: [],
    required_dependencies: [], source_locations: [], evidence_requirements: [],
    verification_requirements: [], allowed_side_effects: [], steps: [],
    running: true, blocked_at_step_id: null, created_at: now(), updated_at: now(),
  };
  const w = new PlanWriter(base);

  // 1. รับคำสั่ง
  const received = w.begin("OWNER_REQUEST", "รับคำสั่งจากเจ้าของ", { text_length: ownerText.length });
  w.finish(received, "DONE");

  // 2. ระบุระบบที่เกี่ยวข้อง — เทียบกับชื่อที่ทะเบียนมีจริง
  const subjectStep = w.begin("SUBJECT_RESOLUTION", "กำลังระบุระบบที่เกี่ยวข้อง");
  const { subject, matched } = resolveSubject(ownerText);
  w.finish(subjectStep, subject ? "DONE" : "BLOCKED",
    { matched_registry_names: matched.slice(0, 5) },
    subject ? null : "ไม่มีชื่อความสามารถใดในทะเบียนที่ถูกเอ่ยถึงในคำขอนี้");
  w.patch({ subject, target_system: subject, intent: /ทำไม|why/i.test(ownerText) ? "DIAGNOSE" : "INSPECT" });

  // 3. อ่านความรู้ของระบบจากทะเบียน
  const knowledgeStep = w.begin("KNOWLEDGE_LOOKUP", "กำลังอ่านความรู้ของระบบจากทะเบียน", { source: `${CANON}/capabilities.jsonl` });
  const profiles = latestProfiles();
  w.finish(knowledgeStep, "DONE", { execution_resources_known: profiles.length });
  w.patch({ known_context: profiles.map((p) => `${String(p.resource_name.value)} (${p.capability_ids.length} capability)`) });

  // 4. วางแผนความสามารถที่ต้องใช้
  const capStep = w.begin("CAPABILITY_PLAN", "กำลังกำหนดความสามารถที่งานนี้ต้องใช้");
  const wanted = deriveRequiredCapabilities(ownerText, subject);
  w.finish(capStep, wanted.length > 0 ? "DONE" : "BLOCKED", { required: wanted.map((x) => x.capability) },
    wanted.length > 0 ? null : "ไม่สามารถระบุความสามารถที่ต้องใช้จากคำขอนี้ได้");

  // 5. หาที่อยู่ของซอร์สที่เกี่ยวข้อง
  const locations = sourceLocationsFor(matched.slice(0, 3));
  if (locations.length > 0) {
    const locStep = w.begin("SOURCE_LOCATION", `พบที่อยู่ของซอร์สที่เกี่ยวข้อง ${locations.length} แห่ง`, { locations });
    w.finish(locStep, "DONE");
    w.patch({ source_locations: locations });

    // 5a. เปิดโฟลเดอร์และอ่านรายชื่อไฟล์จริง — bounded ไม่สแกนทั้งรีโป
    for (const location of locations.slice(0, 2)) {
      const folderStep = w.begin("FOLDER_OPEN", `เปิดโฟลเดอร์ ${location}`, { location }, locStep.step_id);
      let files: string[] = [];
      try {
        files = readdirSync(join(process.cwd(), location))
          .filter((f) => statSync(join(process.cwd(), location, f)).isFile()).slice(0, 12);
        w.finish(folderStep, "DONE", { file_count: files.length });
      } catch (error) {
        w.finish(folderStep, "FAILED", {}, `เปิดไม่ได้: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      const target = files.find((f) => f === "contract.ts") ?? files[0];
      if (target) {
        const readStep = w.begin("FILE_READ", `อ่าน ${target}`, { file: join(location, target) }, folderStep.step_id);
        try {
          const bytes = readFileSync(join(process.cwd(), location, target), "utf8").length;
          w.finish(readStep, "DONE", { bytes });
        } catch (error) {
          w.finish(readStep, "FAILED", {}, String(error));
        }
      }
    }
  }

  // 6. เลือกทรัพยากรจากความสามารถ — ไม่ดูชื่อ provider
  const capabilityPlan: CapabilityPlanEntry[] = [];
  for (const want of wanted) {
    const resStep = w.begin("RESOURCE_RESOLUTION", `กำลังหาเครื่องมือสำหรับ "${want.capability}"`, { required_capability: want.capability });
    const outcome = resolveResources({ required_capabilities: [want.capability], requires_paid_service: false, needs_workspace: true });
    const pick = outcome.eligible[0] ?? outcome.unknown[0] ?? null;
    const verdict: CapabilityPlanEntry["selection_verdict"] =
      outcome.unprovided_capabilities.length > 0 ? "NO_PROVIDER"
        : outcome.eligible.length > 0 ? "ELIGIBLE"
          : outcome.unknown.length > 0 ? "UNKNOWN" : "NOT_ELIGIBLE";
    const presentation = pick ? presentationFor(pick.resource_id) : null;
    capabilityPlan.push({
      required_capability: want.capability, why: want.why,
      candidate_resource_ids: outcome.matching.map((m) => m.resource_id),
      selected_resource_id: pick?.resource_id ?? null,
      selection_verdict: verdict,
      reason: verdict === "NO_PROVIDER"
        ? `ยังไม่มีเครื่องมือที่ลงทะเบียนไว้ให้ความสามารถ "${want.capability}"`
        : pick?.eligibility.blocking_reason ?? "ผ่านทุกเงื่อนไข",
    });
    if (verdict === "NO_PROVIDER") {
      w.finish(resStep, "BLOCKED", { required_capability: want.capability },
        `ยังไม่มีเครื่องมือที่ลงทะเบียนและพร้อมใช้งานสำหรับ "${want.capability}"`);
    } else {
      w.finish(resStep, "DONE", {
        selected_resource_id: pick?.resource_id ?? null,
        display_name: presentation?.display_name ?? null,
        verdict, unresolved: pick?.eligibility.blocking_reason ?? null,
      });
      if (pick && presentation) {
        const invokeStep = w.begin("RESOURCE_INVOCATION", `ขั้นถัดไป: เรียก ${presentation.display_name}`,
          { resource_id: pick.resource_id, resource_category: presentation.resource_category, capability: want.capability },
          resStep.step_id, presentation.icon_key);
        // รอบนี้ตัววางแผนไม่ลงมือแทนเส้นทางเดิม — ประกาศว่าพร้อม ไม่แกล้งว่าทำแล้ว
        w.finish(invokeStep, "PLANNED", { note: "เตรียมบริบทครบแล้ว รอการลงมือจากเส้นทางเดิม" });
      }
    }
  }
  w.patch({
    capability_plan: capabilityPlan,
    required_information: wanted.map((x) => x.why),
    evidence_requirements: ["execution evidence ของทุกการเรียกทรัพยากร"],
    verification_requirements: ["ผลต้องกลับผ่านสัญญาผลลัพธ์เดิมและมี evidence id"],
    allowed_side_effects: capabilityPlan.some((c) => c.required_capability.includes("write")) ? ["เขียนไฟล์ในพื้นที่ทำงานที่แยกไว้"] : [],
  });

  return w.done();
}

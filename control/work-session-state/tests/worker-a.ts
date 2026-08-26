/**
 * หน้าที่: WORKER A of the hard-reset proof. Starts a real work item, completes
 * the steps that are really complete, writes a checkpoint, and EXITS. It is a
 * separate OS process on purpose — everything it knows dies with it.
 *
 * Input: argv[2] = work_id.
 * Output: stdout `SESSION=<id>` and `PID=<pid>`; a checkpoint on disk.
 * Dependency ที่อนุญาต: ../contract.ts only.
 * สิ่งที่ห้ามแตะ: ห้ามเขียนอะไรที่ worker B ต้องได้ยินนอกเหนือจาก checkpoint —
 * ถ้า worker B ต้องการช่องทางอื่น การพิสูจน์นี้ก็ไม่ได้พิสูจน์อะไร
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { appendCheckpoint, currentBranch, currentRevision, newSessionId } from "../contract";
import type { WorkStep } from "../contract";

const workId = process.argv[2];
if (!workId) { console.error("usage: worker-a.ts <work_id>"); process.exit(2); }

const repoRoot = process.cwd();
const digest = (p: string): string => createHash("sha256").update(readFileSync(resolve(repoRoot, p))).digest("hex");

const done = (step_id: string, title: string, path: string, depends_on: string[] = []): WorkStep => ({
  step_id, title, state: "COMPLETED", phase: "PERSISTENT_WORK_STATE", depends_on,
  affected_paths: [path], evidence_refs: [path],
  verification: { kind: "FILE_DIGEST", path, sha256: digest(path) },
  completed_at_revision: currentRevision(repoRoot), completed_at: new Date().toISOString(),
});

const pending = (step_id: string, title: string, depends_on: string[], paths: string[], evidence: string[]): WorkStep => ({
  step_id, title, state: "PENDING", phase: "PERSISTENT_WORK_STATE", depends_on,
  affected_paths: paths, evidence_refs: evidence, verification: null,
  completed_at_revision: null, completed_at: null,
});

const sessionId = newSessionId();
const checkpoint = appendCheckpoint({
  work_id: workId,
  owner_intent_id: "owner-intent:CLOSE_ARCHITECTURE_DEBT_AND_PERSIST_WORK_STATE",
  task_id: null,
  session_id: sessionId,
  execution_id: `exec-a-${process.pid}`,
  worker_identity: "worker-a",
  repository: "DNA-OS-INFRASTRUCTURE",
  branch: currentBranch(repoRoot),
  affected_resource_ids: ["capability:control/work-session-state"],
  affected_paths: ["control/work-session-state"],
  objective: "ทำให้สถานะงานเป็นของ DNA OS เอง ไม่ผูกกับ memory ของ AI/Agent",
  current_phase: "PERSISTENT_WORK_STATE",
  steps: [
    done("s1-types", "ประกาศ contract ของ checkpoint/resume/ownership", "control/work-session-state/types.ts"),
    done("s2-store", "journal แบบ append-only + reduce เป็นสถานะปัจจุบัน", "control/work-session-state/store.ts", ["s1-types"]),
    done("s3-resume", "resume engine ที่ตรวจ step ที่อ้างว่าเสร็จซ้ำจากของจริง", "control/work-session-state/resume.ts", ["s2-store"]),
    done("s4-ownership", "ตอบว่า path หนึ่งเป็นของงานไหน หรือ UNKNOWN", "control/work-session-state/ownership.ts", ["s2-store"]),
    pending("s5-graph-proof", "พิสูจน์ว่า derived graph โผล่ work state จาก journal จริง", ["s3-resume"],
      ["dna-os-circuit/runtime/derived-graph.ts"], ["dna-os-circuit/runtime/derived-graph.ts#buildSystemGraph"]),
    pending("s6-regression", "รัน regression ทั้งชุดแล้วบันทึกผล", ["s5-graph-proof"], [], []),
  ],
  blockers: [],
  decisions_required: [],
  evidence_refs: ["control/work-session-state/tests/hard-reset-resume-proof.ts"],
  source_revision: currentRevision(repoRoot),
  last_verified_revision: currentRevision(repoRoot),
  next_action: "s5-graph-proof",
  do_not_repeat: [
    "s1-types..s4-ownership เขียนและตรวจแล้ว — worker ตัวถัดไปห้ามเขียนไฟล์ทั้งสี่ใหม่ ให้ตรวจ digest ที่บันทึกไว้แทน",
    "ห้ามสร้าง task system ตัวที่สอง — control/work-coordination ยังเป็นเจ้าของสถานะ task",
  ],
  ui_context: {
    service_id: "dna-os-circuit",
    url: "http://127.0.0.1:5180/system-graph?live=0",
    route: "/system-graph",
    scope: workId,
  },
  last_durable_event: [],
  sync_state: "SYNCED",
  status: "ACTIVE",
  started_at: new Date().toISOString(),
});

console.log(`SESSION=${sessionId}`);
console.log(`PID=${process.pid}`);
console.log(`CHECKPOINT=${checkpoint.checkpoint_id}`);

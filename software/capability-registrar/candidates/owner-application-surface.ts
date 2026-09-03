/**
 * หน้าที่: ให้ "แอปที่ Owner ใช้จริง" มีตัวตนใน canonical registry เป็นครั้งแรก
 * (Owner, 2026-09-02).
 *
 * ช่องว่างที่ปิด. owner-backbone แก้คำสั่งของ Owner โดย resolve จากชื่อ target.
 * เมื่อ Owner สั่งงานที่ target = "control-workspace" ผลที่วัดได้จริงคือ
 * resource_ids ["control-workspace"] แต่ capability_ids [] แล้วจบที่
 * WORK_BLOCKED / DISPATCH_FAILED — ไม่ใช่เพราะคำสั่งผิด แต่เพราะแอปที่ Owner
 * มองเห็นทุกวันไม่เคยมี capability เป็นของตัวเอง.
 *
 * ทำไมไม่ใช่ของซ้ำ. มี capability สองตัวที่ชี้ไปที่ repo เดียวกันอยู่แล้ว —
 * control-workspace-resilience (พฤติกรรมตอน backend ล่ม) และ
 * computer-use-settings-surface (จอตั้งค่าจอเดียว). ทั้งคู่เป็น "ความสามารถ
 * ภายในแอป" ไม่ใช่ "ตัวแอป" ไม่มีตัวไหนมี runtime identity, entrypoint หรือ
 * launchd label และไม่มีตัวไหนที่ owner-backbone จะ resolve เจอจากชื่อ
 * control-workspace. ตัวนี้คือ Owner Application เอง — shell, navigation,
 * ช่องรับคำสั่ง และ proxy ไป Core. Duplicate Gate ของ pipeline เป็นผู้ตัดสิน
 * ไม่ใช่ไฟล์นี้.
 *
 * Input: none (ค่าคงที่ค่าเดียว).
 * Output: `OWNER_APPLICATION_SURFACE_CANDIDATE`.
 * Dependency ที่อนุญาต: registration-contract (type เท่านั้น).
 * สิ่งที่ห้ามแตะ: ห้ามใส่ evidence_refs ที่อ้างการรันที่ไม่ได้เกิดขึ้นจริง.
 */

import type { RegistrationCandidate } from "../../../control/event-pipeline/registration-contract";

export const OWNER_APPLICATION_SURFACE_CANDIDATE: RegistrationCandidate = {
  candidate_id: "candidate-owner-application-surface-v1",
  name: "control-workspace",
  kind: "capability",
  source_location: "~/Desktop/dna-os-control-workspace/ (app/, features/, server/server.mjs, core-connection/)",
  owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/owner-application-surface.ts",

  input: [
    "Owner interaction on the real screen — pointer and keyboard events delivered to the app window",
    "HTTP requests from the Owner's browser to 127.0.0.1:5181",
  ],
  output: [
    "the Owner-visible application shell: navigation, workspace stage, command surface",
    "GET /api/health — PROCESS_RUNNING, PORT_LISTENING, HTTP_HEALTHY, UI_READY, SERVICE_MANAGER",
    "GET /api/core/status — measured reachability of each declared Core endpoint",
    "POST /api/core/command -> Core POST /owner/command; the ACK is returned to the same surface",
    "GET /api/core/command/:id, /api/core/work/:id, /api/core/incident/:id — read models returned to the same surface",
  ],
  side_effects: [
    "writes data/workspace-snapshot.json and data/outbound-retry-queue.jsonl inside its own product directory",
    "forwards Owner commands to transport/owner-command-http; it never executes an Owner command itself",
  ],
  dependencies: [
    "transport/owner-command-http (Core, 127.0.0.1:8791) — command ingress and every read model",
    "observability/joint-monitor (127.0.0.1:5178) — joint/violation stream",
    "launchd com.dnaos.control-workspace — the only supervisor of this process",
  ],

  behavior:
    "present_one_owner_surface_and_route_owner_commands_to_core_without_owning_execution: serves the Owner application shell on 127.0.0.1:5181 under launchd, renders navigation and the command surface before any backend call, and proxies every Core interaction through a single adapter boundary (server/core-endpoints.mjs) so the browser never learns where Core is and never holds a credential. It owns no execution authority: an Owner command is persisted and acknowledged by Core, and the surface displays whatever Core returns — including WORK_BLOCKED — without interpreting or improving it. Backend failure is displayed inside the application rather than replacing it.",

  version: "1.0.0",

  evidence_refs: [
    "launchctl list -> com.dnaos.control-workspace, pid 51011, last_exit -15 (measured 2026-09-02)",
    "~/Library/LaunchAgents/com.dnaos.control-workspace.plist",
    "control/runtime-control/host-runtime.ts -> service_id control-workspace, port 5181, health_path /api/health, depends_on [joint-monitor, compute-api]",
    "lsof -nP -iTCP:5181 -sTCP:LISTEN -> node pid 51011 127.0.0.1:5181 (measured 2026-09-02)",
    "GET http://127.0.0.1:5181/ -> HTTP 200, <title>DNA OS Control Workspace</title>, 2370 bytes",
    "GET http://127.0.0.1:5181/api/health -> PROCESS_RUNNING YES, PORT_LISTENING YES, UI_READY YES, SERVICE_MANAGER launchd",
    "GET http://127.0.0.1:5181/api/core/status -> overall CONNECTED against core_url http://127.0.0.1:8791",
    "module graph walk from /app/main.mjs -> 57 modules, all HTTP 200 (measured 2026-09-02, three consecutive runs)",
    "POST http://127.0.0.1:5181/api/core/command -> ocmd-0c207380-7a3c-47d2-b23c-4320e1207f84 / work-cf9dfa89-a7b2-4a7e-bb19-92e5440ed83d, status RECEIVED, persisted true",
    "GET http://127.0.0.1:5181/api/core/work/work-cf9dfa89-... -> WORK_BLOCKED / DISPATCH_FAILED with capability_ids [] — the measured gap this registration closes",
    "Computer Use through the canonical WorkOrder path physically operated this application: double_click on pid 61849 moved its published state clicks 0->2, dbls 0->1, af=DIV (evidence execution-evidence.jsonl, 2026-09-02)",
    "~/Desktop/dna-os-control-workspace/server/core-endpoints.mjs — the single place that knows where Core is",
  ],

  domain: "SOFTWARE_CONTROL_PLANE",
  resource_type: "CAPABILITY",
  data_classification: "INTERNAL",
  source_system: "dna-os-control-workspace",
  scope: "product/owner-application-surface",

  origin: {
    origin_kind: "OWNER_DIRECTIVE",
    origin_reference: "TASK:DNA_OS_SELF_CONTROL_AND_SINGLE_APPLICATION_CONSOLIDATION",
    introduced_by: "software/capability-registrar/register-owner-application-surface.ts",
  },
};

/**
 * หน้าที่: the single registry of every destination `../router.ts` may
 * route an Owner command to — mirrors `ai/agent-registry/` and
 * `software/repository-registry/`'s own "registry = data, one row per
 * registered thing" pattern (both still NOT_YET_BUILT source, so this is
 * the first real registry file of that shape in this repo).
 *
 * CONNECTED means: a real, verified, callable contract/adapter file
 * exists in THIS repo today (checked by reading the file, not assumed).
 * NOT_CONNECTED means: the target repo/system is not present in this
 * checkout, or no real callable surface exists yet — reported honestly
 * rather than faked. See ../ARCHITECTURE_DECISIONS.md for the verification
 * evidence behind each entry below.
 *
 * Input: none (module-level constant).
 * Output: `CAPABILITY_REGISTRY`, `listCapabilities`, `getCapability`.
 * Dependency ที่อนุญาต: ./types.ts.
 * สิ่งที่ห้ามแตะ: never set `health_status: "CONNECTED"` for an entry
 * whose `endpoint.kind` is `"not_yet_built"` — the two must always agree.
 * Never add a `repo_id` for DNA-LAB-FILE-INTELLIGENCE,
 * DNA-LAB-PERMISSION-REASONER, or a research engine that points at a real
 * local path — those repos are not present in this checkout.
 */

import type { CapabilityRegistration } from "./types";

export const CAPABILITY_REGISTRY: Readonly<Record<string, CapabilityRegistration>> = {
  "file-intelligence": {
    capability_id: "file-intelligence",
    repo_id: "DNA-LAB-FILE-INTELLIGENCE",
    contract: "not_yet_built",
    endpoint: { kind: "not_yet_built" },
    supported_commands: ["file-intelligence.audit", "file-intelligence.repo_scan"],
    match_keyword_sets: [
      ["ตรวจ", "repo"],
      ["audit", "repo"],
    ],
    permission_requirement: "none",
    health_status: "NOT_CONNECTED",
  },

  "permission-reasoner": {
    capability_id: "permission-reasoner",
    repo_id: "DNA-OS-INFRASTRUCTURE", // local module, NOT the external DNA-LAB-PERMISSION-REASONER repo — see ../ARCHITECTURE_DECISIONS.md §PERMISSION_REASONER
    contract: "permissions/execution-policy/contract.ts",
    endpoint: { kind: "contract", module: "permissions/execution-policy/contract.ts", entry: "evaluateExecutionPermission" },
    supported_commands: ["permission-reasoner.evaluate"],
    match_keyword_sets: [["ตรวจ", "permission"], ["permission"]],
    permission_requirement: "none",
    health_status: "CONNECTED",
  },

  "research-engine": {
    capability_id: "research-engine",
    repo_id: "DNA-OS-INFRASTRUCTURE", // local adapter (connections/research-engine/) that calls the real external HTTP service — NOT a co-located copy of DNA-LAB-PERMISSION-REASONER's Research & Evaluation Engine, which is not present in this checkout. Same pattern permission-reasoner already uses above.
    contract: "connections/research-engine/adapter-contract.ts",
    endpoint: { kind: "adapter", module: "connections/research-engine/research-engine-adapter.ts", entry: "fetchResearchEngineLatestResult" },
    supported_commands: ["research-engine.latest_results"],
    match_keyword_sets: [
      ["ผลทดลอง", "โมเดล"],
      ["research", "results"],
    ],
    permission_requirement: "none",
    // CONNECTED here means "a real adapter exists and is wired" (static, checked by reading the file — same convention as github/execution above), NOT "http://localhost:8787 is reachable right now."
    // Live reachability is a per-request fact, not a registration-time one: ../router.ts's runResearchEngineStep calls
    // connections/research-engine/research-engine-adapter.ts's own health check before every read and reports BLOCKED +
    // RESEARCH_ENGINE_OFFLINE when the real service is down, even though this static field still says CONNECTED.
    // See ../ARCHITECTURE_DECISIONS.md §RESEARCH_ENGINE.
    // Human UI (2026-08-22, "FIX RESEARCH API NAVIGATION"): the human-facing
    // entry point for this same capability is http://localhost:5177/
    // (DNA-LAB-PERMISSION-REASONER's Engineering Research Monitor UI, not
    // this repo — see current-capability-map.json's "human_ui" field for
    // the full reconciliation note). No new capability_id was created for
    // it — it's the same research-engine data path, browser-facing.
    health_status: "CONNECTED",
  },

  execution: {
    capability_id: "execution",
    repo_id: "DNA-OS-INFRASTRUCTURE",
    contract: "execution/run/contract.ts",
    endpoint: { kind: "contract", module: "execution/run/contract.ts", entry: "startExecution" },
    supported_commands: ["execution.run"],
    match_keyword_sets: [
      ["รัน", "อนุญาต"],
      ["execute"],
    ],
    permission_requirement: "execution-policy",
    health_status: "CONNECTED",
  },

  github: {
    capability_id: "github",
    repo_id: "DNA-OS-INFRASTRUCTURE",
    contract: "connections/github/adapter-contract.ts",
    endpoint: { kind: "adapter", module: "connections/github/github-adapter.ts", entry: "handleGithubCommand" },
    supported_commands: ["connector.github.check_access", "connector.github.read_status"],
    match_keyword_sets: [["github"], ["อ่าน", "repo"]],
    permission_requirement: "none", // github-adapter.ts enforces its own account-scope check internally
    health_status: "CONNECTED",
  },

  // Registered 2026-08-17 (Owner: "attach completed DigitalOcean branch to the live tree").
  // UPDATED 2026-08-22 (Owner correction — "FIX THE EXISTING ROUTER GAP"): the DI gap this
  // comment used to document is now fixed generically. connections/digitalocean/router-invoker.ts
  // closes handleDigitalOceanReadCommand over real (honest, currently-always-negative)
  // production providers — see that file's own header and ../connector-execution-boundary/'s
  // README — and control/connector-execution-boundary/registry.ts registers it under this exact
  // capability_id. `endpoint.kind: "connector"` routes through that generic boundary
  // (../router.ts's runConnectorStep), never invoked by name here. health_status flips to
  // CONNECTED because the call path is now genuinely real end-to-end: with no credential
  // registry/Vault yet built, every real call correctly resolves auth_required=true (mapped to
  // BLOCKED + an AUTH_REQUIRED-labeled summary/evidence by the router) — never a fake success.
  // Registered 2026-08-19 (Owner Phase 1: "ลงทะเบียน dna-os-circuit เข้า capability registrar
  // โดยต้องใช้ mechanism เดิม ห้ามสร้าง registrar ใหม่"). contract points at the real, tested
  // dna-os-circuit/definition/semantic-model.ts (7/7 in tests/semantic-model.test.ts). Not
  // routable by ../router.ts's runStep switch (dna-os-circuit is a read/view capability, never
  // an Owner-text-command target) — supported_commands/match_keyword_sets are honestly empty,
  // same "CONNECTED but no router wiring implemented" fallback every other unwired-but-real
  // capability already falls back to.
  "dna-os-circuit": {
    capability_id: "dna-os-circuit",
    repo_id: "DNA-OS-INFRASTRUCTURE",
    contract: "dna-os-circuit/definition/semantic-model.ts",
    endpoint: { kind: "contract", module: "dna-os-circuit/definition/semantic-model.ts", entry: "buildSemanticComponents" },
    supported_commands: [],
    match_keyword_sets: [],
    permission_requirement: "none",
    health_status: "CONNECTED",
  },

  // Registered 2026-08-20 (Owner: "Command -> Work Order -> Policy -> Dispatcher -> Worker",
  // Coding Agent to be added LATER as one Worker, never wired directly to a UI/command path).
  // `dispatcher` routes a step to control/agent-gateway/contract.ts's real submitTask — Phase
  // 23's Task/Evidence/Status pipeline (RECEIVED -> ROUTING -> POLICY_CHECK ->
  // WAITING_OWNER_DECISION -> EXECUTING -> VERIFYING -> COMPLETED/FAILED/BLOCKED), file-backed,
  // already tested. A submitted Task IS the Work Order this line names — no second Work Order
  // type was created. Workers today are only the two real AgentAdapters that already exist
  // (file-intelligence-adapter, external-provider-adapter, see ../agent-gateway/adapters/) — a
  // future Coding Agent adapter is added to that same array later, never given a direct route
  // of its own.
  dispatcher: {
    capability_id: "dispatcher",
    repo_id: "DNA-OS-INFRASTRUCTURE",
    contract: "control/agent-gateway/contract.ts",
    endpoint: { kind: "contract", module: "control/agent-gateway/contract.ts", entry: "submitTask" },
    supported_commands: ["dispatcher.submit_task"],
    match_keyword_sets: [["มอบหมาย", "งาน"], ["dispatch"], ["worker"]],
    permission_requirement: "none", // agent-gateway enforces its own write-gate policy check internally, same pattern as github/digitalocean above
    health_status: "CONNECTED",
  },

  "os-login": {
    capability_id: "os-login",
    repo_id: "DNA-OS-INFRASTRUCTURE",
    contract: "connections/os-login/adapter-contract.ts",
    endpoint: { kind: "adapter", module: "connections/os-login/adapter-contract.ts", entry: "requestOsLogin" },
    supported_commands: ["os-login.status", "os-login.request_access"],
    match_keyword_sets: [["ตรวจสถานะ", "firewall"], ["ตรวจสอบ", "firewall"], ["ขอสิทธิ์", "firewall"], ["ตรวจสถานะ", "tailscale"], ["ตรวจสอบ", "tailscale"], ["ขอสิทธิ์", "tailscale"], ["ขอสิทธิ์", "macos"]],
    permission_requirement: "none",
    health_status: "CONNECTED",
  },

  "os-ui": {
    capability_id: "os-ui",
    repo_id: "DNA-OS-INFRASTRUCTURE",
    contract: "connections/os-ui/adapter-contract.ts",
    endpoint: { kind: "adapter", module: "connections/os-ui/adapter-contract.ts", entry: "openOsUi" },
    supported_commands: ["os-ui.open", "os-ui.work-order"],
    match_keyword_sets: [["เปิด", "vs code"], ["เปิด", "vscode"], ["เปิด", "chrome"], ["เปิด", "dna os"], ["เปิด", "deadboard"], ["เปิด", "firewall"], ["เปิด", "ไฟร์วอลล์"], ["เปิด", "infrastructure"], ["เปิด", "โครงสร้าง"], ["เปิด", "terminal"], ["เปิด", "เทอร์มินัล"], ["ปลุก", "จอ"], ["wake", "display"]],
    permission_requirement: "none",
    health_status: "CONNECTED",
  },

  // Registered 2026-08-20 (Owner: Claude Voice Bridge, TTS-only, no
  // microphone). This capability is the ONE real approval gate —
  // control/agent-gateway/voice-bridge.ts's setVoiceBridgeEnabled defaults
  // OFF and is only ever flipped by a real, authenticated Owner command
  // reaching this step (never a hardcoded default-on, never a caller-local
  // toggle). Auto-announcement itself still goes through the real dispatcher
  // -> speak Work Order path (../agent-gateway/voice-bridge.ts calls
  // connections/os-ui/adapter-contract.ts's runUiWorkOrder, same
  // admission/audit as any other speak call) — this registry entry only
  // owns turning that sweep on/off, not the speaking itself.
  "voice-bridge": {
    capability_id: "voice-bridge",
    repo_id: "DNA-OS-INFRASTRUCTURE",
    contract: "control/agent-gateway/contract.ts",
    endpoint: { kind: "contract", module: "control/agent-gateway/contract.ts", entry: "setVoiceBridgeEnabled" },
    supported_commands: ["voice-bridge.enable", "voice-bridge.disable", "voice-bridge.status"],
    match_keyword_sets: [["เปิดเสียงพูด"], ["ปิดเสียงพูด"], ["enable", "voice"], ["disable", "voice"], ["สถานะ", "เสียงพูด"], ["voice", "bridge", "status"]],
    permission_requirement: "none", // the enable/disable action itself IS the approval event — recorded as evidence, matches os-login's own "no separate permission-reasoner hop" pattern
    health_status: "CONNECTED",
  },

  digitalocean: {
    capability_id: "digitalocean",
    repo_id: "DNA-OS-INFRASTRUCTURE",
    contract: "connections/digitalocean/adapter-contract.ts",
    endpoint: { kind: "connector", module: "connections/digitalocean/router-invoker.ts", entry: "invokeDigitalOceanConnector" },
    supported_commands: ["digitalocean.account.read", "digitalocean.regions.list", "digitalocean.sizes.list", "digitalocean.droplets.list", "digitalocean.billing.read"],
    match_keyword_sets: [["digitalocean"], ["digital", "ocean"]],
    permission_requirement: "none", // connections/digitalocean/authorization.ts enforces its own binding-status + scope checks internally, same pattern as github
    health_status: "CONNECTED",
  },
};

export function listCapabilities(): readonly CapabilityRegistration[] {
  return Object.values(CAPABILITY_REGISTRY);
}

export function getCapability(capabilityId: string): CapabilityRegistration | undefined {
  return CAPABILITY_REGISTRY[capabilityId];
}

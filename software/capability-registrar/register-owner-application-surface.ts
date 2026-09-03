/**
 * หน้าที่: ส่ง `./candidates/owner-application-surface.ts` เข้า Registration
 * Pipeline เดิม แล้วผูก runtime identity ให้ Owner Application ด้วย
 * declareRuntimeTarget เดิม — ไม่มี stage ใหม่ ไม่เขียนไฟล์เอง
 *
 * Usage: npx tsx software/capability-registrar/register-owner-application-surface.ts
 */
import { runRegistrationPipeline } from "../../control/registration-pipeline/contract";
import { declareRuntimeTarget } from "../../control/machine-observation/runtime-target";
import { createPersistentFileStore } from "../registry-database/adapters/persistent-file-store";
import { findCapability } from "../registry-database/contract";
import { OWNER_APPLICATION_SURFACE_CANDIDATE as C } from "./candidates/owner-application-surface";

function main(): number {
  const store = createPersistentFileStore();
  const existing = findCapability({ canonical_name: C.name }, store);
  console.log("=".repeat(78));
  console.log("REGISTRATION PIPELINE — owner application surface (control-workspace)");
  console.log("=".repeat(78));
  console.log(`  pre-existing lookup : ${existing ? `${existing.capability_id} status=${existing.status}` : "NOT FOUND — no capability named control-workspace"}`);

  const result = runRegistrationPipeline(C, store, "register-owner-application-surface-cli");
  console.log(`  STATUS        : ${result.status}`);
  let capabilityId: string | null = null;
  if (result.status === "REGISTERED") {
    capabilityId = result.capability_id;
    console.log(`  resource_id   : ${result.resource_id}`);
    console.log(`  capability_id : ${result.capability_id}`);
  } else if (result.status === "DUPLICATE") {
    console.log(`  reason_code   : ${result.reason_code}`);
    console.log(`  duplicate_of  : ${JSON.stringify(result.duplicate_of)}`);
  } else {
    console.log(`  failed_stage  : ${"failed_stage" in result ? result.failed_stage : "-"}`);
    console.log(`  reason_code   : ${"reason_code" in result ? result.reason_code : "-"}`);
  }

  const lookup = findCapability({ canonical_name: C.name }, store);
  console.log(`  lookup back   : ${lookup ? `${lookup.capability_id} status=${lookup.status}` : "NOT FOUND"}`);

  // RUNTIME IDENTITY — the half that makes the canonical record answerable about
  // a running machine. Without it a capability can be found but never observed.
  const id = capabilityId ?? lookup?.capability_id ?? null;
  if (id) {
    const rt = declareRuntimeTarget({
      capability_id: id,
      canonical_name: C.name,
      process: { launchd_label: "com.dnaos.control-workspace", argv_contains: "server/server.mjs" },
      network: { host: "127.0.0.1", port: 5181 },
      health: { path: "/api/health", expected_status: 200 },
      evidence_refs: [
        "launchctl list -> com.dnaos.control-workspace pid 51011 (measured 2026-09-02)",
        "lsof -nP -iTCP:5181 -sTCP:LISTEN -> node pid 51011 127.0.0.1:5181",
        "curl http://127.0.0.1:5181/api/health -> HTTP 200 (measured 2026-09-02)",
        "control/runtime-control/host-runtime.ts service_id=control-workspace port=5181 health_path=/api/health",
      ],
    });
    console.log(`  runtime target: ${rt.ok ? `${rt.target.runtime_target_id} authority=${rt.target.authority}` : `NOT DECLARED — ${rt.reason_code}: ${rt.detail}`}`);
  }
  return result.status === "REGISTERED" || result.status === "DUPLICATE" ? 0 : 1;
}
process.exit(main());

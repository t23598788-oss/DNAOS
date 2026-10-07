/**
 * หน้าที่: submit ./candidates/runtime-revision-reporting.ts through the
 * existing registration pipeline — Candidate -> Validation -> Classification
 * -> Duplicate Gate -> Repository Resolution -> Registry Writer -> the same
 * canonical persistent store every other registration uses. No new registry,
 * no new pipeline, no direct write.
 * Input: none.  Output: exit code + printed pipeline result.
 * Dependency ที่อนุญาต: control/registration-pipeline/contract,
 * ../registry-database/adapters/persistent-file-store, ./candidates/runtime-revision-reporting.
 * สิ่งที่ห้ามแตะ: ห้ามเขียนลง canonical store ตรง ๆ เลี่ยง pipeline.
 * Usage: npx tsx software/capability-registrar/register-runtime-revision.ts
 */
import { runRegistrationPipeline } from "../../control/registration-pipeline/contract";
import { createPersistentFileStore } from "../registry-database/adapters/persistent-file-store";
import { RUNTIME_REVISION_CANDIDATE } from "./candidates/runtime-revision-reporting";

const store = createPersistentFileStore();
const result = runRegistrationPipeline(RUNTIME_REVISION_CANDIDATE, store, "register-runtime-revision-cli");
console.log("STATUS      :", result.status);
if (result.status === "REGISTERED") {
  console.log("capability_id:", result.capability_id);
  console.log("resource_id  :", result.resource_id);
} else {
  console.log(JSON.stringify(result).slice(0, 400));
}

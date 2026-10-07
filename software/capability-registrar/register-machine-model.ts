/**
 * ลงทะเบียน `control/machine-model/` ผ่านท่อเดิม: Candidate -> Duplicate Gate ->
 * Repository Resolution -> Registry Writer
 *
 * ไม่มีการเขียนทะเบียนตรง ๆ ที่นี่ ทุกอย่างผ่าน `runRegistrationPipeline` ตัวเดียว
 * ที่ทุก candidate ก่อนหน้านี้ใช้
 */
import { randomUUID } from "node:crypto";
import { MACHINE_MODEL_CANDIDATE } from "./candidates/machine-model";
import { runRegistrationPipeline } from "../../control/registration-pipeline/contract";
import { createPersistentFileStore } from "../registry-database/adapters/persistent-file-store";

const store = createPersistentFileStore() as never;
const result = runRegistrationPipeline(MACHINE_MODEL_CANDIDATE, store, `register-machine-model-${randomUUID()}`);
console.log(JSON.stringify(result, null, 1));

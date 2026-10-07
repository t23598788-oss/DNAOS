# control/external-system-lifecycle/

**หน้าที่:** pipeline กลางเพียงหนึ่งเดียวสำหรับทุก Model / Model Family /
Provider / External System / capability ใหม่ในระบบ — ห้ามมี lifecycle
pipeline แยกตามค่าย (AWS/GitHub/Vercel/Supabase/AI provider ฯลฯ ทุกตัวใช้
pipeline นี้ตัวเดียวกัน ผ่าน evidence/adapter ของตัวเองเท่านั้น)

```
DISCOVER -> CLASSIFY -> DUPLICATE_CHECK -> BOUNDARY_REPO_DECISION
  -> BUILD -> TEST -> VERIFY -> REGISTRATION_PIPELINE -> REGISTRY_WRITER
  -> RELATIONSHIP -> INTEGRATION -> TARGET_RESOLUTION -> PERMISSION_ADMISSION
  -> DEPLOY_INSTALL -> RUNTIME_VERIFY -> COMPLETE
```

**REGISTERED ≠ COMPLETE**: REGISTRY_WRITER ผ่าน (แถวลง
`../../software/registry-database/` แล้ว) ไม่ได้แปลว่างานเสร็จ —
`is_complete` เป็น `true` เฉพาะเมื่อ RUNTIME_VERIFY ผ่านจริงเท่านั้น

**Reuse ทั้งหมด ไม่มี implementation ซ้ำ** (Duplicate/Overlap Discovery
ทำก่อนทุกครั้ง ตาม CAPABILITY_FOLDER_LAW ข้อ 4/5):
- CLASSIFY/DUPLICATE_CHECK/REGISTRATION_PIPELINE/REGISTRY_WRITER →
  `../registration-pipeline/contract.ts`'s `runRegistrationPipeline` ตรงๆ
- RELATIONSHIP → `../registration-update/contract.ts`'s `ADD_RELATIONSHIP` ตรงๆ
- TARGET_RESOLUTION → `../target-resolution/contract.ts`'s `resolveTarget`
  ตรงๆ (ของเดิม ไม่สร้างใหม่ — resolve resource_type=CAPABILITY →
  destination_class=CAPABILITY_GRAPH → RESOLVED/REGISTRY_ROW เสมอ)
- PERMISSION_ADMISSION → `../permission-policy-resolution/contract.ts`'s
  `resolvePolicy` + `../admission/contract.ts`'s `evaluateAdmission` ตรงๆ
  ผ่าน real Task จาก `../agent-gateway/contract.ts`'s `submitTask`/
  `recordHandoff` (ไม่ fabricate task/worker context)
- DEPLOY_INSTALL → `../../execution/deploy/contract.ts`'s
  `resolveDeployPlan` (Round 1 plan/gate layer เท่านั้น จริง ไม่ fake)
- INTEGRATION/RUNTIME_VERIFY = capability ใหม่ 2 ตัวที่สร้างรอบนี้เพราะยัง
  ไม่มีจริงในระบบ (`../integration-verification/`,
  `../runtime-verification/`) — ผ่าน Duplicate Gate แล้วว่าไม่มีตัวเดิมทำ
  หน้าที่นี้อยู่

**Delivery classification ไม่ใช่ capability แยก**: `./delivery-classification.ts`
เป็น glue ภายในโฟลเดอร์นี้เท่านั้น (ไม่ export ผ่าน `./contract.ts`) —
ตอบคำถามคนละข้อกับ `../target-resolution/` (ซึ่งตอบว่า "artifact นี้เอง
ควรถูกเก็บ/อ้างอิงที่ไหนในระบบ" ตาม resource_type) เรื่องนี้ตอบว่า
"capability นี้รันจริงอยู่ที่ไหนตอน runtime" (evidence-driven) — เดิมเคย
เป็น capability แยก (`control/delivery-target-resolution/`) ถูกยุบรวมเข้า
มาที่นี่หลัง Duplicate/Overlap Discovery รอบใหม่ (2026-08-21) เพราะมันเป็น
แค่ routing input ของ DEPLOY_INSTALL stage เดียว ไม่มี consumer อื่น

**Persistent state**: `./store.ts`'s `LifecycleEventStore` เขียน event
แบบ append-only ลง `./data/lifecycle-events.jsonl` จริง —
`getLifecycleRun(candidate_id)` rebuild สถานะปัจจุบันจากการ replay log
เสมอ ไม่เคยใช้ in-memory เป็น source of truth — restart แล้วอ่านสถานะเดิม
ได้ครบ

**Input:** `ExternalSystemLifecycleInput`, real `RegistryStore`, real
`LifecycleEventStore`

**Output:** `ExternalSystemLifecycleResult` (`is_complete`,
`final_stage`, `final_status`, full `LifecycleRun`) — `async`, เพราะ
PERMISSION_ADMISSION เรียก `submitTask` จริง (async)

**Dependency ที่อนุญาต:** `../registration-pipeline/contract.ts`,
`../registration-update/contract.ts`,
`../integration-verification/contract.ts`,
`../target-resolution/contract.ts`,
`../permission-policy-resolution/contract.ts`, `../admission/contract.ts`,
`../agent-gateway/contract.ts`, `../runtime-verification/contract.ts`,
`../../execution/deploy/contract.ts`,
`../../software/registry-database/contract.ts`, `./types.ts`,
`./boundary.ts`, `./delivery-classification.ts`, `./store.ts`,
`./host-runtime.ts`

**สถานะจริงวันนี้ (2026-08-21, ยืนยันด้วยการรันจริง ไม่ใช่การเดา):**
PERMISSION_ADMISSION หยุด candidate ทุกตัวจริง — `../agent-gateway/`'s
`matchCapability` (ใน `gateway.ts`) ยังไม่มี entry ที่ route intent
"register external system lifecycle capability" ไปยัง capability ใดเลย
ทำให้ `submitTask()` คืน Task จริงที่ `status: "BLOCKED"` เสมอ Policy ยัง
resolve ALLOW ได้จริง (REGISTER_CAPABILITY ไม่ใช่ SYSTEM_CONTROL_ACTION)
แต่ Admission อ่าน task จริงแล้วพบว่า terminal จึงคืน
`NOT_ADMITTED`/`TASK_NOT_ACTIVE` อย่างสัตย์จริง — ไม่ใช่ bug ของโฟลเดอร์นี้
DEPLOY_INSTALL/RUNTIME_VERIFY/COMPLETE ยังไม่เคยถูกพิสูจน์ end-to-end ผ่าน
orchestrator นี้จนกว่าจะมี capability ใน `../agent-gateway/`'s index ที่
รองรับ intent นี้ — พิสูจน์แยกได้ผ่าน
`../../execution/deploy/tests/deploy.test.ts` และ
`../runtime-verification/tests/runtime-verification.test.ts` เท่านั้น

**ขอบเขตที่ยังไม่ได้ทำรอบนี้ (honest, NOT_COMPLETE):** `runExternalSystemLifecycle`
รันทุก stage ใน call เดียว — ยังไม่รองรับ true staged resume ข้าม process
(เรียกครั้งแรกค้างที่ RUNTIME_VERIFY แล้วรอ probe จริงจากนอกระบบ แล้วเรียก
ซ้ำด้วย candidate เดิม จะกลาย DUPLICATE เสมอ เพราะ
`runRegistrationPipeline` เห็น candidate เดิมเป็นของซ้ำ) RUNTIME_VERIFY's
freshness floor ใช้ grace window 5 นาทีลบจาก "now" แทนการเทียบกับเวลา
DEPLOY_INSTALL เสร็จเป๊ะ ด้วยเหตุผลเดียวกัน (single synchronous call)

**สิ่งที่ห้ามแตะ:** ห้ามเรียก classifyCandidate/fingerprintCandidate/
resolveDuplicate/commitRegisteredCandidate/resolveArtifactDestination/
resolvePolicy หรือ evaluateAdmission's internal logic ตรงๆ — ต้องผ่าน
contract.ts ของแต่ละโฟลเดอร์เท่านั้น ห้ามฝัง logic เฉพาะค่าย
(AWS/GitHub/Vercel/Supabase/model provider ใดๆ) ไว้ในโฟลเดอร์นี้ —
โฟลเดอร์นี้รู้จักเฉพาะ 16 stage ข้างบน ไม่รู้จัก provider ใดเป็นพิเศษ
ห้ามประกาศ COMPLETE โดยไม่มีผล RUNTIME_VERIFIED จริง ห้าม fabricate
task/worker context ให้ PERMISSION_ADMISSION ผ่าน — ต้องใช้ real
`submitTask`/`recordHandoff` เท่านั้น แม้จะรู้ว่าจะ BLOCKED จริงก็ตาม

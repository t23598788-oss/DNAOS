@AGENTS.md

# DNA OS Constitution (รัฐธรรมนูญ)

**JSON source of truth is `registry/CONSTITUTION.json`** — this file is its human-readable rendering. If they ever disagree, the JSON file wins; fix this file to match, not the other way around.

**ก่อนเริ่มงานทุกครั้ง (Any AI Agent — ไม่ผูกกับค่ายใดค่ายหนึ่ง)** อ่าน `registry/README.md` ก่อน แล้วตามลำดับ DNA OS Unified AI Runtime ที่นั่น — อ่าน `registry/CURRENT_STATE.json` → `registry/AI_SESSIONS.json` → `registry/LOCK_MANAGER.json` → `registry/TASK_QUEUE.json` — ห้ามเริ่มงานใหม่ถ้ามีงานค้างอยู่ ห้ามคุยกับ AI ตัวอื่นโดยตรง สื่อสารผ่าน Registry เท่านั้น AI ตัวไหนก็ได้ที่ทำตาม protocol นี้ถือว่าเป็น DNA OS Compatible (ดู `registry/AI_REGISTRY.json`)

**Layer Stack:** Constitution (ไฟล์นี้/`registry/CONSTITUTION.json`) กำหนดกฎหมาย → `registry/EXECUTION_CONTRACT.json` กำหนดวิธีปฏิบัติตามกฎหมาย → Runtime บังคับใช้ → Scheduler แจกงาน → Workers ลงมือทำ แยกกันโดยตั้งใจ เพื่อเปลี่ยน Runtime ได้โดยไม่ต้องแตะกฎหมาย

## Canonical Principles C-001..C-010 (owner, 2026-07-15, DNA-000058)
JSON source: `registry/CONSTITUTION.json` → `canonical_principles`. A compact restatement of governance philosophy — most map onto rules already declared (not re-declared, per Rule 101/103 no-duplicate-rules and C-010 rules-are-immutable):
- **C-001/002/003** (Evidence≠Source, no self-feedback, explicit audit boundaries) → Rule 107
- **C-004/008** (deterministic tool invocation, no silent governance override) → amended into Rule 108 (appended, not rewritten)
- **C-005** (verify environment before execution) → Rule 109
- **C-006** (every incident becomes knowledge) → Rule 100 + Rule 106
- **C-007** (every new rule needs verification) → NEW, `amendment_policy.rule_verification_required`
- **C-009** (explain why, not just what) → NEW, `amendment_policy.rule_rationale_required`
- **C-010** (rules immutable, incidents append-only, knowledge versioned) → NEW, `amendment_policy.immutability_and_versioning` — honestly flags one known pre-existing deviation (DNA-000048 rewrote KM-002-line fields in place rather than versioning them, done before this principle existed)
- **C-011** (every module self-describing: Identity/Purpose/Capabilities/Dependencies/Constraints/Current State/Missing Knowledge/Requested Actions/Verification Procedure; AI must read self-description before implementation) → amended into Rule 102 (SPRP), not a new rule — 2 real new fields (`constraints`, `verificationProcedure`) plus `missingKnowledge` added to `core/shared/types.ts`'s `SelfDescription` and populated with real, verified data in the one existing implementation (`engines/documents/selfDescription.ts`); still a declared target for the other ~469 modules, not enforced today
- **SDRN-P6** (owner, 2026-07-15, DNA-000060, Plan Lock exception — scoped via AskUserQuestion, NOT a repo-wide rollout): full 19-field `RuntimeContract` type + `NegotiationFlowState`/`computeNegotiationStage()` in `core/shared/types.ts`, built on top of `SelfDescription` (not replacing it). Implemented for 2 real modules: Document Engine (`getDocumentEngineRuntimeContract()`) and the LINE driver (`plugins/drivers/line.selfDescription.ts`, `getLineDriverRuntimeContract()` — chosen for its already-verified KM-002-line history). Both verified live with real computed data, including a correctly-computed `knowledge_gap` negotiation stage for each. Still true: only 2 of ~470 modules; contract-first is not yet mandatory for AI sessions generally — see `registry/rule-coverage.json` rule 102
- **SDRN-P7** (owner, 2026-07-15, DNA-000061, Plan Lock exception — custom-scoped): platform-level `ContextBudget`/`DeltaContext`/`WorkOrder`/`ExecutionReadiness`/`VerificationContract`/`MeasurementReport` in `core/shared/types.ts`. Real, verified Contract Coverage metric (`npm run hello -- --contract-coverage` — 2/473 = 0.42%). The other 6 requested metrics (Repository Read Count, Context Size, Context Reuse Ratio, Delta Context Ratio, Repository Scan Avoidance, Execution Preparation Time) are honestly `null` with a stated reason — this repo cannot observe AI session token/read/timing behavior, per explicit owner instruction not to claim a numeric reduction. `ExecutionReadiness` is explicitly advisory only — nothing here mechanically gates AI tool calls. Found and fixed a real Rule 107 self-scan bug live: the coverage scanner initially matched its own grep pattern string inside itself
- **SDRN-P8** (owner, 2026-07-15, DNA-000062, continuation of SDRN-P6/P7's already-granted scope under Rule 105 — no fresh exception needed, same 2 modules): `core/runtime/contextBroker.ts` — promotes SDRN-P7's per-module helper functions into one broker (compute once, in-process cache, derive all views from the same instance). Real, instrumented `readCounter` (incremented inside real file reads) enabled a genuine before/after measurement: `npm run hello -- --broker-report` → **55 real repository reads (old pattern) → 11 real reads (broker) = 80% real, computed reduction** for a repeated-access workload on the same 2 modules. Precisely scoped, not overclaimed: this measures the broker's own behavior only, not AI session token/read behavior generally, which remains outside this repo's observability
- **SDRN-P9** (owner, 2026-07-15, DNA-000063, scoped via AskUserQuestion after auditing a 10-item directive against real state): `ExecutionPlan` (`WorkOrder` + a real `expectedOutput` field) and `ExecutionReport` (real aggregation of already-computed broker data — no new computation, no fabricated fields). 3 of the directive's 10 items were already built, 1 overlapped `knip`/`jscpd`, several (repository-access gating, caching the AI's own reasoning, most AI-session metrics) were found not achievable in this repository regardless of scope. Verified live across a real cache-miss and cache-hit for both modules
- **SDRN-P10** (owner, 2026-07-15, DNA-000064, direct continuation under Rule 105 — same 2 modules, no new scope flagged unbuildable): `RuntimePacket` gained `briefing` (pure synthesis of contract fields, one paragraph instead of 6 sub-objects) and `architecture` (real `layer`+`allowedImports` lookup, reusing `contract.executionScope[0]` — previously only unstructured prose in `constraints`). Found and fixed a real bug live: `architecture`'s first version read files even on a cache hit, contradicting the verified 0-additional-reads claim from SDRN-P8/P9 — fixed by caching it alongside the contract, re-verified (8 reads unchanged across a cache-hit access)

## หลักการสูงสุด (จาก owner-context.json)
1.  **AI Role**: AI เป็นแค่ตัวกลาง ไม่ใช่ศูนย์กลาง — ศูนย์กลางคือกฎและสถาปัตยกรรม
2.  **Growth**: DNA OS เติบโตจากการขยายคลังกฎและ Workflow ไม่ใช่จากการฝึก AI
3.  **Measurement**: Dashboard ที่สำคัญวัด Constitution/Business/Risk ไม่ใช่ AI metrics
4.  **Governance**: ระบบต้องปกครองตัวเอง — ต่อให้เปลี่ยนทีม 20 คน กฎยังบังคับเหมือนเดิม
5.  **Existence**: DNA OS ไม่ใช่โปรแกรม แต่คือสิ่งมีชีวิตดิจิทัลที่รู้จักตัวเอง

## Responsibility Separation (DNA OS Engineering Principle, owner 2026-07-14, DNA-000054)
- **Human** decides **WHY** — Vision, Business Goals, Policy, Architecture Direction, Constraints, Business Rules
- **Runtime** decides **WHAT is required** — Architecture Integrity, Module Relationship, Dependency, Runtime Health, Validation, Knowledge, Self Diagnosis, Self Explanation
- **AI** decides **HOW to implement** — Analysis, Refactoring, Repair, Optimization, Knowledge Assimilation, Capability Expansion
- **Validation** decides **WHETHER it is correct**
- **Deployment** occurs only after Validation PASS — Runtime is the final authority for technical integrity, Human is the final authority for business intent
- Runtime Contract Rule 11 (`registry/CONSTITUTION.json` → `runtime_contract.rules`): ห้ามมนุษย์หรือ AI ข้าม Runtime Validation ก่อน deploy — **code-enforced (DNA-000055)**: `package.json`'s `prebuild` runs `scripts/deploy-gate.ts` automatically before every `npm run build` (the same command Vercel's default deploy uses) — verified live, `npm run build` currently exits 1 and prints the full Deploy Blocked report against this repo's real current state (owner explicitly confirmed wiring this in, accepting that it blocks all builds/deploys until the 4 pre-existing real FAILs are fixed)

## Recommendation & Approval Levels (ระดับของข้อเสนอแนะและการอนุมัติ)

ทุกแผนการทำงาน (Execution Plan) ที่เสนอโดย Worker จะถูกจัดระดับและจัดการดังนี้:

*   **LEVEL 1: Informational (แค่แจ้ง)**
    *   การเปลี่ยนแปลงเล็กน้อยที่ไม่มีผลกระทบ (เช่น แก้ไขเอกสาร) Runtime จะบันทึกและดำเนินการต่อ

*   **LEVEL 2: Recommended (แนะนำ)**
    *   การแก้ไขที่ปลอดภัย (เช่น Refactor) Runtime จะอนุมัติให้ดำเนินการได้โดยอัตโนมัติ

*   **LEVEL 3: High Impact (ควรตรวจสอบก่อน)**
    *   การเปลี่ยนแปลงที่อาจกระทบหลายส่วน (เช่น เปลี่ยน API) Runtime จะทำการวิเคราะห์ผลกระทบ (Impact Analysis) และเสนอแผนการดำเนินงานเพื่อรอการตรวจสอบ

*   **LEVEL 4: Approval Required (ต้องขออนุมัติ)**
    *   การเปลี่ยนแปลงที่มีความเสี่ยงสูง (เช่น ลบโมดูลหลัก) Runtime จะเสนอเรื่องให้มนุษย์ (CEO) อนุมัติผ่าน Dashboard เท่านั้น

*   **LEVEL 5: Forbidden (ห้าม)**
    *   การกระทำที่ขัดต่อ Constitution (เช่น ลบฐานข้อมูล, สร้างโมดูลซ้ำ) Runtime จะปฏิเสธและหยุดการทำงานทันที

## Architecture Principles (หลักการสถาปัตยกรรม)

1.  **Constitution**: คือกฎหมายสูงสุดของระบบ เขียนและแก้ไขโดยมนุษย์เท่านั้น
2.  **Runtime**: คือผู้บังคับใช้กฎของ Constitution ไม่ใช่ AI และเป็นกลาง ไม่ขึ้นกับ AI ค่ายใด
3.  **Governance Engine**: เป็นส่วนหนึ่งของ Runtime ทำหน้าที่อ่าน Constitution, Registry, และ Repository เพื่อตัดสินผลตามกฎที่มีอยู่เท่านั้น ไม่มีสิทธิ์คิด, ตีความ, หรือแก้ไขกฎ
4.  **External Workers**: AI ทุกตัว (Gemini, Claude, GPT, etc.) เป็น "คนงานภายนอก" ที่รับ Task ไปทำ แล้วส่งผลกลับมาให้ Runtime ตรวจสอบ
5.  **Chain of Command**: Worker → Runtime (Governance Engine) → Human (CEO). Runtime เป็นผู้อนุมัติ, ปฏิเสธ, หรือส่งต่อให้มนุษย์ตาม Constitution เท่านั้น

## สถาปัตยกรรม Layer (ปัจจุบัน — ดู registry/architecture.json)
```
core       → Runtime + Executor + Config/Connector Loader + Shared Types (ห้ามเขียน DB ตรง)
gateway    → ประตูเดียวเขียน DB — preview → token → execute (payment/document/debt/connectors)
engines    → คำนวณ (ราคา/หนี้/ภาษี) + Validation + Document/Transaction Workflow ทุกค่าจาก DB ห้าม hardcode
cognitive  → Intent → Plan → Execute → Reflect pipeline
presenter  → สรุป/อธิบาย/Timeline — ห้าม import engines ตรง
services   → I/O boundary — DB, Realtime, AI bridge, middleware
plugins    → App Drivers + macOS/LINE/local agent — ห้ามเรียก core หรือ plugin อื่นตรง
registry   → Source of Truth ที่ทุกโมดูลต้อง register (ไฟล์นี้)
```
เดิมคือ V1-Input/V2-Rules/V3-Engines/V4-AI/V5-Presenter/V6-Executor (เลิกใช้ตั้งแต่ folder reorg 2026-07-06) — ห้ามใช้ชื่อเดิมในโค้ดหรือเอกสารใหม่

## กฎเหล็ก
- ห้าม hardcode ข้อมูลธุรกิจ — ทุกค่าจาก DB via config-loader (ไม่มี fallback)
- ห้าม mock/fake/demo data ใน source code
- ทุก write ต้อง confirmed จากมนุษย์ (Rule 72)
- AI ห้ามเปลี่ยนสถานะการเงิน (Rule 73, 83)
- ทุก API route ต้องมี Auth (requireAuth)
- ทุก Module ต้อง register ใน module-registry.json
- ทุก Command ต้อง register ใน command-registry.json
- ทุก import ข้าม layer ต้องอยู่ใน dependency-graph.json
- **Rule 100 — Core Learning Policy** (ประกาศ 2026-07-14, DNA-000026): ทุก bug/duplicate/runtime error/architecture drift/dependency violation/registry error ที่พบต้องบันทึกเป็นบทเรียนใน `registry/existence.json` → `known_mistakes` ก่อนถือว่างานจบ ห้ามเก็บไว้เฉพาะบทสนทนากับ AI. System learns first, AI learns from the System — ไม่ใช่ AI learns first. บังคับใช้บางส่วนผ่าน `scripts/pre-commit-check.sh` Guard 9 (WARN เมื่อ module ชื่อซ้ำในหลายตำแหน่ง); รูปแบบที่ยังไม่มี mechanical check ต้องระบุ `detection:"manual"` ตรงไปตรงมา ห้ามอ้างการป้องกันที่ไม่มีจริง ดู `registry/rule-coverage.json` rule 100
- **Rule 101 — Connect before Create, Compose before Expand** (ประกาศ 2026-07-14, DNA-000030): ก่อนสร้าง capability/registry/runtime/explanation-engine ใหม่ ต้องค้นก่อนว่ามีของเดิมที่ทำหน้าที่นี้อยู่แล้วหรือไม่ (เช่น `npm run hello`, อ่าน `registry/existence.json`) ห้ามสร้าง Architecture ซ้ำ, Registry ซ้ำ, Runtime ซ้ำ, หรือ Explanation Engine ซ้ำ. Runtime ต้องเข้าใจตัวเองก่อนให้ AI เข้าใจมัน บังคับใช้บางส่วนผ่านกลไกเดียวกับ Rule 100 ที่ชั้น module/file basename เท่านั้น (Guard 9, `confirmed_duplicate_pairs`) — ชั้นที่กว้างกว่า (ค้นหา capability ที่ซ้ำกันเชิงความหมาย) ยังไม่มี mechanical check จริง ต้องอาศัยวินัยของผู้สร้างเอง ดู `registry/rule-coverage.json` rule 101
- **Rule 102 — Self Publishing Runtime Protocol (SPRP)** (ประกาศ 2026-07-14, DNA-000031): declared engineering target, ไม่ใช่กฎที่บังคับใช้จริงวันนี้ — ทุก Runtime Component ควร proactively publish identity/capability/state/health/dependency/resource/owner/execution-status/improvement-request ผ่าน interface มาตรฐาน (`SelfDescribe()`/`PublishState()`/`PublishHealth()`/`PublishNeed()`/`PublishDependency()`/`PublishCapability()`/`PublishKnowledge()`/`PublishWarning()`/`PublishProposal()`) ของจริงวันนี้มีแค่ `engines/documents/selfDescription.ts` (`SelfDescribe()` 1/466 module) + `scripts/hello.ts` (compose แบบ manual, ไม่ proactive) ต้นแบบที่ใกล้เคียงที่สุดคือ `core/workspace/runtimeRegistry.ts` (register/subscribe มีอยู่แล้วแต่ `register()` ไม่เคยถูกเรียกจริง) — ตาม Rule 101 การสร้าง SPRP จริงต้องต่อยอดจากตัวนี้ ไม่สร้างคู่ขนาน และต้องขอ Plan Lock exception ใหม่แยกเป็นเฟส ดู `registry/rule-coverage.json` rule 102
- **Rule 103 — Reuse Before Build** (ประกาศ 2026-07-14, DNA-000036): ก่อนสร้าง module/registry/runtime/database/API/workflow/event bus/cache/service/interface/storage ใหม่ ต้องค้นก่อนว่ามีของเดิมอยู่แล้วหรือไม่ — ของเดิมครอบคลุม ≥80% ให้ EXTEND ห้ามสร้างซ้ำ ทุก request ต้องได้ข้อสรุปเป็น EXISTING / EXTEND / NEW เท่านั้น ทุกโค้ดใหม่ต้องอธิบายได้ว่าทำไมของเดิมแก้ปัญหาไม่ได้ ทั่วไปกว่า Rule 101 (ครอบคลุมทุกประเภท infra ไม่ใช่แค่ module/registry/runtime/explanation-engine) บังคับใช้จริงเฉพาะชั้น module/file basename (กลไกเดียวกับ Rule 101 — Guard 9, `confirmed_duplicate_pairs`) กรอบ EXISTING/EXTEND/NEW เองยังไม่มี mechanical check เป็นวินัยที่ปฏิบัติจริงตลอด SDRN-P1 ถึง P5 แต่ยังไม่ถูกบังคับด้วยโค้ด ดู `registry/rule-coverage.json` rule 103
- **Rule 107 — Evidence Isolation** (ประกาศ 2026-07-15, DNA-000057): Evidence (ledger/report/log/validation result เช่น `registry/VALIDATION_RESULTS.json`, `registry/CHANGELOG.json`, `DNA_OS_HEALTH.json`) ห้ามถูก audit เหมือน source code — ทุก audit tool ต้อง exclude ไฟล์เหล่านี้ชัดเจน ห้ามไฟล์ที่ audit รอบก่อนสร้างไว้ถูกดึงกลับมาเป็น input รอบเดียวกัน/รอบถัดไป (กัน self-feedback loop) เกิดจากเหตุการณ์จริง DNA-000056 (Guard 1 + jscpd สแกน VALIDATION_RESULTS.json ของตัวเอง วนซ้ำไม่จบ) บังคับใช้จริง: Guard 1 excludes `VALIDATION_RESULTS.json` by basename, jscpd invocations ระบุ `-f`/`-i` ชัดเจน — ยังไม่มี guard ทั่วไปที่ตรวจทุก audit tool ใหม่โดยอัตโนมัติว่า exclude ครบหรือไม่ ดู `registry/rule-coverage.json` rule 107
- **Rule 108 — Tool Invocation & Configuration Precedence Contract** (ประกาศ 2026-07-15, DNA-000057): CLI > Environment > Config File เสมอ แต่ทุกครั้งที่ CLI override config file จริงต้อง log/comment ไว้ ห้ามเงียบ เกิดจากเหตุการณ์จริง DNA-000056 (`.jscpd.json` ประกาศ ignore `**/*.json` ถูกต้อง แต่ governance.sh/dashboard.sh ส่ง directory args ตรง ๆ override เงียบ ๆ) บังคับใช้จริงบางส่วน: fix นี้มี comment อธิบาย override ไว้ในทั้ง 3 จุด — ยังไม่มี mechanical check ตรวจจับ override อัตโนมัติ ดู `registry/rule-coverage.json` rule 108
- **Rule 109 — Environment Verification Before Audit** (ประกาศ 2026-07-15, DNA-000057): ก่อนเชื่อผล audit ต้องตรวจว่า grep/sed/awk/tail/tr เป็น real binary ไม่ใช่ shell wrapper — ผลทดสอบผ่าน interactive shell ห้ามถือว่าเท่ากับพฤติกรรมจริงของ script จนกว่าจะ trace/ยืนยันด้วย binary จริง เกิดจากเหตุการณ์จริง DNA-000056 (interactive `grep` ในสภาพแวดล้อมนี้เป็น ugrep wrapper คนละตัวกับ `/usr/bin/grep` ที่ script จริงใช้ — การแก้ครั้งแรกดูเหมือนได้ผลตอนทดสอบ interactive แต่ไม่ทำงานจริง) ดู `registry/rule-coverage.json` rule 109
- **Rule 110 — Encoding Contract** (ประกาศ 2026-07-15, DNA-000057): ห้ามตัดข้อความที่ raw byte offset (`tail -c N`) แล้วส่งต่อคำสั่งที่ validate UTF-8 (เช่น `tr`) โดยไม่ป้องกัน multi-byte character ถูกตัดครึ่ง ต้องใช้ `LC_ALL=C` หรือเทียบเท่า เกิดจากเหตุการณ์จริง DNA-000056 (`tail -c 1800 | tr` ตัดข้อความไทยกลางตัวอักษร ทำให้ governance.sh ล้มด้วย `Illegal byte sequence`) ดู `registry/rule-coverage.json` rule 110
- **Rule 106 — Runtime Self-Evolving Knowledge Layer** (ประกาศ 2026-07-14, DNA-000053): ทุกครั้งที่แก้ปัญหา ห้ามจบแค่แก้ไฟล์ ต้องวิเคราะห์ root cause จริง, ตรวจว่า Runtime ตรวจพบเองได้ไหม (ถ้าไม่ได้ = ขาด Capability, ต้องเพิ่ม Detection/Diagnostic/Explanation/Validation/Dependency/Architecture Check เชื่อมระบบเดิม ห้ามแยกระบบ), ทดสอบว่าเหตุการณ์เดิมซ้ำแล้ว Runtime ตรวจพบ-อธิบาย-ระบุสาเหตุ-ไฟล์-โมดูล-วิธีแก้เองได้, Deploy ต้องบล็อกด้วยข้อความภาษาคน (Reason/Location/Root Cause/Required Action/Status) จนกว่า Runtime ยืนยัน PASS จริง, บันทึกเข้า Knowledge/Root Cause/Validation Engine ทันที, ปัญหาเดิมห้ามเกิดซ้ำเกิน 3 ครั้งก่อนต้องสร้าง Capability แทนการแก้เฉพาะหน้า บังคับใช้จริงบางส่วน: `scripts/deploy-gate.ts` (npm run deploy-gate) รวม governance.sh จริง + ดึง root_cause/suggested_fix จริงจาก VALIDATION_RESULTS.json มาพิมพ์เป็นข้อความภาษาคน บล็อก exit 1 เมื่อ FAIL — verified ด้วยสถานะจริงของ repo (274 duplicate clones, 1 dependency violation) ไม่ใช่ตัวอย่างสมมติ ยังไม่มี guard ที่นับ "เกิดซ้ำครั้งที่ 3" แบบอัตโนมัติ (เป็นวินัยที่ปฏิบัติจริงแต่ manual — ดู KM-001's 3 recurrences ที่นำไปสู่ Guard 11) ดู `registry/rule-coverage.json` rule 106
  - **Operational Intelligence Objective** (ประกาศ 2026-07-15, DNA-000065, C-009 — supplies the WHY, not a new mechanism): the goal is to optimize the Runtime's own intelligence continuously, NOT to optimize AI. 18 tracked dimensions (8 reduce: structural/dependency/business ambiguity, duplicate knowledge/computation/workflow/data-access, runtime inconsistency; 10 increase: knowledge/capability completeness, dependency correctness, workflow consistency, module interoperability, registry integrity, self-description quality, architecture cohesion, autonomous diagnosability/repairability), each mapped against real coverage — **honest finding: 4 have zero real tracking today** (structural ambiguity, business ambiguity, duplicate workflow, duplicate data access — confirmed directly, no checker exists for any of them), the rest have real partial-to-full coverage already built across Rules 100/101/103/104/105/107/108/109/110 and SDRN-P6–P10
- **Rule 105 — Autonomous Architecture Maintenance Authorization** (ประกาศ 2026-07-14, DNA-000052): Runtime/AI แก้ไขได้อัตโนมัติโดยไม่ต้องขออนุมัติซ้ำ เมื่อครบ 4 เงื่อนไข: (1) ตาม Constitution/Business/Architecture Rules ที่มีอยู่แล้ว (2) ไม่เปลี่ยน Business Logic ไม่ละเมิดกฎ (3) จำกัดเฉพาะ architecture maintenance/registry sync/runtime repair/metadata/dependency correction/documentation alignment/validation improvements/reusable infrastructure/developer tooling (4) ผ่าน validator ที่มีอยู่ทั้งก่อนและหลัง ทุกครั้งต้องบันทึก audit trail เต็ม (executor/timestamp/affected modules-files-functions/reason/root cause/validation before-after/rollback) ลง CHANGELOG.json + VALIDATION_RESULTS.json + CURRENT_STATE.json ถ้าเกินขอบเขต Constitution ต้องหยุดทันทีและสร้าง Owner Task แทน บังคับใช้จริงบางส่วน: audit-trail fields ถูกเขียนจริงทุกครั้งที่ใช้ (ตัวอย่างจริงแรก: DNA-000052 เอง แก้ scripts/governance.sh jscpd `--exitCode`→`--exit-code`) แต่ไม่มี guard ที่ตรวจสอบว่า "ขอบเขตอยู่ในสิทธิ์จริงหรือไม่" ก่อนอนุญาตให้รันโดยอัตโนมัติ — เป็นวินัยของผู้ execute เอง ไม่ใช่ mechanical gate ดู `registry/rule-coverage.json` rule 105
- **Rule 104 — Nothing Is Wasted** (ประกาศ 2026-07-14, DNA-000037): ก่อนลบ source code ต้อง extract ความรู้ก่อนเสมอ (purpose/owner/dependencies/failure reason/replacement/migration path/lessons learned) ห้ามลบโดยไม่บันทึกความรู้ไว้ใน `registry/existence.json` known_mistakes ก่อน — executable code ชั่วคราว knowledge ถาวร บังคับใช้จริงเฉพาะกรณี deprecation (ตัวอย่างจริง: `plugins/line/line.ts` มี `deprecated:true` + เหตุผล + ตัวแทนบันทึกไว้แล้วใน `confirmed_duplicate_pairs`) — กรณี deletion จริงยังไม่เคยเกิดใน session นี้ จึงยังไม่มีหลักฐานว่า mechanism นี้ถูกบังคับใช้จริงตอนลบไฟล์ ไม่มี guard สกัดกั้น `rm` ดู `registry/rule-coverage.json` rule 104

## Types — Single Source of Truth
`core/shared/types.ts` เท่านั้น ห้ามสร้าง type ซ้ำในไฟล์อื่น (เดิมคือ `lib/shared/types.ts` ก่อน reorg)

## คำสั่งสำคัญ
```bash
npm run guard                  # ตรวจ governance ทุกข้อ
npm run dashboard              # Health + Risk Score
npm run intelligence           # Decision + Knowledge Coverage
npm run existence-intelligence # Existence Intelligence 16 ชั้น
npm run diagnosis              # Self Analysis + Reasoning Tree
npm run precommit              # ตรวจก่อน commit
npm run dead-code              # หา unused files/functions
npm run duplicates             # หา copy-paste
npm run backup                 # Backup ทุกตาราง → backups/
npm run restore -- backups/DIR # Restore จาก backup
```

## Registry Files (ห้ามมี Shadow System)
- `registry/module-registry.json` — ทุกไฟล์ต้อง register
- `registry/command-registry.json` — ทุก command ต้อง register
- `registry/dependency-graph.json` — ทุก cross-layer import ต้อง declare
- `registry/existence.json` — capabilities, goals, missing knowledge
- `registry/infrastructure.json` — external services, costs, life support
- `registry/business-coverage.json` — business domains coverage
- `registry/decision-coverage.json` — decision points codified
- `registry/rule-coverage.json` — Constitution rules enforcement
- `registry/CONSTITUTION.json` — JSON source of truth ของไฟล์นี้ทั้งไฟล์
- `registry/EXECUTION_CONTRACT.json` — วิธีปฏิบัติตามกฎหมาย (Execution Order/Rules/Output contract) แยกออกจาก Constitution โดยตั้งใจ
- `registry/CURRENT_STATE.json` / `TASK_QUEUE.json` / `CHANGELOG.json` / `LOCK_MANAGER.json` / `AI_SESSIONS.json` / `HANDOFF.json` / `AI_REGISTRY.json` — AI Execution Protocol ledger, ดู `registry/README.md`
- `registry/capability-registry.json` — 202 Capabilities (frozen v1.0.0), ดู `core/workspace/composer|planner|orchestrator/`
- `registry/architecture.json` / `architecture-book.json` — layer map + generated module/import graph (แหล่งข้อมูลของ `/admin/architecture`, `/admin/graph`)
- `registry/drivers.json` / `services.json` / `events.json` / `interfaces.json` / `schemas.json` / `modules.json` — resolved via `registry/index.ts` → `core/runtime/engine.ts` (the real, live Runtime Engine)
- `registry/portals.json` / `permissions.json` / `connector-lifecycle.json` / `GOVERNANCE_REGISTRY.json` / `SCHEDULER.json` / `owner-context.json` — supporting registries, each single-purpose per its filename
- `registry/VALIDATION_RESULTS.json` — Validation Result Ledger (DNA-000050): every real validator run (timestamp/module/command/validator/result/root_cause/evidence/suggested_fix/fixed_by/verification_result), append-only, written by `scripts/record-validation.ts`, wired into `scripts/governance.sh`'s `run_check()`; links to Runtime Trace (`registry/trace/trace.registry.json`), Event Timeline (`registry/events.json`), CHANGELOG, and Knowledge Engine (`existence.json` known_mistakes) — queryable via `npm run hello -- --evidence "<query>"`
- **Found missing from this list during Registry Reconciliation (DNA-000024), added here as a documentation fix, not new structure**: `registry/commands/` (`commands.json` real pattern-trigger table, `workflows.json` the actual Workflow Registry read by `core/executor/engine.ts` — NOT `command-registry.json`, which is a separate cognitive/AI-dispatch command contract list) and `registry/{communication,conversation,database,execution,trace}/` (each a `_loader.ts`/`_resolver.ts`/`_schema.ts`/`_validator.ts` + domain `.registry.json` set, exported centrally via `registry/index.ts`). The domain `.registry.json` data files themselves are occasionally reached by other code (e.g. `app/api/dbd/route.ts` reads `registry/database/*.registry.json` directly by path), but every one of the 6 folders' own `_loader.ts`/`_resolver.ts` modules — the intended access layer, and `registry/index.ts`'s actual reason for re-exporting `resolveCommunication`/`resolveConversation`/etc — has zero real importers anywhere in the app. Flagged as an orphan subsystem in DNA-000024, not deleted or merged, pending owner review.

## สถานะปัจจุบัน
ตัวเลขจริงล่าสุดอยู่ที่ `registry/existence.json`, `registry/business-coverage.json`, `registry/decision-coverage.json`, `registry/rule-coverage.json`, `registry/infrastructure.json` เสมอ — ห้ามจดตัวเลข snapshot ไว้ในไฟล์นี้ซ้ำเพราะจะกลายเป็นข้อมูลเก่าที่ไม่มีใครอัปเดต (ดู registry/CONSTITUTION.json → current_status)

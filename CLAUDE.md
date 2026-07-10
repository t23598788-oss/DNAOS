@AGENTS.md

# DNA OS Constitution (รัฐธรรมนูญ)

**JSON source of truth is `registry/CONSTITUTION.json`** — this file is its human-readable rendering. If they ever disagree, the JSON file wins; fix this file to match, not the other way around.

**ก่อนเริ่มงานทุกครั้ง (Any AI Agent — ไม่ผูกกับค่ายใดค่ายหนึ่ง)** อ่าน `registry/README.md` ก่อน แล้วตามลำดับ DNA OS Unified AI Runtime ที่นั่น — อ่าน `registry/CURRENT_STATE.json` → `registry/AI_SESSIONS.json` → `registry/LOCK_MANAGER.json` → `registry/TASK_QUEUE.json` — ห้ามเริ่มงานใหม่ถ้ามีงานค้างอยู่ ห้ามคุยกับ AI ตัวอื่นโดยตรง สื่อสารผ่าน Registry เท่านั้น AI ตัวไหนก็ได้ที่ทำตาม protocol นี้ถือว่าเป็น DNA OS Compatible (ดู `registry/AI_REGISTRY.json`)

**Layer Stack:** Constitution (ไฟล์นี้/`registry/CONSTITUTION.json`) กำหนดกฎหมาย → `registry/EXECUTION_CONTRACT.json` กำหนดวิธีปฏิบัติตามกฎหมาย → Runtime บังคับใช้ → Scheduler แจกงาน → Workers ลงมือทำ แยกกันโดยตั้งใจ เพื่อเปลี่ยน Runtime ได้โดยไม่ต้องแตะกฎหมาย

## หลักการสูงสุด (จาก owner-context.json)
1.  **AI Role**: AI เป็นแค่ตัวกลาง ไม่ใช่ศูนย์กลาง — ศูนย์กลางคือกฎและสถาปัตยกรรม
2.  **Growth**: DNA OS เติบโตจากการขยายคลังกฎและ Workflow ไม่ใช่จากการฝึก AI
3.  **Measurement**: Dashboard ที่สำคัญวัด Constitution/Business/Risk ไม่ใช่ AI metrics
4.  **Governance**: ระบบต้องปกครองตัวเอง — ต่อให้เปลี่ยนทีม 20 คน กฎยังบังคับเหมือนเดิม
5.  **Existence**: DNA OS ไม่ใช่โปรแกรม แต่คือสิ่งมีชีวิตดิจิทัลที่รู้จักตัวเอง

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

## สถานะปัจจุบัน
ตัวเลขจริงล่าสุดอยู่ที่ `registry/existence.json`, `registry/business-coverage.json`, `registry/decision-coverage.json`, `registry/rule-coverage.json`, `registry/infrastructure.json` เสมอ — ห้ามจดตัวเลข snapshot ไว้ในไฟล์นี้ซ้ำเพราะจะกลายเป็นข้อมูลเก่าที่ไม่มีใครอัปเดต (ดู registry/CONSTITUTION.json → current_status)

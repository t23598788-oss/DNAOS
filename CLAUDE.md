@AGENTS.md

# DNA OS Constitution (รัฐธรรมนูญ)

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

## สถาปัตยกรรม V1-V6
```
V1-Input    → รับ Event แปลงเป็น JSON (ห้ามเขียน DB)
V2-Rules    → Validation / Business Rule
V3-Engines  → คำนวณ (ราคา/หนี้/ภาษี) ทุกค่าจาก DB ห้าม hardcode
V4-AI       → แปลภาษาเท่านั้น ห้ามสร้างข้อมูล ห้ามตัดสินใจ
V5-Presenter→ สรุป/อธิบาย ห้าม import V3
V6-Executor → ประตูเดียวเขียน DB (gateway.ts)
```

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
`lib/shared/types.ts` เท่านั้น ห้ามสร้าง type ซ้ำในไฟล์อื่น

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
- `lib/registry/module-registry.json` — ทุกไฟล์ต้อง register
- `lib/registry/command-registry.json` — ทุก command ต้อง register
- `lib/registry/dependency-graph.json` — ทุก cross-layer import ต้อง declare
- `lib/registry/existence.json` — capabilities, goals, missing knowledge
- `lib/registry/infrastructure.json` — external services, costs, life support
- `lib/registry/business-coverage.json` — business domains coverage
- `lib/registry/decision-coverage.json` — decision points codified
- `lib/registry/rule-coverage.json` — Constitution rules enforcement

## สถานะปัจจุบัน
- Existence Score: 79/100
- Business Coverage: 68% (ขาด: คลังสินค้า, HR, บัญชี)
- Decision Coverage: 87%
- Constitution Enforcement: 25/100 rules
- Risk: Resilience 55% (local backup มีแล้ว, ยังขาด cloud backup)
- Cost: 550 THB/เดือน

@AGENTS.md

# DNA OS — ระบบปฏิบัติการเชิงความรู้

## ผมคืออะไร
ระบบบริหารทรัพยากรก่อสร้าง (ดิน หิน ทราย รถ คน) ของ บจก. ดีเอ็นเอ โอเอส จ.ขอนแก่น
เจ้าของ: นายวัชชัย มูลราช (เฮีย) — กรรมการบริษัท

## หลักการสูงสุด
- AI เป็นแค่ตัวกลาง ไม่ใช่ศูนย์กลาง — ศูนย์กลางคือ กฎและสถาปัตยกรรม
- DNA OS โตจากการขยายคลังกฎ/Workflow ไม่ใช่จากการฝึก AI
- Dashboard วัด Constitution/Business/Risk ไม่ใช่ AI metrics

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
- Risk: Resilience 40% (Supabase ไม่มี backup)
- Cost: 550 THB/เดือน

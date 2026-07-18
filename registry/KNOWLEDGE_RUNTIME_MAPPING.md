# DNA OS Knowledge Runtime Mapping

**Layer**: ชั้น **Runtime Mapping** ของ Knowledge Model (ดู `registry/KNOWLEDGE_MODEL.md`) — ตอบคำถาม **"Runtime จะใช้ความรู้นี้อย่างไร"** คือสัญญา (contract) ระหว่าง Knowledge Model กับส่วนอื่นของ DNA OS (`core/`, `gateway/`, `engines/`, `cognitive/`) ไม่ใช่ความหมาย (Constitution) และไม่ใช่โครงสร้างข้อมูล (Schema)

**สถานะจริงวันนี้ (ตรงไปตรงมา ไม่เดา, อัปเดต 2026-07-18)**: มี consumer จริงตัวแรกแล้ว — `scripts/deploy-gate.ts` เขียน Incident Entry ทุกครั้งที่ governance check ล้มเหลวจริง ผ่าน `services/knowledge/client.ts` (ชั้น Storage Adapter ของ client เอง, `source: production`, `confidence: verified` เพราะเป็นผลตรวจจริงจากระบบ ไม่ใช่การประมาณ) **แต่การเขียนยัง no-op เงียบๆ ทุกครั้ง** เพราะ `knowledge` schema (Storage Adapter migration) ยังไม่ apply เข้า production — ทดสอบแล้วจริงว่า `deploy-gate.ts` ทำงานจบสมบูรณ์แม้การเขียน Knowledge ล้มเหลว (non-fatal ตามที่ออกแบบไว้) `services/knowledge/client.ts` คือจุดตัดที่ `KNOWLEDGE_SCHEMA.md`'s abstract model ถูก realize จริงฝั่ง caller — ไม่ใช่ Storage Adapter เอง (นั่นคือ migration file) แต่เป็นตัวกลางที่ caller อื่นๆ ในอนาคตควรเรียกผ่าน แทนที่จะ query `knowledge.*` ตรงๆ เอง

---

## Runtime อ่านอะไร

Runtime component ใดๆ (`core/runtime/engine.ts`, `cognitive/*`, ฯลฯ) ที่ต้องการอ้างอิง Knowledge **ต้องอ่านผ่าน Active View เท่านั้น** — ห้ามอ่าน Entry ทั้งหมดตรงๆ (รวม Historical/Superseded/Deprecated/Rejected)

เหตุผล: Runtime ตัดสินใจจากสิ่งที่ระบบถือว่าจริง ณ ปัจจุบันเท่านั้น ความรู้ที่ไม่ Active มีไว้ให้ AI/มนุษย์อ้างอิงตอนตัดสินใจ ไม่ใช่ให้ Runtimeนำไปขับเคลื่อนพฤติกรรมจริง

## AI เขียนอะไร / เขียนยังไง

AI ที่จะบันทึกความรู้ใหม่ (Observation, Lesson, Incident ฯลฯ) ต้อง:

1. ระบุ `source` เป็น `AI Analysis` เสมอ (ห้ามระบุตัวเองเป็น `Owner Decision`)
2. ระบุ `confidence` ตามความเป็นจริง — ห้ามตั้ง `Verified` เว้นแต่ตรวจสอบกับหลักฐานจริงแล้ว (ไม่ใช่แค่ "ดูสมเหตุสมผล")
3. ระบุ `runtime_actionable`/`ai_actionable`/`human_actionable` ให้ตรงกับที่ตั้งใจจริง ไม่ตั้ง `true` ทั้งหมดเป็นค่าเริ่มต้นที่ปลอดภัย (นั่นทำให้ field นี้ไร้ความหมาย)
4. เมื่อ Entry ใหม่มีที่มาจาก Entry เดิม (แก้ incident, สืบเนื่องจาก observation) ต้องสร้าง Link ที่เหมาะสมทันที ไม่ปล่อยให้เป็น Entry ลอยที่ไม่เชื่อมกับอะไร

AI **ไม่มีสิทธิ์** เปลี่ยน status ของ Entry ที่ `source = Owner Decision` โดยไม่ได้รับการยืนยันจาก owner ก่อน (ดู KNOWLEDGE_CONSTITUTION.md's "สิ่งที่ยังไม่ตัดสินใจ" — ยังไม่มีการบังคับใช้ระดับกลไก แค่เป็นความคาดหวังพฤติกรรมในเอกสารนี้ก่อน)

## Human เขียนอะไร

เหมือน AI ทุกข้อ ยกเว้นข้อ 1 — มนุษย์ระบุ `source` เป็น `Owner Decision` ได้เมื่อเป็นการตัดสินใจจริง หรือ `External Document`/`Production` เมื่อเหมาะสม

## Query Pattern ที่ระบบจริงต้องการ

Runtime Mapping ไม่ได้นิยาม view ใหม่ (นั่นคือหน้าที่ของ Schema) แต่กำหนดว่า**เมื่อไหร่ต้องใช้ view ไหน**:

| สถานการณ์จริง | View ที่ต้องใช้ |
|---|---|
| Runtime กำลังจะตัดสินใจอะไรบางอย่างโดยอ้างอิง Knowledge | Active View เท่านั้น |
| AI ต้องการอธิบายว่า "ทำไม Rule X ถึงมีอยู่" | เดินกราฟ Link จาก Rule X ผ่าน caused_by/evolved_from |
| AI/มนุษย์ต้องการรู้ว่า "ตอนเดือน T ระบบใช้กฎอะไร" | Valid At (T) |
| AI/มนุษย์ต้องการดูสายวิวัฒนาการของกฎหนึ่งตัว | Rule Lineage |
| AI กำลังพิจารณาว่าจะเชื่อ Entry หนึ่งแค่ไหน | อ่าน source + confidence คู่กัน ไม่ใช่แค่ status |

## สิ่งที่ยังไม่ตัดสินใจ (เปิดไว้ตรงๆ ไม่เดา)

- ~~Knowledge Model จะถูกเรียกจาก DNA OS runtime code จริงจุดไหนก่อน~~ ตอบแล้ว: `scripts/deploy-gate.ts` (2026-07-18) — จุดต่อไปที่ยังไม่ตัดสินใจคือ `scripts/pre-commit-check.sh`/`scripts/record-validation.ts` (ขั้นก่อนหน้าใน Governance Lifecycle เดียวกัน) ควรเขียน Knowledge Entry ด้วยไหม หรือปล่อยให้ deploy-gate.ts เป็นจุดเดียวพอ (ยังไม่ตัดสินใจแทน)
- บทบาท (role-based) การเขียน/เปลี่ยน status — เช่น AI เขียนได้ทุกอย่างจริงไหม หรือบาง entry_type ต้องผ่าน human review ก่อน (เช่น Rule ใหม่ต้องมี owner ยืนยันก่อนเปลี่ยนเป็น Active เสมอไหม)
- ความสัมพันธ์กับ `registry/CHANGELOG.json`/`registry/rule-coverage.json` ที่มีอยู่แล้ว — จะ sync กันยังไง หรือค่อยๆ ย้าย authority มาที่ Knowledge Model ในอนาคต (นอกขอบเขตของเซสชันนี้ ตามที่ระบุไว้ใน KNOWLEDGE_MODEL.md ว่าไม่แตะ authority ของ registry เดิม)

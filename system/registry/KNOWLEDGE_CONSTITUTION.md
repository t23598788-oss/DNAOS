# DNA OS Knowledge Constitution

**สถานะ**: ร่าง — รอ owner ยืนยันว่านิ่งแล้วก่อนจึง apply Storage Adapter (`supabase/migrations/20260717000004_knowledge_schema.sql`) เข้า production จริง

**Layer**: นี่คือชั้น **Constitution** ของ Knowledge Model (ดู `registry/KNOWLEDGE_MODEL.md` สำหรับภาพรวม 4 ชั้น) — ตอบคำถาม **"ความหมายคืออะไร"** เท่านั้น ห้ามมีคำว่า SQL, Postgres, Supabase, table, column, view ปรากฏในไฟล์นี้ (ถ้าต้องพูดถึงรายละเอียดแบบนั้น ให้ไปที่ `KNOWLEDGE_SCHEMA.md` หรือ `KNOWLEDGE_RUNTIME_MAPPING.md` แทน)

**ความสัมพันธ์กับ Constitution ของระบบ**: เอกสารนี้อยู่**ต่ำกว่า** `registry/CONSTITUTION.json` เสมอ (ดู Rule 111/112) ถ้าวันหนึ่งขัดกัน `registry/CONSTITUTION.json` ชนะ

---

## Knowledge คืออะไร

**Knowledge** คือความรู้ที่ DNA OS สะสมจากการดำรงอยู่และทำงานจริง — ไม่ใช่ข้อมูลธุรกิจ (ลูกค้า, ใบแจ้งหนี้, เหตุการณ์) และไม่ใช่กฎที่ตายตัว (Constitution ของระบบ) แต่เป็น**ชั้นกลาง**ระหว่างสองสิ่งนั้น: สิ่งที่ระบบ*เรียนรู้*จากการทำงานจริง แล้วอาจนำไปสู่กฎใหม่หรือความสามารถใหม่ในภายหลัง

Knowledge ตอบคำถามว่า **"ทำไม"** ระบบถึงเป็นแบบนี้ — ไม่ใช่แค่ "ระบบเป็นแบบนี้" (หน้าที่ของโค้ด) และไม่ใช่แค่ "ระบบต้องเป็นแบบนี้" (หน้าที่ของ Constitution)

## Entry คืออะไร

**Entry** คือความรู้หนึ่งชิ้นที่แยกจากกันได้ มี 11 ประเภท:

| ประเภท | ตัวอย่างจริงจากเซสชันนี้ |
|---|---|
| Observation | AI สังเกตเห็น pattern ในข้อมูลจริง ก่อนมีใครตัดสินใจอะไรเกี่ยวกับมัน |
| Incident | send-document.ts เป็น parallel pipeline ของ sendInvoiceToLine() |
| Architecture Decision | Rule 111 — Extend Capability Never Duplicate Pipeline |
| Engineering Journal | บันทึกการ trace debt pipeline end-to-end |
| Lesson | getCurrentDebt() ใช้ anon client ทำให้ RLS บล็อกข้อมูลจริงทั้งหมด |
| Experience | บันทึกดิบของสิ่งที่เกิดขึ้นจริง ที่ Lesson ถูกกลั่นออกมาจากมัน (ต่างจาก Lesson ตรงที่ Lesson คือข้อสรุปที่อ้างอิงได้ ส่วน Experience คือหลักฐานดิบ) |
| Rule | Constitution Rule 111, 112 |
| Pattern | preview → token → execute (Rule 72 pattern ที่ gateway ใช้ซ้ำทุกจุด) |
| Commit | การ commit จริงที่แก้ incident |
| Deployment | การ deploy จริงหลัง commit |
| Validation | ผลการทดสอบ end-to-end ที่ยืนยันว่า fix ได้ผล |

ทุก Entry มี **Identity** ของตัวเอง — ไม่มี Entry ไหนดำรงอยู่เป็นส่วนหนึ่งของ Entry อื่น ทุกชิ้นอ้างอิงได้อิสระ

## Living Knowledge — วงจรที่ไม่ใช่คลังเอกสาร

Knowledge ไม่ใช่ archive ที่เขียนแล้วนิ่ง แต่เป็นวงจรที่หมุนต่อเนื่อง:

```
Observation → Decision → Implementation → Validation → Experience → Knowledge ใหม่
```

ตัวอย่างจริงจากเซสชันนี้: AI สังเกตว่า getCurrentDebt() คืนค่าว่างทั้งที่มีหนี้จริง (Observation) → owner ตัดสินใจว่าต้องสลับ client (Decision) → แก้ import จริง (Implementation) → รัน trace เทียบ 4 แหล่งข้อมูล (Validation) → บันทึกว่าทำไมถึงพลาดมาตลอด (Experience) → กลายเป็นความรู้ที่ใช้ป้องกันปัญหาเดียวกันในอนาคต (Lesson)

## ทุกความรู้ต้อง Actionable ได้

ทุก Entry ต้องระบุชัดว่าใครใช้ได้จริง — Runtime / AI / Human (แยกกัน 3 มิติ):

| ประเภทตัวอย่าง | Runtime | AI | Human |
|---|---|---|---|
| Rule | ✓ | ✓ | ✓ |
| Incident | ✗ | ✓ | ✓ |
| Deployment | ✗ | ✓ | ✓ |

ไม่ผูกตายตัวกับประเภท Entry เพราะมีข้อยกเว้นได้จริง (เช่น Pattern บางอันอาจ Runtime ใช้ได้ บางอันไม่ได้) — เป็นการตัดสินใจต่อ Entry ไม่ใช่ค่าที่คำนวณอัตโนมัติจากประเภท

## Knowledge Domain

ทุก Entry ต้องแท็กอย่างน้อย 1 domain จาก 8 ค่า: Architecture / Business / AI / Runtime / Infrastructure / Communication / Security / Finance — แท็กได้หลาย domain พร้อมกัน (เช่น Rule 111 เป็นทั้ง Architecture และ Communication) ช่วยให้กรองความรู้เฉพาะด้านได้ตรงๆ แม้ Entry จะมีเป็นล้านชิ้นในอนาคต

## Link คืออะไร

**Link** คือความสัมพันธ์ระหว่าง Entry สองชิ้น — นี่คือสิ่งที่ทำให้ Knowledge เป็น **Knowledge Graph** ไม่ใช่แค่บันทึกเหตุการณ์แยกกันหลายชนิด:

- **caused_by** — เกิดขึ้นเพราะ (decision caused_by incident)
- **resolved_by** — ถูกปิดโดย (incident resolved_by validation)
- **implements** — คือการทำจริงของ (commit implements decision)
- **evolved_from / superseded_by** — สายวิวัฒนาการ (rule evolved_from rule เดิม)
- **derived_from** — กลั่นออกมาจาก แต่ไม่ใช่การ refine โดยตรง (lesson derived_from incident)
- **contradicts** — ขัดแย้งกัน โดยไม่ตัดสินว่าใครถูก (decision B contradicts decision A)
- **references** — เชื่อมโยงแบบอ่อน ไม่มีนัยเรื่อง lifecycle

AI เดินตาม Link เพื่อตอบคำถามเช่น "ทำไม Rule 111 ถึงมีอยู่" ได้โดยไม่ต้องมีใครเขียนคำอธิบายซ้ำไว้ในทุก Entry

## Evolution คืออะไร

**Evolution ไม่ใช่ Entry ประเภทใหม่** — Evolution คือ**มุมมองหนึ่ง**เหนือ Entry+Link ที่มีอยู่แล้ว: การเดินตามสาย evolved_from/superseded_by ระหว่าง Entry ประเภท Rule เช่น Rule 97 → Rule 111 → Rule 143 (วิธีที่มุมมองนี้ถูก*คำนวณ*จริงเป็นหน้าที่ของ Runtime Mapping ไม่ใช่ของไฟล์นี้)

## Active คืออะไร / Historical คืออะไร

**Active** = ความรู้ที่ระบบถือว่าเป็นจริง ณ ตอนนี้ — Runtime อ่านได้เฉพาะความรู้ที่ Active เท่านั้น

**Historical** = ความรู้ที่เคยจริง ตอนที่เขียนไว้ไม่ผิด แต่ตอนนี้ไม่ใช่สถานะปัจจุบันของระบบอีกต่อไป — ไม่เท่ากับ "ผิด" (Deprecated) และไม่เท่ากับ "ถูกแทนที่โดยเฉพาะเจาะจง" (Superseded)

สถานะทั้ง 5: Active / Historical / Superseded / Deprecated / Rejected — แยกจาก **Validity** (ช่วงเวลาที่ความรู้นี้เป็นจริงในโลกจริง) โดยตั้งใจ: Status ตอบ "ตอนนี้ถือว่าจริงไหม" ส่วน Validity ตอบ "จริงในช่วงเวลาไหนของโลกจริง" ทำให้ตอบคำถามแบบ "ตอนเดือนพฤษภาคม 2026 ระบบใช้กฎอะไร" ได้ แม้กฎนั้นจะกลายเป็น Superseded ไปแล้วตอนนี้

## Knowledge Lifecycle

Lifecycle (Observed → Verified → Operational → Historical) **ไม่ใช่มิติแยกต่างหาก** — เป็นการอ่าน Status และ Confidence ร่วมกันในอีกมุมหนึ่ง ตั้งใจไม่ให้เป็นฟิลด์อิสระ เพราะจะเปิดช่องให้เกิดสภาวะที่ไม่มีความหมาย (เช่น "Operational" พร้อมกับ "Deprecated") — Lifecycle มีไว้อ่าน ไม่ใช่มีไว้เขียน

## Provenance และ Confidence

ทุก Entry ต้องระบุ:
- **Provenance** (ที่มา) — Owner Decision / AI Analysis / Incident / Production / External Document / Experiment
- **Confidence** (ความมั่นใจ) — Verified / Observed / Hypothesis / Experimental

สองมิตินี้แยกกันเพราะน้ำหนักความน่าเชื่อถือไม่เท่ากัน: Owner Decision มี Confidence สูงสุดเสมอโดยนิยาม (เป็นการตัดสินใจ ไม่ใช่การประมาณ) ส่วน AI Analysis/Production มีสเปกตรัมความมั่นใจได้ตั้งแต่ Verified ถึง Experimental — AI ต้องชั่งน้ำหนัก Entry ตามสองมิตินี้ ไม่ใช่ถือว่าทุก Entry ที่ Active มีน้ำหนักเท่ากันหมด

## ใครมีสิทธิ์เปลี่ยน Status

ใครก็ตาม (มนุษย์ หรือ AI) ที่มีสิทธิ์เขียนความรู้เข้าระบบได้ **แต่ทุกครั้งที่เปลี่ยน Status ต้องระบุเหตุผลและผู้เปลี่ยนเสมอ ไม่งั้นการเปลี่ยนแปลงต้องถูกปฏิเสธ** — ทุกการเปลี่ยนแปลงต้องถูกบันทึกไว้โดยไม่มีทางลืม (รอยตีนดิจิทัล)

ไม่มีการกำหนด "สิทธิ์ตามบทบาท" (เช่น "AI ห้ามเปลี่ยน status ของ Entry ที่มาจาก Owner Decision") ไว้ในตอนนี้ — เป็นเรื่องที่ต้องตัดสินใจแยกถ้าต้องการ (ยังไม่ตัดสินใจแทน ตามหลักการ "ห้ามเดา")

## ห้ามลบเพราะอะไร

เพราะ Knowledge คือ **DNA ของระบบ** (คำที่ owner ใช้เอง) — การลบความรู้คือการทำลายส่วนหนึ่งของตัวตนระบบอย่างถาวร ต่างจากการลบข้อมูลธุรกิจทั่วไปตรงที่ Knowledge แม้จะผิดหรือถูกแทนที่แล้ว ก็ยังมีค่าในฐานะหลักฐานว่า**เคยพิจารณาแนวทางนี้แล้วและทำไมถึงไม่เลือก** (ตัวอย่าง send-document-v2 ที่ถูก Rejected — มีค่าพอที่จะกันไม่ให้ใครเสนอซ้ำโดยไม่รู้ว่าเคยถูกปฏิเสธแล้ว)

นี่คือการต่อยอด Constitution Rule 104 (Nothing Is Wasted) ที่มีอยู่แล้ว ไม่ใช่กฎใหม่แยกขาด

---

## สิ่งที่ยังไม่ตัดสินใจ (เปิดไว้ตรงๆ ไม่เดา)

- สิทธิ์ตามบทบาทในการเปลี่ยน status (ดูหัวข้อด้านบน)
- ใครเป็นคนกำหนด identity ของ Entry แต่ละชิ้น (auto-generate แบบ `DNA-NNNNNN` เดิม หรือ manual)
- Retention: ไม่มีการลบ แปลว่าความรู้จะโตไม่มีที่สิ้นสุด — ยังไม่ได้ออกแบบการจัดการ scale สำหรับ 10 ปีข้างหน้าตามที่ owner กังวลไว้ (แค่กำหนดว่าห้ามลบ ยังไม่ได้ออกแบบว่าจะจัดการ scale ยังไง)
- ความสัมพันธ์กับ `registry/intent-dictionary.json` (Phase 0 เดิม) — ควร migrate เข้ามาเป็น Entry ประเภทใหม่ หรือคงเป็นไฟล์แยกต่อไป ยังไม่ตัดสินใจ

---

**ขั้นตอนถัดไป**: อ่านคู่กับ `registry/KNOWLEDGE_SCHEMA.md` และ `registry/KNOWLEDGE_RUNTIME_MAPPING.md` — เมื่อทั้ง 3 ไฟล์นิ่งแล้ว จึง apply Storage Adapter (`supabase/migrations/20260717000004_knowledge_schema.sql`)

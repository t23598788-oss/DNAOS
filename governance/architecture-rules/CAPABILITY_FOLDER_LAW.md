# Capability Folder Law

**status: LOCKED — PERMANENT ARCHITECTURE LAW OF DNA-OS-INFRASTRUCTURE**
**scope: บังคับกับคน, AI agent, และเครื่องมือทุกตัวที่สร้างหรือแก้ source
code ใน repo นี้ ไม่มีข้อยกเว้น**
**ประกาศ: Owner, 2026-08-14**
**amendment policy: การแก้ไขไฟล์นี้ต้องได้รับการยืนยันชัดเจนจากเจ้าของระบบ
เท่านั้น ไม่ใช่การตัดสินใจของ AI ฝ่ายเดียว — เทียบเท่าการแก้
`registry/connector-lifecycle.json` ใน dna-os-deadboard**

Formalizes and supersedes `README.md`'s file-organization rule 1
("1 หน้างาน = 1 โฟลเดอร์") and `architecture-rules/README.md`'s G-ARCH-003
with the full enforceable version below. G-ARCH-003 now points here as
the authoritative text.

---

## 1. Capability Folder มาก่อน Source File เสมอ

ทุก Capability / Function / Module ใหม่ต้องมี Capability Folder ของตัวเอง
สร้างขึ้นก่อน แล้วจึงสร้าง source file ใดๆ ภายในนั้น **ห้ามสร้างไฟล์ก่อน
แล้วค่อยสร้างโฟลเดอร์ทีหลัง** ไม่มีข้อยกเว้น รวมถึงห้าม "แก้ทีหลังให้ถูก" —
ลำดับต้องถูกตั้งแต่ commit แรกที่สร้างไฟล์นั้น

## 2. ห้ามกระจายไฟล์ใหม่ไว้นอกขอบเขต

ห้ามสร้างไฟล์ใหม่ไว้ที่ root หรือในโฟลเดอร์ของ capability อื่น โดยตั้งใจ
จะย้ายภายหลัง — "ย้ายทีหลัง" ไม่ใช่ทางออกที่กฎนี้ยอมรับ

## 3. โครงสร้างมาตรฐานของ Capability Folder หนึ่งตัว

```
<กลุ่มหลัก>/<ความสามารถ>/
  source ...
  contract ...
  config ...
  policy ...
  test ...
```

ตัวอย่าง: `connections/github-sync/` (ความสามารถซิงก์ GitHub) เก็บ source,
contract, config, policy, test และไฟล์ประกอบทั้งหมดของความสามารถนี้
**เท่านั้น** — ไม่ปนกับความสามารถอื่นแม้จะอยู่ใต้กลุ่มหลักเดียวกัน (เช่น
`connections/` มีหลาย capability folder ย่อยได้ แต่ละอันแยกขาดจากกัน)

## 4. ตรวจก่อนสร้างเสมอ (ต่อยอด dna-os-deadboard's Rule 101/103)

ก่อนสร้าง Capability Folder ใหม่ทุกครั้ง ต้องตรวจ:
1. มีความสามารถเดียวกันอยู่แล้วหรือไม่
2. มีความสามารถที่หน้าที่ทับซ้อนกันหรือไม่
3. มีไฟล์เดิมที่ทำหน้าที่เดียวกันอยู่ในโฟลเดอร์อื่นหรือไม่

## 5. พบซ้ำ → ห้ามสร้างใหม่ทันที ต้อง classify ก่อน

ถ้าตรวจข้อ 4 แล้วพบเข้าเงื่อนไข ต้องระบุสถานะอย่างใดอย่างหนึ่งก่อนตัดสินใจ
ต่อ:

- **`DUPLICATE`** — ทำหน้าที่เดียวกันเป๊ะ
- **`OVERLAPPING_CAPABILITY`** — ทำหน้าที่ทับซ้อนกันบางส่วน

แล้วตรวจ dependency ของทั้งสอง capability ก่อนตัดสินใจขั้นต่อไป — ห้าม
สร้างตัวใหม่เพิ่มระหว่างที่ยังไม่ผ่านขั้นตอนนี้

## 6. Merge เข้า canonical เมื่อพิสูจน์ว่าซ้ำจริง

ถ้า dependency validation พิสูจน์ว่าซ้ำจริง: เลือก capability เดิมที่จะเป็น
**canonical** เพียงตัวเดียว ย้ายเฉพาะสิ่งที่จำเป็นเข้า canonical แล้ว
**ลบ capability ที่ซ้ำทั้งโฟลเดอร์** — ลบได้ก็ต่อเมื่อ dependency
validation ผ่านแล้วเท่านั้น (ดู Gate ข้อ 10 ด้านล่าง)

## 7. เป้าหมาย: Capability หนึ่ง = หนึ่งหน่วยที่ดำเนินการได้ครบทุกอย่างในตัวเอง

Capability หนึ่งต้องสามารถ: **แก้** เป็นโฟลเดอร์, **ย้าย** เป็นโฟลเดอร์,
**test** เป็นโฟลเดอร์, **assign งาน** เป็นโฟลเดอร์, **rollback** เป็น
โฟลเดอร์, **ตรวจ dependency** เป็นโฟลเดอร์, **ลบ** เป็นโฟลเดอร์ — ถ้าการ
กระทำใดข้างต้นทำ "เป็นโฟลเดอร์เดียว" ไม่ได้ แปลว่าแบ่งขอบเขต capability
ผิดตั้งแต่แรก

## 8. ห้ามกระจาย implementation ข้าม capability โดยไม่มี contract

Capability หนึ่งห้ามกระจาย implementation ไปหลาย capability folder โดยไม่
มี contract ที่ประกาศไว้ชัดเจนเชื่อมระหว่างกัน (ดู `../../contracts/`)

## 9. การสื่อสารข้าม capability ต้องผ่าน public contract เท่านั้น

Capability หนึ่งเรียกใช้อีก capability หนึ่งได้เฉพาะผ่าน public
contract/interface/event/command ที่ประกาศไว้ใน `../../contracts/`
เท่านั้น — **ห้าม import ตรงเข้าไฟล์ implementation ภายในของอีก
capability folder เด็ดขาด** (เทียบเท่ากับ dna-os-deadboard's
"presenter/plugins ห้ามเรียก core หรือ plugin อื่นตรง")

## 10. Governance Gate (บังคับตรวจทุกครั้งที่มีการสร้าง/แก้/ลบ)

| เหตุการณ์ | ผล |
|---|---|
| Capability ใหม่ไม่มีโฟลเดอร์ของตัวเอง | **REJECT** |
| Source file ใหม่อยู่นอกขอบเขต capability boundary | **REJECT** |
| Capability ซ้ำ (DUPLICATE/OVERLAPPING_CAPABILITY) | **BLOCK + REVIEW** |
| การเข้าถึง implementation ข้าม capability folder ตรงๆ | **REJECT** |
| ลบ capability ที่ยังมี dependency ค้างไม่ได้ตรวจ | **BLOCK** |
| ลบ capability หลัง dependency validation ผ่านแล้ว | **อนุญาตให้ลบทั้งโฟลเดอร์** |

**สถานะการบังคับใช้จริงวันนี้:** เป็นกฎที่ประกาศแล้ว (LOCKED) แต่ยังไม่มี
mechanical checker ที่รัน gate นี้อัตโนมัติ — เหมือนกับหลายกฎใน
dna-os-deadboard ที่ระบุ `detection: "manual"` ตรงไปตรงมา จนกว่าจะมี
governance script จริง ผู้สร้าง (คนหรือ AI) ต้องตรวจตามกฎนี้เองก่อนทุกครั้ง

## 11. ขอบเขตการบังคับใช้

กฎนี้เป็นมาตรฐานถาวรสำหรับคน, AI agent, และเครื่องมือทุกตัวที่สร้างหรือ
แก้ source code ใน repo นี้ ห้าม bypass ด้วยการสร้างไฟล์ก่อนแล้วค่อยสร้าง
โฟลเดอร์ภายหลังไม่ว่ากรณีใด

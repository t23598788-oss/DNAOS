# governance/source-validation/ — G-VAL-004's ข้อ 9 slice: BUILT (2026-08-22)

ตรวจความถูกต้องของ Source Code — split มาจาก `governance/RULES.md` เดิม
+ กฎการจัดไฟล์ใหม่ (Owner, 2026-08-14)

## G-VAL-001 — ห้าม fabricate capability หรือ status

สิ่งที่ยังไม่ถูกสร้างและพิสูจน์จริงต้องระบุ `NOT_YET_BUILT` ชัดเจน ทั้งใน
code comment และในสถานะใดๆ ที่ระบบรายงานเกี่ยวกับตัวเอง ห้าม placeholder
ใดแสดงผลราวกับเป็น capability ที่ทำงานได้จริง

## G-VAL-002 — ห้ามสร้างข้อมูลธุรกิจจำลองเพื่อเติมโครง

ห้ามใส่ mock/fake business data (ชื่อบริษัทสมมติ, เลขบัญชีสมมติ ฯลฯ) แม้
เพื่อทำให้โครง "ดูสมบูรณ์" — โฟลเดอร์ที่ยังไม่มีเนื้อหาจริงให้เป็น README
เปล่าที่มี NOT_YET_BUILT ชัดเจนแทน

## G-VAL-003 — ห้าม migration/schema ของ Business Data ใน repo นี้

ไม่มี migration ใดใน repo นี้ที่แตะ business data — ถ้ามีวันหนึ่ง คือสัญญาณ
ว่าออกแบบผิดขอบเขต ไม่ใช่ feature ที่ควรมี

## G-VAL-004 — Governance Gate ของ Capability Folder Law

`REJECT` capability ใหม่ที่ไม่มีโฟลเดอร์ของตัวเอง, `REJECT` source file
ใหม่นอกขอบเขต capability, `BLOCK + REVIEW` เมื่อพบ capability ซ้ำ,
`REJECT` การเข้าถึง implementation ข้าม capability folder ตรงๆ, `BLOCK`
การลบ capability ที่ยังมี dependency ค้าง — ข้อความเต็มอยู่ที่
[`../architecture-rules/CAPABILITY_FOLDER_LAW.md`](../architecture-rules/CAPABILITY_FOLDER_LAW.md)
ข้อ 10

**สถานะ (2026-08-22 — Owner: "Deterministic Circuit Breaker", see
`/Users/tam/.claude/plans/zesty-spinning-ripple.md`):** หนึ่งใน 4 ข้อของ
G-VAL-004 ตอนนี้มี mechanical checker จริงแล้ว — `checkImportBoundaries()`
(`./boundary-checker.ts`) ตรวจข้อ "การเข้าถึง implementation ข้าม
capability folder ตรงๆ" จริง โดย parse import จริงทุกไฟล์ resolve เป็น
ไฟล์จริง แล้ว flag เมื่อ capability folder ต้นทาง-ปลายทางต่างกันและปลายทาง
ไม่ใช่ `contract.ts`/`contracts/` — วิธีเดียวกับที่
`../../reports/SYSTEM_JOINT_AND_SEARCH_WASTE_AUDIT_2026-08-22.md`'s
`joint_graph.cjs` เคยพิสูจน์มาแล้ว (179 joint จริง, 91 bypass จริง) ตอนนี้
ทำเป็น capability ที่ import ได้จริงแทนสคริปต์ครั้งเดียว ผู้เรียกหลักคือ
`../../control/circuit-breaker/`

**ยังไม่มี mechanical checker** สำหรับอีก 3 ข้อของ G-VAL-004 (capability
ใหม่ไม่มีโฟลเดอร์ของตัวเอง / source file นอกขอบเขต / capability ซ้ำ) — ตรวจ
ด้วยการ review เท่านั้น เหมือนเดิม

## ไฟล์ในโฟลเดอร์นี้

| ไฟล์ | ประเภท | หน้าที่ |
|---|---|---|
| `types.ts` | contract | `BoundaryViolation` |
| `boundary-checker.ts` | source | `checkImportBoundaries()` — parse+resolve+flag |
| `host-runtime.ts` | source | read-only ambient `fs`/`path` |
| `contract.ts` | contract | **the only file a caller outside this folder may import** |
| `tests/boundary-checker-proof.test.ts` | test | live proof against real, already-known files (one real violation, one real compliant call) |

## วิธีรัน

```
npx tsx governance/source-validation/tests/boundary-checker-proof.test.ts
```

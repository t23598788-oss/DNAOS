# control/duplicate-reservation/

**หน้าที่:** ปิด TOCTOU จริงระหว่าง Duplicate Check กับ Registry Write —
serialize เฉพาะ candidate ที่มี semantic fingerprint เดียวกัน ผ่าน
`execution/process-lock/` (`CAPABILITY_FINGERPRINT:<fingerprint>`) ไม่
reimplement fingerprint/duplicate-detection logic — ใช้
`../event-pipeline/contract.ts`'s `fingerprintCandidate` และ
`../registration-pipeline/contract.ts`'s `runRegistrationPipeline` ตรงๆ
ไม่แก้

**Input:** `RegistrationCandidate`, `storeFactory: () => RegistryStore`
(ไม่ใช่ store สำเร็จรูป — ดู ATOMIC AUTHORITATIVE READ/WRITE ด้านล่าง),
`correlation_id`, `holder_id`, `lease_ms`

**Output:** `ReserveAndRegisterResult` —
`RESERVED_AND_REGISTERED | RESERVATION_CONFLICT`

**Dependency ที่อนุญาต:** `../event-pipeline/contract.ts`
(`fingerprintCandidate` เท่านั้น — ห้าม `classifyCandidate`/
`resolveDuplicate`), `../registration-pipeline/contract.ts`
(`runRegistrationPipeline` เท่านั้น), `../../execution/process-lock/contract.ts`,
`../../software/registry-database/contract.ts` (type เท่านั้น)

**ATOMIC AUTHORITATIVE READ/WRITE (ปิด VERIFIED_GAP เดิมแล้ว, 2026-08-21):**
เดิม `software/registry-database/adapters/persistent-file-store.ts`
rehydrate จาก disk แค่ตอน construction แล้ว cache เป็น in-memory Map — สอง
store instance ที่แยกกัน สร้างก่อนอีกฝ่าย commit จะไม่เห็นกัน ปิดโดย
**เปลี่ยนพารามิเตอร์จาก store สำเร็จรูป เป็น `storeFactory`** — ฟังก์ชันนี้
เรียก `storeFactory()` เพื่อสร้าง store **ใหม่จริง หลังจาก lock ได้แล้ว
เท่านั้น** เพราะทุก store adapter ที่มีอยู่แล้ว (`local-file-store.ts`,
`persistent-file-store.ts`) rehydrate จาก disk จริงตอน construction อยู่
แล้ว (ของเดิม ไม่แก้) — การสร้างใหม่หลัง lock จึงเห็นข้อมูลล่าสุดจริงเสมอ
เหมือนกับที่ `execution/process-lock/`'s `O_CREAT|O_EXCL` รับประกัน
ลำดับข้าม process จริงอยู่แล้ว **ไม่มี store/registry ตัวใหม่** — adapter
เดิมทุกอย่าง แค่เปลี่ยนจังหวะสร้าง instance ให้ตรงกับตอนที่ authoritative
จริง พิสูจน์แล้วด้วย `tests/duplicate-reservation.test.ts` test D/E (แก้ไข
ใหม่: ตอนนี้ 15 process จริงเห็นกันครบ REGISTERED แค่ 1 เท่านั้น)

**สิ่งที่ห้ามแตะ:** ห้ามเรียก `classifyCandidate`/`resolveDuplicate`/
`commitRegisteredCandidate` ตรงๆ — ต้องผ่าน `runRegistrationPipeline`
เท่านั้น ห้ามปล่อย fingerprint lock ค้างไม่ว่าผลจะสำเร็จหรือ fail
(`finally` block) ห้ามสร้าง capability_id ใหม่ 100 ตัวแล้วค่อย merge —
100 concurrent candidate fingerprint เดียวกัน ต้องมีแค่ 1 รายที่เข้าถึง
`runRegistrationPipeline` จริง ที่เหลือได้ `RESERVATION_CONFLICT` ทันที
ไม่เรียก pipeline เลย **ห้ามเรียก `storeFactory()` ก่อนได้ lock** — จะทำให้
gap เดิมกลับมาโดยไม่รู้ตัว

# DNA OS Dev Loop Verification Handoff

สถานะนี้เป็นการตรวจแบบไม่ deploy และไม่แก้ registry หลัก

## สิ่งที่พิสูจน์แล้ว

รันด้วย:

```text
npx tsx scripts/verification/dev-loop-e2e-harness.ts
```

- Session Manifest: PASS — สร้าง session ใน memory adapter
- Evidence Store: PASS — สร้าง SHA-256 จาก temporary fixture
- Impact Analyzer decision: PASS — dependent ของไฟล์ที่ยังไม่ลงทะเบียนถูกตัดสินเป็น `fail`
- Proposed Registry Patch: PASS — สร้าง proposal สถานะ `pending` ใน memory เท่านั้น
- Deploy Gate wiring: PASS — ตรวจพบการอ่านผล dev-loop และ pending proposal ใน source
- Cleanup: PASS — temporary fixture ถูกลบหลังทดสอบ

ไฟล์ทดสอบคือ `scripts/verification/dev-loop-e2e-harness.ts` และไม่เขียน
`registry/*.json`, ไม่เรียก Supabase จริง และไม่เรียก deployment command

## สิ่งที่ยังไม่ควรอ้างว่าเสร็จสมบูรณ์

- ยังไม่ได้พิสูจน์ watcher กับ Supabase จริง เพราะต้องเปิด session/เขียน evidence จริง
- ยังไม่ได้รัน `scripts/impact-analyzer.ts` กับตารางจริง
- ยังไม่ได้รัน Deploy Gate จริงตามคำสั่งพัก deploy
- ยังไม่มี dry-run adapter สำหรับ Deploy Gate ที่แยกจาก state จริงของ repository

## ผลตรวจ typecheck

`npx tsc --noEmit` ยังไม่ผ่านจากไฟล์ใน working tree ของงานอื่น:

- `.next/types/cache-life.d 2.ts` และ `.next/types/routes.d 2.ts` เป็น generated duplicate artifacts
- `app/admin/system/page 2.tsx` และ `app/admin/system/page.tsx` มี type mismatch เดียวกันที่ prop `embedded`
- environment นี้ไม่อนุญาตให้เขียน `tsconfig.tsbuildinfo`

รายการข้างต้นยังไม่ได้แก้ เพราะเป็นไฟล์ที่มีการแก้/สร้างโดย AI อื่นและอาจกำลังใช้งานอยู่

## เงื่อนไขก่อนทดสอบจริงหรือ deploy

1. เจ้าของยืนยันว่าจะเก็บหรือแยกไฟล์ duplicate artifacts เหล่านี้อย่างไร
2. งาน AI ที่กำลังแก้ `dev-loop`, `integration-gateway`, migration และ governance ต้องหยุดหรือส่งมอบก่อน
3. เพิ่ม dry-run/approval boundary สำหรับการทดสอบกับ Supabase จริง
4. แก้ typecheck failures แล้วรัน verification suite ใหม่
5. Deploy ต้องรอคำสั่งอนุมัติแยกต่างหาก

## Automatic problem report / owner alert

`engines/workspace/problemReport.ts` เป็นขอบเขตรายงานเท่านั้น: เมื่อ
`scripts/deploy-gate.ts` พบ validation failure, Dev Loop block หรือค่า
environment ที่จำเป็นหาย จะสร้าง `local-runtime/dev-loop-problem-report.json`,
บันทึกสถานะล่าสุดผ่าน `system_health_status.detail` เมื่อมี Supabase และส่ง
`DEV_LOOP_PROBLEM_REPORTED` พร้อม `owner_alert.spoken_summary` ให้ Governance UI
นำเสนอได้ รายงานซ้ำ fingerprint เดิมภายใน 10 นาทีจะถูก deduplicate และ run ที่
ผ่านจะเปลี่ยนรายงานเดิมเป็น `resolved` แทนการสร้างรายงานใหม่

การแจ้งเตือนนี้เป็น payload สำหรับ DNA OS conversation/UI ไม่ใช่การเปิดเสียงจาก
background process: ขณะ conversation ยังเปิดอยู่ coordinator สามารถถ่ายทอดสรุป
งานได้ แต่ session เสียงที่ปิดไปแล้วไม่สามารถถูกเปิดหรือพูดเข้าไปโดยอัตโนมัติได้

## Local voice presentation

`/admin/dev-loop` ใช้ `components/admin/ttsSpeak.ts` เดิมและ browser/Tauri local
speech เท่านั้น ปุ่ม `เสียงแจ้งเตือน` ปิดเป็นค่าเริ่มต้นและเก็บ opt-in ใน browser
localStorage; จะพูดเฉพาะ report ใหม่ระดับ `critical` ขณะหน้าเปิดอยู่ ไม่พูดซ้ำ
report ID เดิม และแสดง resolved report แบบข้อความเท่านั้น ทั้งนี้ browser อาจ
บล็อกการพูดจาก timer ตาม autoplay policy จึงต้องเปิดสวิตช์ด้วยการคลิกของผู้ใช้
ก่อน และระบบไม่เปิด voice call ที่ปิดไปแล้ว

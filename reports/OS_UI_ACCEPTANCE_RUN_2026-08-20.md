# OS-UI Full Acceptance Run

สถานะ: `VERIFIED_REAL_SANDBOX_RUN`

## ผลการรันจริง

รันผ่าน `POST http://127.0.0.1:8791/command` จำนวน 15 Work Orders

| เหตุการณ์ | ผลลัพธ์ |
|---|---|
| เปิด VS Code | COMPLETED / FOCUSED |
| เปิด `hello.txt` ด้วย VS Code | COMPLETED / opened_with_app=vscode |
| คลิก editor | COMPLETED / Accessibility OK |
| พิมพ์ marker จริง | COMPLETED |
| คลิกกลับก่อนบันทึก | COMPLETED |
| บันทึกด้วย COMMAND+S | COMPLETED |
| รอ flush | COMPLETED |
| อ่านหน้าจอ | COMPLETED / Code / hello.txt / confidence=1 |
| พูดข้อความ | COMPLETED / say=OK |
| เพิ่มเสียง | COMPLETED |
| ลดเสียง | COMPLETED |
| สลับแอปแบบ dry-run | COMPLETED / ไม่เรียก OS จริง |
| path นอก scope | BLOCKED / PATH_OUT_OF_SCOPE |
| credential surface | BLOCKED / CREDENTIAL_SURFACE_DENIED |
| replay | COMPLETED / idempotent replay, ไม่ execute ซ้ำ |

## ผล filesystem

- `dna-os-acceptance-run-20260820` พบจริง `1` ครั้ง
- marker ที่ห้าม execute ซ้ำพบ `0` ครั้ง

## Audit

- audit records ก่อนรัน: `297`
- audit records หลังรัน: `312`
- เหตุการณ์ที่เพิ่ม: `15`
- แหล่งหลักฐาน: `connections/os-ui/data/work-order-audit.jsonl`
- screen-read artifact: ถูกบันทึกและ redacted ตามสัญญาเดิม

## การรับรู้และการเรียนรู้

ระบบรับรู้และบันทึกได้แล้ว: แอปที่อยู่หน้า, ชื่อหน้าต่าง/ไฟล์, active state, confidence, action, outcome, evidence, blocked reason และ replay state

ระบบยังไม่มี adaptive learning ที่แก้ policy หรือเขียนกฎใหม่เอง การเรียนรู้ที่ปลอดภัยในรอบนี้คือการสะสม event history และ pattern ที่ตรวจสอบย้อนกลับได้เท่านั้น การเปลี่ยน policy ต้องผ่าน validator, evidence และ Owner approval เดิม

## Runtime

- `http://127.0.0.1:8791/health` ตอบ `{"ok":true}`
- launchd transport: `running`
- focused tests: `24 passed, 0 failed`
- ขอบเขต: sandbox/VS Code เท่านั้น ไม่ใช่ production business-code deployment

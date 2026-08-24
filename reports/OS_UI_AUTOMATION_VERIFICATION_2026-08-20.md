# DNA OS OS-UI Automation Verification

สถานะ: `VERIFIED_SANDBOX_ONLY`

วันที่ตรวจ: 2026-08-20

## ขอบเขต

ตรวจวงจรเดิมของ capability `os-ui` ผ่าน transport `owner-command-http:8791` โดยใช้ไฟล์ sandbox:

`control/agent-host/test-workspace/allowed/hello.txt`

ไม่แตะ production business code และไม่อ่านหรือป้อน credential, password, MFA หรือ Keychain data

## เส้นทางที่พิสูจน์แล้ว

`Owner command -> owner-command-http:8791 -> command-router -> os-ui -> macOS Accessibility -> VS Code editor -> audit evidence -> filesystem readback`

ขั้นตอนที่ผ่านจริง:

1. เปิดไฟล์ด้วย `open_path` พร้อม `app: vscode` เพื่อบังคับใช้ VS Code ไม่ใช่ default handler ของ macOS
2. คลิก editor ด้วย bounded coordinate ผ่าน Work Order ที่ผ่าน validator
3. พิมพ์ข้อความ sandbox
4. คลิก editor ซ้ำก่อนบันทึก เพื่อกัน focus drift ไปยัง webview
5. กด `COMMAND+S`
6. รอ flush
7. อ่านไฟล์จาก filesystem และตรวจค่าที่เปลี่ยนจริง

## หลักฐาน

- TypeScript compile: ผ่าน
- OS-UI focused tests: `24 passed, 0 failed`
- Live Work Orders: `open_path`, `click`, `type`, `key`, `wait` คืน `COMPLETED`
- Live readback รอบบันทึก: พบค่า `dna-os-repeat-v15` ในไฟล์จริง
- Idempotency replay: Work Order เดิม `repeat-type-v15` คืน `idempotent replay — not re-executed`
- ตรวจจำนวน occurrence ของ `dna-os-repeat-v15`: `1` ครั้ง จึงไม่เกิด duplicate execution
- Audit source: `connections/os-ui/data/work-order-audit.jsonl`
- Runtime supervisor: `com.dnaos.owner-command-http` ผ่าน launchd, state `running`, exit code ล่าสุด `0`
- Capability registration: `os-ui` มีอยู่แล้วใน `control/command-router/capability-registry.ts` และใช้ contract `connections/os-ui/adapter-contract.ts`

## Safety gates ที่ตรวจแล้ว

- path นอก scope ถูก `BLOCKED`
- path traversal ถูก `BLOCKED`
- credential/MFA/Keychain surface ถูกปฏิเสธแบบแก้ไม่ได้ด้วย `risk_confirmed`
- click/type/key เป็น HIGH-risk และต้องมี `risk_confirmed`
- dry-run ไม่เรียก OS จริง
- replay ด้วย idempotency key ไม่ execute ซ้ำ

## ข้อจำกัดการประกาศ

เอกสารนี้ประกาศได้เฉพาะ `VERIFIED_SANDBOX_ONLY` สำหรับ VS Code และไฟล์ sandbox ที่ระบุข้างต้นเท่านั้น ไม่ใช่การอนุมัติ production business-code writing และไม่ใช่การรับรองการควบคุมแอปหรือไฟล์อื่นโดยอัตโนมัติ

# OS-UI Real Command Run

สถานะ: `VERIFIED_SANDBOX_REAL_COMMAND`

วันที่: 2026-08-20

## Scenario

คำสั่งทั้งหมดถูกส่งผ่าน `http://127.0.0.1:8791/command` ไม่ได้เรียก adapter ภายในโดยตรง

1. `open_app(vscode)` — `COMPLETED`, หน้าต่างเดิมถูกนำมาโฟกัส (`FOCUSED`)
2. `open_path(hello.txt, app=vscode)` — `COMPLETED`, เปิดด้วย VS Code (`opened_with_app=vscode`)
3. `click` bounded coordinate `{x:450,y:300}` — `COMPLETED`, macOS Accessibility `OK`
4. `type(dna-os-real-command-test-20260820)` — `COMPLETED`
5. click editor ซ้ำก่อน save — `COMPLETED`
6. `COMMAND+S` — `COMPLETED`
7. `wait` — `COMPLETED`
8. `read_screen` — `COMPLETED`, app `Code`, title `hello.txt — DNA-OS-INFRASTRUCTURE`, confidence `1`
9. อ่าน filesystem กลับ — marker พบจริง `1` ครั้ง

## Failure and safety events

- `open_path(/etc/passwd)` — `BLOCKED`, reason `PATH_OUT_OF_SCOPE`, ไม่มี OS call
- true idempotency replay ด้วย key `real-type_real_marker-20260820` — `COMPLETED` จาก cache, `idempotent_replay=true`, ไม่ execute ซ้ำ
- replay payload ที่ต่างจากครั้งแรก (`SHOULD_NOT_EXECUTE_ON_TRUE_REPLAY`) พบในไฟล์ `0` ครั้ง

## Evidence stores

- `connections/os-ui/data/work-order-audit.jsonl`
- `connections/os-ui/data/screen-reads/read-1787190966555-0p4djm.json`
- `control/agent-host/test-workspace/allowed/hello.txt`

## Runtime

- transport health: `{"ok":true}`
- supervisor: `com.dnaos.owner-command-http` via launchd, `state=running`
- focused tests: `24 passed, 0 failed`

ขอบเขตการรับรอง: sandbox file และ VS Code เท่านั้น ไม่ใช่ production business-code deployment

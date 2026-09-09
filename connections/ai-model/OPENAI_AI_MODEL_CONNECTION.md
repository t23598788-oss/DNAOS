# OpenAI / AI Model → DNA OS MCP Connection

Canonical document ID: `connection.ai-model.dna-os-mcp.v1`  
Machine source of truth: [connection-document.json](./connection-document.json)  
Index projection: [DNA OS Connection Index](../connection-index/INDEX.md)

## สรุปสำหรับ Owner

โมเดล AI ทำหน้าที่เป็นผู้ร้องขอและผู้ให้เหตุผลเท่านั้น ส่วน DNA OS เป็นผู้ถืออำนาจและผู้ดำเนินการจริง โมเดลส่งคำสั่งผ่าน MCP ที่มีอยู่แล้ว ไม่ได้ถือ Owner identity, ไม่ได้ mint session, ไม่ได้เลือก permission, ไม่ได้สร้าง capability/task id และไม่ได้เขียน registry โดยตรง

สถานะรวมของเอกสารนี้คือ `CONNECTED`: เส้นทาง generic external model → MCP → DNA OS มีอยู่และต่อถึงเส้นทางที่ live-verified แล้ว แต่ยังไม่มี OpenAI provider API adapter/model router/model registry ที่ implement อยู่ใน repository นี้ ดังนั้น boundary ของ OpenAI provider โดยตรงคือ `NOT_WIRED` และ `NOT_VERIFIED`.

เส้นทางที่พิสูจน์แล้วคือ:

`External AI requester → MCP /mcp หรือ stdio → submit_command → DnaOsHttpClient → POST /owner/submit-command → validateOwnerSession → resolveOwnerIdentity → submitOwnerCommand → routeOwnerCommand → Capability Registry → agent-host → LOCAL worker → isolated worktree → result/evidence → MCP response`

## จุดตรวจอำนาจ

1. MCP export policy กรองการ discover/invoke เครื่องมือ
2. `x-dna-os-owner-session` เป็นเพียง pointer; Core ต้องเรียก `validateOwnerSession`
3. session ต้อง active, ไม่หมดอายุ, ไม่ถูก revoke และมาจาก `human-verification`
4. `resolveOwnerIdentity` ผูกตัวตน human ที่ยืนยันแล้ว ไม่รับ identity จาก model เป็น authority
5. `submitOwnerCommand` และ router ใช้ Owner identity, registry และ execution policy เดิม
6. Agent Host จำกัด worker, operation และ write path; worker ทำงานใน isolated worktree
7. ผลลัพธ์ต้องถูก correlate และ verify ก่อนเป็น `ACCEPTED/COMPLETED`

ถ้า gate ใดปฏิเสธ คำขอจะหยุดแบบ fail-closed และผลปฏิเสธ/เหตุผลจะถูกคืนกลับเป็นผลจริง ไม่ถูกยกระดับเป็นความสำเร็จโดย MCP หรือโมเดล

## สถานะสำคัญ

| Boundary | สถานะ |
|---|---|
| MCP host และ generic model tool ingress | `CONNECTED` |
| MCP `submit_command` → `DnaOsHttpClient` | `VERIFIED` |
| Core HTTP Authorization | `VERIFIED` |
| Owner session binding / identity | `VERIFIED` |
| `submitOwnerCommand` / router / Capability Registry | `VERIFIED` |
| agent-host / LOCAL worker / isolated worktree | `VERIFIED` |
| result/evidence return → MCP | `VERIFIED` |
| model output safety contract | `CONNECTED` |
| direct OpenAI provider API | `NOT_WIRED` / `NOT_VERIFIED` |
| `execution.run` from Owner Command | `NOT_WIRED` / `NOT_VERIFIED` |

## Credential references

เอกสารนี้ไม่บันทึกค่า secret ใด ๆ มีเพียงชื่อ reference และวิธี resolve:

- `OWNER_COMMAND_HTTP_SHARED_SECRET`: process environment ของ trusted local transport client; ใช้ยืนยัน network client ไม่ใช่ Owner authority
- `DNA_OS_OWNER_SESSION_ID`: process environment สำหรับ stdio session pointer; Core ยังตรวจซ้ำ
- `x-dna-os-owner-session`: request header ที่ชี้ไปยัง Owner session store
- `credential://anthropic/owner/agent-runtime`: มี metadata ใน credential registry และ resolve ผ่าน macOS Keychain metadata แต่ยังไม่มี provider adapter ใน repo นี้ที่นำไปใช้
- ไม่พบ OpenAI credential reference หรือ OpenAI API caller ที่ implement ใน repository นี้

## Evidence ที่ตรวจสอบได้

- Owner command: `cmd_2f4cffcb-b7cc-40f0-a5f3-f062646e52db`
- Work: `work-9f13084e-84f0-4462-8b2a-d9e6b96965d9`
- Owner-command task: `task-6c5c2bf5-9b8c-420d-be10-b1a3cd77eb17`
- Agent-host task: `task-cmd_2f4cffcb-b7cc-40f0-a5f3-f062646e52db-agent-host`
- Agent launch: `agent-launch-4aff06ce-d2f8-41dd-8b05-e5cb016b4904`
- Result: `result-995507d6-5414-4897-8831-8e5db34d9a35`
- Worker lifecycle: `COMPLETED`

หลักฐานเหล่านี้พิสูจน์ MCP → DNA OS → worker/result path; ไม่ได้พิสูจน์ direct OpenAI API call. Voice-bridge `COMPLETED` ที่เคยตรวจสอบแล้วเป็น in-process path คนละ boundary จึงไม่ถูกนับเป็น OpenAI/MCP provider evidence.

## Failure modes และขอบเขตที่ยังไม่ต่อ

- MCP framing/transport ผิด หรือ export policy ไม่อนุญาต → tool ไม่ถูก expose/ถูกปฏิเสธ
- session หาย, revoked, expired หรือไม่ใช่ human verification → authentication/authority gate ปฏิเสธ
- command ว่าง, command ไม่รู้จัก, ambiguous หรือ capability unavailable → 400/`UNSUPPORTED_COMMAND`/`OWNER_REVIEW`/`BLOCKED`
- worker, sandbox, source reservation, verification หรือ result contract ผิด → task fail/blocked; ไม่รับเป็น completed
- `execution.run` ยัง `NOT_WIRED / NOT_VERIFIED` เพราะ live Owner ingress ไม่ส่ง `executionRequestBase`
- direct OpenAI provider API ยัง `NOT_WIRED`; ไม่มีการเดา endpoint, caller หรือ credential

รายละเอียด semantic ของทุก boundary, schema, source reference, evidence reference และ status อยู่ใน machine record เดียว [connection-document.json](./connection-document.json) ซึ่งเป็น source of truth ของ projection นี้

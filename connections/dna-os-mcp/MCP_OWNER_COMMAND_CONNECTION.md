# DNA OS MCP → Owner Command Connection

Canonical document ID: `connection.mcp.owner-command.v1`

This is the human/developer projection of the machine-readable semantic record in [connection-document.json](./connection-document.json). The JSON record is the source of truth; this Markdown file is not an independent contract.

## สรุปสำหรับมนุษย์

เอกสารนี้อธิบายเส้นทางที่โมเดลหรือเครื่องมือภายนอกส่งคำสั่งเข้ามาทาง MCP แล้วเข้าสู่ Owner command system ของ DNA OS ผ่านเส้นทางจริงที่มีอยู่แล้ว:

`External Model / AI → MCP host → submit_command → DnaOsHttpClient → Core HTTP → x-dna-os-owner-session → validateOwnerSession → resolveOwnerIdentity → submitOwnerCommand → routeOwnerCommand → Capability Registry → capability → result/task/evidence → MCP response`

MCP เป็นเพียง boundary และ adapter ไม่ใช่ brain ใหม่ คำสั่งถูกส่งต่อไปยัง `POST /owner/submit-command` ของ Core ที่ `127.0.0.1:8791` โดยใช้ shared-secret reference สำหรับ trusted transport และใช้ Owner session pointer สำหรับ authority จริง ค่า secret ไม่ได้ถูกบันทึกในเอกสารนี้

ก่อนจะเห็นหรือเรียก `submit_command` ต้องผ่าน MCP export policy และเมื่อถึง Core ต้องมี session ที่ `validateOwnerSession` ตรวจผ่านว่า active, ไม่หมดอายุ, ไม่ถูก revoke และมาจาก `human-verification` เท่านั้น header จึงเป็นเพียง pointer ไปยัง store ไม่ใช่หลักฐานด้วยตัวเอง หาก gate ใดปฏิเสธ คำสั่งจะหยุดแบบ fail-closed และไม่ไปถึง Owner command หรือ worker

เมื่อผ่านแล้ว Core จะสร้าง Owner identity จาก session ที่ยืนยันแล้ว ไม่เชื่อ identity ที่โมเดลใส่ใน arguments จากนั้น `submitOwnerCommand` สร้าง envelope และเรียก `routeOwnerCommand` เพื่อ match กับ capability registry ถ้าไม่พบหรือกำกวมจะได้ `UNSUPPORTED_COMMAND` หรือ `OWNER_REVIEW` แทนการเดา

เส้นทางที่ live-verified ในเอกสารนี้เลือก capability `agent-host` จากนั้นสร้าง task/workspace, dispatch ผ่าน `runAgentWorkOrder`, ใช้ worker `LOCAL`, ผูก source reservation กับ isolated worktree, รับผล, ตรวจ verification และปิด lifecycle เป็น `COMPLETED` พร้อม evidence กลับไปที่ task และผล MCP

## เส้นทาง worker ที่ยืนยันแล้ว

`routeOwnerCommand → agent-host → runAgentWorkOrder → LOCAL worker → isolated worktree → result → evidence → COMPLETED`

หลักฐาน live ที่ผูกกับเส้นทางนี้:

- command: `cmd_2f4cffcb-b7cc-40f0-a5f3-f062646e52db`
- work: `work-9f13084e-84f0-4462-8b2a-d9e6b96965d9`
- Owner-command task: `task-6c5c2bf5-9b8c-420d-be10-b1a3cd77eb17`
- agent-host task: `task-cmd_2f4cffcb-b7cc-40f0-a5f3-f062646e52db-agent-host`
- launch: `agent-launch-4aff06ce-d2f8-41dd-8b05-e5cb016b4904`
- result: `result-995507d6-5414-4897-8831-8e5db34d9a35`
- terminal state: `COMPLETED`; worker: `LOCAL`

รายละเอียดทุก boundary รวมถึง schema, failure mode, source reference, evidence reference และสถานะอยู่ใน JSON canonical record

## สถานะสำคัญ

- `VERIFIED`: MCP → Core Owner ingress, authentication/identity gates, Owner command routing, registry resolution, agent-host dispatch, LOCAL launch, isolated worktree, result/evidence verification และ response projection
- `CONNECTED`: capability registry ระบุ `agent-host` เป็น `health_status: CONNECTED`; live evidence ยืนยันการใช้งานจริงใน command นี้
- `NOT_WIRED / NOT_VERIFIED`: `execution.run` จาก live `POST /owner/submit-command` ยังไม่มี `executionRequestBase` จึงไม่อ้างว่า execution.run ทำงานสำเร็จ router ระบุว่าจะ block เมื่อไม่มี `executionPolicyContext` หรือ `executionRequestBase`
- `BLOCKED`: เป็นผลลัพธ์ที่ระบบใช้เมื่อ gate หรือ policy ปฏิเสธ เช่น session ไม่ผ่าน, capability ไม่พบ/กำกวม, worker unavailable หรือ execution context ขาด
- `NOT_WIRED`: ใช้กับ path ที่ไม่มี runtime caller ที่ยืนยันแล้ว ไม่ควรเปลี่ยนเป็น `VERIFIED` จากการมี source code หรือ unit test เพียงอย่างเดียว

## In-process กับ worker dispatch

ก่อนหน้านี้มี voice-bridge path ที่ยืนยันเป็น `COMPLETED` ซึ่งเป็น capability result แบบ in-process ส่วนเอกสารนี้ยืนยัน agent-host path ที่มี process launch, workspace isolation, result normalization และ verification แยกกัน จึงไม่ควรนำหลักฐานของ voice-bridge ไปตีความว่าเป็นหลักฐานของ worker dispatch หรือ `execution.run`

## วิธีทำเอกสาร connection ถัดไป

ใช้รูปแบบเดียวกันนี้: สร้าง semantic record เดียวที่มี `document_id`, nodes/path, boundary ครบทุก cross-module หรือ cross-system transition, contract, transport, endpoint, authentication, authority, input/output, state, source, evidence, failure modes และ verification status จากนั้นทำ human/developer projections ที่ชี้กลับไปยัง record เดียวกัน ห้ามคัดลอก secret values และห้ามทำ narrative แยกที่อาจ drift จาก machine record

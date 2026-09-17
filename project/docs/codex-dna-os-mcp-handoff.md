# Codex → DNA OS MCP Governance Gateway

สถานะ: source implementation พร้อมตรวจแบบ no-deploy; ยังไม่เปิดใช้งาน production และยังไม่แก้ registry หลัก

## Surface ที่เพิ่ม

- `dna-os-mcp-server/src/governanceServer.ts` — MCP tools แบบ read/proposal-only
- `dna-os-mcp-server/src/index-governance-http.ts` — Streamable HTTP entrypoint แยก port จาก MCP เดิม
- `dna-os-mcp-server/src/governanceHttp.ts` — HTTP client ไปยัง DNA OS เท่านั้น
- `app/api/v1/mcp/governance/*` — server-side DNA OS gateway routes
- `docs/codex-dna-os-mcp-handoff.md` — เอกสารรับมอบ

## Tool boundary

- `governance.read_status`
- `governance.propose_session`
- `governance.propose_registry_patch`
- `governance.read_impact`
- `governance.read_deploy_approval_status`

ไม่มี tool สำหรับ deploy, commit, push, registry write หรือ approval

## Authorization

- MCP transport ต้องมี `MCP_SERVER_ACCESS_TOKEN`
- DNA OS route ต้องมี `X-DNA-Token` ที่ยังไม่ถูก revoke
- อ่านใช้ scope `read` / `governance:read`
- proposal ใช้ scope `governance:propose` และ owner ถูกอ่านจาก token ฝั่ง server ห้ามให้ model ระบุแทน
- registry proposal ต้องผูก session + evidence event + impact check เดิม และบันทึกเป็น `pending` เท่านั้น

## Verification

- `npx tsc -p . --noEmit` ใน `dna-os-mcp-server`: PASS
- สร้าง MCP governance server smoke test: PASS
- Dev-loop isolated harness: PASS
- ไม่เรียก OpenAI API, ไม่เรียก DNA OS จริง, ไม่ deploy และไม่เขียน registry หลัก

## ยังต้องอนุมัติก่อนเปิดใช้จริง

1. เพิ่ม MCP manifest/registry entries หลัง Owner review เท่านั้น
2. Provision token scope `governance:propose` ผ่านกลไกที่ Owner อนุมัติ
3. ยืนยันและ apply migration `20260805000001_dev_loop_pipeline.sql` ใน environment ที่ต้องการใช้งาน
4. ทดสอบกับ DNA OS/Supabase จริงแบบ bounded test
5. ให้ Conversation layer เรียก gateway นี้เป็นประตูเดียวก่อนส่งคำสั่งไป AI หรือ action layer

OpenAI integration อยู่นอก scope และยังไม่ถูกสร้างหรือทดสอบ

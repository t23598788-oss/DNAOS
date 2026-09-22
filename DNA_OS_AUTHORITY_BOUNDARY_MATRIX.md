# DNA OS AUTHORITY & BOUNDARY MATRIX (PHASE 2)

> คู่กับ `DNA_OS_SYSTEM_OPERATING_GRAPH.md` · machine: `registry/DNA_OS_SYSTEM_OPERATING_GRAPH.json`
> **นี่คือ "เพดาน" ของทุกตัวที่แตะระบบ** — ทุกบรรทัดมาจากของจริง: `CONSTITUTION.json` (amendment_policy/iron_rules), `permissions.json` (role_tiers/route_access), `EXECUTION_CONTRACT.json`, `worker-tool-registry.json` (per-tool policy), `destructive_action_log`, owner passkey/verification
> หลักการเดียว: **AI/เครื่องมือ = ผู้เสนอและผู้ทำงานในขอบเขต · Owner = ผู้อนุมัติ · DB/ledger = ความจริง**

## 1. Matrix: actor → สิทธิ์ / ห้าม / ต้องอนุมัติ / ซ่อมได้ถึงไหน
| Actor | อ่านได้ | เขียนได้ | ห้าม (must_not_do) | ต้องมี owner approval เมื่อ | ซ่อมได้ถึงขอบเขต |
|---|---|---|---|---|---|
| **Owner (เฮีย)** | ทุกอย่าง | ทุกอย่างผ่านเส้นที่กำหนด | ทำลายหลักฐาน ledger/audit | — | ทั้งระบบ |
| **Cline (dev/repair worker)** | approved source scope + DB (อ่าน) | **เฉพาะไฟล์ที่ owner สั่งในงานนั้น** | ตัดสินสถาปัตยกรรมเองนอกขอบเขต · เขียน production truth ตรง · ข้าม canonical/owner gate · force-push · commit secret · mock เพื่อให้ผ่าน test | แตะข้อมูล production · apply migration · commit/push · เปลี่ยน scope · destructive | แก้โค้ด/registry/เทส + เสนอ migration + รายงานหลักฐาน |
| **Claude Code / Codex / Gemini CLI** | approved scope | ไฟล์ที่ได้รับมอบหมาย | เหมือน Cline | เหมือน Cline | เหมือน Cline |
| **ChatGPT / Copilot / Cursor / Windsurf / local models** | เฉพาะสิ่งที่คนป้อน | — (ผลลัพธ์ผ่านคน) | ถือเป็น source of truth · ใช้ตัวเลข/โค้ดโดยไม่ตรวจกับ DB จริง | ทุกครั้งที่จะนำไปใช้ | ไม่มี (ให้ข้อเสนอ) |
| **MCP server + read tools** | registry/architecture/runtime ตาม `permittedReadScope` | **ไม่เขียนเลย** | ออกนอก scope/เรียก path ที่ไม่ลงทะเบียน | — (AUTO_LOW_RISK) | ไม่มี |
| **MCP governance tools** | สถานะอนุมัติ | — (PROPOSAL_ONLY) | execute เอง | ทุก proposal | ไม่มี |
| **VS Code / Tauri desktop** | repo/ไฟล์เครื่อง | ไฟล์ในเครื่อง | เขียน production truth เอง | commit/push/deploy | งานในเครื่อง |
| **macOS LaunchAgents** | โฟลเดอร์เครื่อง | เรียก API + log | เขียน DB ตรง | งานที่แตะข้อมูล | เฝ้า+ส่งต่อเหตุการณ์ (⚠️ พาธชี้รีโปเก่า) |
| **GitHub** | repo | commit (ผ่านผู้มีสิทธิ์) | force-push · commit secret | push/deploy | เวอร์ชันโค้ด |
| **GitHub Actions** | repo+registry | state files เท่านั้น | deploy · แก้โค้ดธุรกิจ · commit ไฟล์อื่น | — (contents จำกัด) | ตรวจ+บันทึกสถานะ |
| **Supabase Cloud** | DB/Auth/Storage | ตาม role | agent เขียนสคีมาโดยไม่มี migration | migration/สคีมา | โฮสต์ข้อมูล |
| **Supabase CLI (supabase-go)** | DB | SQL/migration ที่อนุมัติ | ลบข้อมูล · destructive นอกคำสั่ง · echo secret | ทุก apply ที่แตะข้อมูล | รัน SQL + before/after report |
| **Supabase Edge Functions** | DB | เขียน DB ตรง (ตามโค้ดปัจจุบัน) | สร้างยอดเงินเอง · ข้าม canonical semantics | deploy | normalizer/channel adapter |
| **Vercel (+cron)** | — | deploy ตาม git | deploy ก่อน gate ผ่าน | deploy | build/serve |
| **Railway** | project/env (read scope) | env vars | deploy mutation โดยไม่มี owner session | mutation ทุกชนิด | อ่านสถานะ |
| **Google Places / Geocoding** | read-only | — | เป็น SOT · สร้าง pit เอง | การเปลี่ยนเป็น canonical | ให้ candidate/พิกัด |
| **LINE** | ข้อความ/profiles | ส่งข้อความ | AI ยืนยันเงิน · ส่งเอกสารที่ยังไม่ออก | ส่งเอกสารการเงิน/แจ้งหนี้ | ช่องทางสื่อสาร |
| **Gmail (bank/ใบเสร็จ)** | อีเมล | — | ยืนยันยอดเงินอัตโนมัติ | การใช้เป็นหลักฐานบัญชี | สกัดข้อมูล |
| **Equipment GPS + driver phones** | พิกัด | telemetry | พิกัดปลอม · สั่งล็อกโดยไม่มีสิทธิ์ | เปลี่ยน permission | tracking |
| **execution-hand worker** | งานที่ assign | ไฟล์ผลลัพธ์ | deploy · ลบข้อมูล | งานที่แตะ production | งานใน INBOX |
| **Workers/Agents อื่น ๆ** | registry/manifest | — | ถือเป็น authority เอง | ทุก action | ไม่มี |

หลักฐานการกระทำ (ใช้ร่วมทุกแถว): `owner_auth_audit_log` · `destructive_action_log` · `audit_logs` · `connector_webhook_events` · `integration_gateway_events` · workflow logs · test output · git history

## 2. เพดาน 3 ชั้น (เขียนให้จำง่าย)
```
ชั้นบนสุด — OWNER
  อนุมัติ: credential/connector · destructive op · void เอกสารการเงิน · AP/payment out · stock adjustment · สถาปัตยกรรมใหม่
ชั้นกลาง — HUMAN-APPROVED AUTOMATION (ระบบทำงานแทนคนในกติกาที่อนุมัติ)
  auto: extraction, resolution, distance, price lookup, projection, draft, notification
  gate: ต้องผ่าน canonical write + audit + version
ชั้นล่าง — AI / TOOLS (เสนอและทำงานในขอบเขต)
  อ่านตาม scope · เขียนเฉพาะที่ได้รับมอบหมาย · ห้ามเป็นความจริง · ห้ามแตะ ledger
```

## 3. บังคับแล้ว vs ยังต้องบังคับเพิ่ม
**บังคับแล้ว (มีหลักฐาน)**: `permissions.json` (route_access/role_tiers) · `requireAuth` · owner passkey/Touch ID + `owner_auth_audit_log` · `destructive_action_gate` + log · connector `OWNER_REQUIRED` + proposal decide · `worker-tool-registry` per-tool scope · pre-commit guard · canonical write validation/audit · RLS 92/92 ตาราง
**ยังต้องบังคับเพิ่ม (ช่องที่พบจริงใน PHASE 2)**:
1. Deno/LINE writers ยังเขียน DB ตรง (ไม่ผ่าน canonical)
2. LINE token อยู่ใน DB (`line_channels`) ไม่ผ่าน credential ref
3. `ai_connection_status` = 0 แถว → ไม่มีบันทึกสถานะ AI จริง
4. Cline/agent บางตัวไม่อยู่ใน `AI_REGISTRY`
5. launchd agents ชี้รีโปเก่า (`/Users/tam/Desktop/DNA OS-ต้นฉบับ /dna-os-deadboard/`)
6. ไม่มี threshold rule (discount/margin) และไม่มี feasibility gate (<3 ชม.)
7. ไม่มี AP ledger/stock → ขอบเขตของสองโดเมนนี้ยังว่าง (ห้ามสร้างก่อน owner อนุมัติ)
8. GitHub/Gmail connector = disconnected แต่ GitHub ถูกใช้เป็น SOT ของโค้ด

## 4. วิธีใช้
- ก่อนเริ่มงานใหม่: หา node ใน `registry/DNA_OS_SYSTEM_OPERATING_GRAPH.json` → อ่าน `boundary` + `must_not_do` → เทียบ actor กับ matrix นี้
- ถ้าจำเป็นต้องเกินเพดาน → **ไม่ใช่การแก้โค้ด** แต่เป็น **owner amendment** (ตาม `CONSTITUTION.json#amendment_policy`)
- ทุกการซ่อมต้องทิ้งหลักฐาน (test/รายงาน/แถว audit) — ไม่มีหลักฐาน = ยังไม่นับ WORKING


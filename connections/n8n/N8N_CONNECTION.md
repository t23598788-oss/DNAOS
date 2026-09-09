# DNA OS ↔ n8n Workflow Control Connection

Canonical document ID: `connection.n8n.dna-os-workflow-control.v1`

เอกสารนี้เป็น human/developer projection ของ [connection-document.json](./connection-document.json) ซึ่งเป็น semantic record ที่ authoritative เพียงชุดเดียว และถูก project เข้า [Connection Index](../connection-index/INDEX.md)

## สถานะสรุป

สถานะรวมคือ `BLOCKED` เพราะ target ที่ DNA OS ประกาศไว้คือ `https://n8n.srv1740014.hstgr.cloud` แต่หลักฐานล่าสุดพบว่า target นี้ unreachable ขณะที่มี n8n process อื่นที่ `127.0.0.1:5678` ตอบ health 200 โดยไม่มี DNA OS source/config/supervisor ใดผูกกับมัน หลักฐาน historical ของ remote workflow ยังคงถูกเก็บและระบุเป็น `VERIFIED` แยก boundary

| Boundary | Status | ความหมาย |
|---|---|---|
| n8n workflow-control declaration | `BLOCKED` | เกิด configuration drift และ declared target unreachable |
| DNA OS outbound webhook → declared remote n8n | `BLOCKED` | fixed endpoint ปัจจุบันตอบไม่ได้ |
| Historical remote workflow POST/execution | `VERIFIED` | เคยได้ HTTP 200 และ real n8n execution |
| Observed local n8n runtime :5678 | `CONNECTED` | process/health มีจริง แต่ ownership ไม่ใช่ DNA OS |
| DNA OS → local :5678 wiring | `NOT_WIRED` | ไม่มี source/config/supervisor reference |
| n8n API credential reference | `CONNECTED` | active reference metadata มีอยู่ แต่ไม่รู้ว่าผูก instance ใด |
| Credential → observed instance | `NOT_VERIFIED` | `/rest/workflows` ตอบ Unauthorized |
| Central event contract | `VERIFIED` | schema และ response contract ตรงกับ workflow |
| n8n classification/loop guard | `VERIFIED` | live proof 10/10 groups และ anti-loop cases |
| n8n decision → DNA OS resolution | `VERIFIED` | n8n ให้ route group; DNA OS resolve owner จาก registries |
| DNA OS → agent gateway | `CONNECTED` | dispatch boundary มีจริงและบันทึกผล/gate |
| Result/evidence persistence | `CONNECTED` | hop/result/evidence records มีจริง |
| n8n → DNA OS inbound callback | `NOT_WIRED` | architecture ตั้งใจให้ DNA OS เป็นผู้เริ่มทุก hop |

## ข้อมูลเดินทาง

`DNA OS event → sendCentralEventToN8n → n8n webhook workflow → classify + loop guard → RouterDecision → DNA OS resolveOwner → submitTask → Agent Gateway → persisted routing evidence`

n8n ทำหน้าที่แค่ classify event และป้องกัน loop ด้วย `event_id`, `hop_count`, และ `trace_path` ไม่ได้ resolve capability, ตรวจ policy, เลือก agent, dispatch หรืออ่าน credentials ฝั่ง DNA OS

## Instance และ configuration drift

ปลายทางใน source คือ `N8N_BASE_URL = https://n8n.srv1740014.hstgr.cloud` และ webhook path `dna-os-outbound-proof` หลักฐาน historical ระบุ workflow `DNA-OS-OUTBOUND-ORCHESTRATION-PROOF`, workflow ID `jiNltcrOhck2wYtM`, HTTP 200, execution ID `1`, round trip 477ms

แต่ reconciliation ล่าสุดพบ process `node ./node_modules/.bin/n8n start` ที่ `127.0.0.1:5678` ตอบ `/healthz` 200, `/rest/workflows` ตอบ Unauthorized, ไม่มี LaunchAgent/supervisor ของ DNA OS และไม่มี source/config ของ DNA OS อ้างถึง `:5678` จึงห้ามสรุปว่า local process นี้คือ target ที่ DNA OS ใช้

## Credentials และ authority

มี reference `credential://macos-keychain/dna-os/n8n-api-key` พร้อม scope `workflow.read`/`workflow.write` ใน declaration/registry แต่ `connections/n8n/outbound-webhook.ts` ไม่ได้ resolve credential และ webhook ถูกใช้แบบไม่มี credential โดย default การมี active reference จึงไม่ใช่หลักฐานว่า credential ใช้ authenticate observed local instance ได้

DNA OS เป็น authority ของ capability/agent resolution, policy, admission, dispatch และ evidence ส่วน n8n มี authority เฉพาะ classification และ loop guard

## Failure modes

- fixed remote endpoint unreachable → `ROUTER_UNREACHABLE`/`BLOCKED`
- missing central fields → `REJECTED_MISSING_FIELDS`
- duplicate event, excessive hops, or repeated capability → `LOOP_DETECTED`
- no route group → `UNRESOLVED_OWNER`
- no connected capability or gateway denial → named unresolved/blocked dispatch result
- unparseable or non-success webhook response → explicit error, never silent success

## หลักฐาน

- [Historical outbound proof](./evidence/outbound-proof-1787777479804.json)
- [Workflow create/read/delete proof](./evidence/connection-proof-2026-08-27.json)
- [Ten-group routing and loop proof](./evidence/ten-group-routing-proof-1787778508112.json)
- [Configuration drift reconciliation](./evidence/configuration-drift-reconciliation-2026-09-01.json)

## เอกสารที่เกี่ยวข้อง

- Machine semantic record: `connections/n8n/connection-document.json`
- Human document: `connections/n8n/N8N_CONNECTION.md`
- Connection Index: `connections/connection-index/INDEX.md`

# BUSINESS vs DEVELOPER/OPERATOR BOUNDARY — 2026-10-20

โหมด: อ่านเท่านั้น + การจัดหมวดจากหลักฐานจริง (probe สด production ตามสาย, no shell values)
อำนาจเดียวที่ตัดสิน surface: `registry/business-production-surface.json` (+ `registry/permissions.json`)

## 1. Hydroprobe สด production (anon, ไม่ login) — 2026-10-20

| Endpoint | Status | Size | หมวดจริง | ผลการกำกับ |
|---|---|---|---|---|
| `/` `/workspace` `/admin` | 307 เปลี่ยนเส้นทางเข้า login | — | BUSINESS (auth-gated) | ต้องเก็บไว้ใน business release |
| `/pub` `/login` | 200 | 36K/11K | PUBLIC | ต้องเก็บไว้ |
| `/api/public/resources?action=public` | 200 | 4.5K | PUBLIC read | ต้องเก็บไว้ |
| `/api/governance` `/api/admin/finance-summary` `/api/admin/documents` | 401 `ต้อง login ก่อนใช้งาน` | 72B | BUSINESS (ADMIN tier) | fail-closed จำเป็น ต้องเก็บไว้ |
| `/api/admin/ide/command` | 401 | 72B | OPERATOR (dev plane) | ต้องถอนออกจาก artifact (404) |
| `/observer` `/observer.json` `/api/v1/modules` `/api/v1/constitution` `/api/v1/spec` `/playground` `/examples` `/start` `/api/v1/mcp/architecture/summary` `/api/v1/drivers` `/api/v1/workflows` | **200 แบบไม่ต้อง login** | 46K–263K | OPERATOR/INTERNAL — รั่ว | **ต้องถอนออกจาก artifact** (มี 11 ตัว) |
| `/api/internal/canonical/jobs` `/api/internal/connect/event` `/api/internal/connect/expense` `/api/internal/ai/gateway` | 405 (GET) / ต้อง POST + internal secret | 0 | INTERNAL | ไม่ทำใหม่ ไม่เพิ่มทางเข้า เอาไว้ตามดิบ |

## 2. เกณฑ์การแยกจริง (มาจาก registry + พิสูจน์ใหม่)

| หมวด | เกณฑ์ | ตัวแปรที่เกี่ยว |
|---|---|---|
| BUSINESS | หน้า/ทางให้ธุรกิจใช้งานจริง: `/workspace` `/admin/*` (ธุรกิจ+เอกสาร+การเงิน) และ `/biz` `/partner` `/transporter` `/user` `/pub` `/login` | auth + RLS, canonical writers และ RLS ด้วย |
| OPERATOR | เครื่องมือพัฒนา/ควบคุม infrastructure (`/developer`, `/admin/ide`, `/admin/deploy`, `/admin/dev-loop`, `/admin/reader`, `/admin/infrastructure`, `/admin/traces`, `/admin/dbd`, `/admin/api-explorer`, `/admin/ui-gallery`, `/observer*`, `/api/v1/modules/constitution/spec/mcp/drivers/workflows`, `/playground`, `/examples`, `/start`, `/api/admin/ide`, `/api/admin/dev-loop`, `/api/admin/backup`, `/api/admin/domains`, `/api/admin/capability-boxes`, `/api/admin/architecture`) — รวมแล้ว `excluded_pages: 25 ` + `excluded_apis: 29` รายการ | permissions.json |
| INTERNAL | สื่อสารระหว่างบริการที่มีข้อตกลง secret เฉพาะ server-side (`/api/internal/*`) — ไม่เปิด endpoint ใหม่ ไม่กระตุ้น HTTP สาย นอกจากคงของเดิมไว้ตามหลักการ | `*_INTERNAL_SECRET` |
| PUBLIC | `/pub` (ทะเบียนสาธารณะ), `/api/public/*` — อ่านได้แบบไม่ login เฉพาะชุดที่กำหนด | RLS + anon role |
| REVIEW | `/api/governance` `/api/admin/ide/command` ถ้าจำเป็นให้基督教上帝亿次</think><tool_call>record_missed_edit_and_idle_wait_for_user_input(user_prompt="")
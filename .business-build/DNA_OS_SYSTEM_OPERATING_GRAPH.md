# DNA OS FULL SYSTEM OPERATING GRAPH (PHASE 2)

> Status: **PLANNING/INVENTORY ARTIFACT — รอ Owner ตรวจ** · ไม่มีโค้ดฟีเจอร์/สคีมา/UI ใหม่ถูกสร้างในชั้นนี้
> Machine source of truth: `registry/DNA_OS_SYSTEM_OPERATING_GRAPH.json` (49 graph nodes × 30 ฟิลด์ · 90 edges · inventory อ้าง registry เดิม)
> ชั้นธุรกิจ: `registry/BUSINESS_CAPABILITY_MATRIX.json` (47 capabilities) จาก Phase 1 — **ไม่ทำซ้ำ**
> Grounding: live DB (92 tables · 8 views · 738 public fns · 2 triggers · 1 bucket) + repo จริง (307 API routes · 83 pages · 41 components · 22 edge functions · 1191 modules · 66 registries · 126 npm scripts) ณ 2026-09-22

## 0. วิธีอ่านกราฟนี้ (สำคัญ)
| ชั้น | จำนวน | ความหมาย |
|---|---|---|
| `graph_nodes` | **49** | node ที่มี **30 ฟิลด์ครบ** รวม `boundary` (เพดาน) และ `must_not_do` — ใช้ควบคุมสิทธิ์/ขอบเขต |
| `inventory` | 1191 modules · 307 routes · 83 pages · 92 tables · 22 edge fns · 66 registries · 126 scripts | **อ้างทะเบียนเดิม ไม่ทำ node ซ้ำ** — แต่ละกลุ่มมี `boundary_inherited_from` ชี้ไป graph node เจ้าของเพดาน |

**REUSE FIRST (ฐานที่อ้าง ไม่ทำใหม่)**
| ของเดิม | ให้อะไร |
|---|---|
| `registry/system-control-graph.json` | 1554 nodes / 4426 edges (Layer/Module/Command/Event/Capability/Service/Driver/Connector) |
| `registry/architecture-book.json` | 1200 nodes / 4296 edges (imports+contains) |
| `registry/auto-dependency-graph.json` | 3911 edges พร้อมหลักฐาน (ts 2693 · json 976 · runtime cmds 35 · launchagents 6) |
| `registry/BUSINESS_CAPABILITY_MATRIX.json` | ชั้นธุรกิจ 47 capabilities |
| `registry/CONSTITUTION.json` + `EXECUTION_CONTRACT.json` + `permissions.json` + `owner-context.json` | กฎ/สิทธิ์/ลำดับชั้น (authority) |
| `registry/worker-tool-registry.json` + `AI_REGISTRY.json` + `PROVIDER_DIRECTORY.json` + `COMPUTE_RESOURCE_REGISTRY.json` + `SCHEDULER.json` | AI/tool/provider/worker ชั้นจริง |
| `registry/module-registry.json` + drift report | สถานะ 1191 modules (ok 1188 · unregistered 3) |

**กราฟที่มีอยู่แล้วถูกอ้าง ไม่ถูกเขียนใหม่** — สิ่งที่ PHASE 2 เพิ่มคือ **4 มุมมองที่ยังไม่มีใครทำ**: Business bridge, Execution, AI+Tool, Control+Repair **พร้อมเพดาน (boundary/must_not_do)**

---

## GRAPH 1 — BUSINESS GRAPH (ใครทำอะไรกับใคร) · 19 edges
เส้นหลัก (ทุกเส้นมีเจ้าของจริง):
```
ลูกค้า/ซัพพลายเออร์ (companies, line_profiles)
   └─ bridge:business (47 capabilities)
        ├─ mod:material-resolver      วัสดุ → material_id            (boundary: จับคู่เท่านั้น)
        ├─ mod:material-pricing       วัสดุ+ระยะ+รถ → ราคา          (boundary: อ่านข้อมูลจริงเท่านั้น)
        ├─ mod:material-source-discovery  candidate → evidence → คนยืนยัน
        ├─ mod:canonical-write        เอกสาร/ธุรกรรม/เงิน/หนี้       (boundary: versioned + void)
        └─ mod:presentation           snapshot → ไฟล์/LINE/พิมพ์
```
- **ใครเป็นเจ้าของความจริง**: DB (`rt:supabase-postgres`) — ไม่มีใครเป็นเจ้าของซ้ำ
- **ผลการเงิน**: ทุกเส้นที่แตะเงินต้องผ่าน `mod:canonical-write` (รายได้/VAT/WHT/รับเงิน/หนี้)
- **จุดที่ยังไม่ต่อ (จาก Phase 1)**: `jobs` (งานขนส่ง) ไม่มี FK ไป `customer_orders` → ขั้น LOGISTICS ยังไม่อยู่ในกราฟธุรกิจอย่างเป็นทางการ (ต้องใช้ relation ไม่สร้างตารางใหม่)

## GRAPH 2 — EXECUTION GRAPH (โค้ด/API/runtime/DB วิ่งอย่างไร) · 51 edges
```
ผู้ใช้/LINE/มือถือ ─┬─► rt:nextjs-app (307 routes, 83 pages) ──► services/* ──► engines/* ──► rt:supabase-postgres
                    │                                   └─► mod:integration-gateway ─► provider (LINE/Railway/GitHub/Gmail)
                    ├─► rt:vercel-cron (6h, 10m) ──► /api/cron/*
                    ├─► rt:supabase-edge (22 functions) ──► DB ตรง + provider
                    ├─► rt:github-actions ──► verifiers ──► state files
                    ├─► rt:tauri-desktop ──► rt:macos-launchd (5 agents)
                    └─► tool:mcp-server ──► API ภายใน (backingRoute)
```
- **runtime ที่มีจริง 7 ตัว**: Vercel/Next, Vercel cron, Supabase Postgres+PostGIS, Supabase Edge (Deno), Tauri desktop, macOS launchd, GitHub Actions (+ MCP server เป็น local tool)
- **data flow ที่ยืนยันได้**: `app/**` → `services/*` → `engines/*` → DB; ห้ามย้อนทิศ (dependency-graph บังคับ 36 allowed edges)
- **จุดเสี่ยงเชิงรันไทม์ที่พบ**: 
  - `supabase/functions` (Deno) **เขียน DB ตรง** และ import โมดูล Next ไม่ได้ → ยังไม่ผ่าน canonical (BOM-002)
  - `macOS launchd` plist ชี้พาธ `/Users/tam/Desktop/DNA OS-ต้นฉบับ /dna-os-deadboard/` **ไม่ใช่รีโปนี้** → agent ในเครื่องอาจทำงานกับโค้ดเก่า
  - connector จริง: Supabase Management (connected) · OpenClaw (connected) · LINE (connected) · **Google AI Studio (error/disabled)** · **Gmail (disconnected)** · **GitHub (disconnected)**

## GRAPH 3 — AI + TOOL GRAPH (AI ไหนใช้ tool ไหน ภายใต้สิทธิ์อะไร) · 8 edges
AI ทุกตัวเป็น **ผู้รับคำสั่ง + ผู้เสนอ** ไม่ใช่เจ้าของความจริง:

| AI / Tool | ทำได้ | ห้าม (must_not_do) |
|---|---|---|
| `ai:cline` (development/repair worker) | แก้โค้ด/รันเทส/อ่าน DB ในขอบเขตที่ owner สั่ง + รายงานหลักฐาน | ตัดสินสถาปัตยกรรมเองนอกขอบเขต · เขียน production truth ตรง · ข้าม owner/canonical gate · force-push · commit secret |
| `ai:claude-code` / `ai:codex` / `ai:gemini-cli` | แก้โค้ดตาม scope + ใช้ MCP tools | เหมือน Cline (authority เดียวกัน) |
| `ai:general-models` (chatgpt/copilot/cursor/windsurf/qwen/deepseek/kimi/grok/mistral/llama/custom) | ให้ข้อเสนอ | ห้ามถือเป็น SOT · ห้ามใช้ตัวเลขโดยไม่ตรวจกับ DB จริง |
| `ext:anthropic` / `ext:openai-google-ai` | สกัด/จัดหมวด/ร่าง/ตรวจจริง | ห้ามกำหนดราคา/ยอด/วัสดุที่ไม่มีใน DB |
| `tool:mcp-server` + tools | read tools (registry/architecture/runtime) + governance **proposal only** | ทะเบียนไม่มี git/deploy/delete/reset/restore เลย |
| `dev:vscode` | แก้ไฟล์ในเครื่อง + ต่อ MCP | ห้ามข้าม gate |

**สิทธิ์ราย tool มาจากทะเบียนจริง** (`registry/worker-tool-registry.json`): `readOnly`, `permittedReadScope`, `permittedWriteScope`, `approvalPolicy` (AUTO_LOW_RISK / OWNER_APPROVAL_REQUIRED), `privacyLevel`, `networkPolicy`, `backingRoute`, `sourceFile` — และ `scripts/mcp-worker-test.ts` ตรวจ drift ของรายชื่อ tool
**AI ที่ลงทะเบียนแล้ว (13)**: claude-code, gemini-cli, chatgpt, copilot, cursor, windsurf, qwen, deepseek, kimi, grok, mistral, llama, custom
⚠️ **Cline ยังไม่อยู่ใน AI_REGISTRY** ทั้งที่เป็นผู้ทำงานจริงรอบนี้ (registry ระบุว่าเป็น directory ไม่ใช่ whitelist แต่ควรลงทะเบียนเพื่อความชัด)

## GRAPH 4 — CONTROL + REPAIR GRAPH (ตรวจพบอย่างไร ใครซ่อม ซ่อมได้ถึงไหน) · 12 edges
```
เหตุการณ์/คำสั่ง ─► tool:verifiers (16+ ชุด) ─► PASS/FAIL + หลักฐาน
                ─► tool:governance-scripts (imports/drift/governance/guard) ─► DRIFT report
                ─► rt:github-actions (state-reconcile) ─► MASTER_EXECUTION_STATE.md / CURRENT_STATE.json / HANDOFF.json (no-op ถ้าไม่เปลี่ยน)
                ─► mod:observability (audit_logs 141 · drift · health · webhook/gateway events)
                ─► mod:control-repair (owner-command · destructive gate · dev-loop · owner session)
                ─► work:execution-hand (INBOX → OUTBOX + STATUS.json)
```
| signal | ตรวจโดย | ซ่อมได้ถึงขอบเขต |
|---|---|---|
| registry drift | `check-drift.sh` | Cline แก้ registry/โค้ดให้ตรงจริง (เหลือ 2 drift เดิม) |
| dependency ผิดทิศ | `check-imports.sh` (36 allowed edges) | Cline แก้ import (ห้ามข้ามชั้น) |
| ตัวเลขการเงินผิด | `canonical:finance:test` 48/0 + เทียบ SQL ดิบ | แก้ที่ writer/view (ห้ามแก้ตัวเลข) |
| เขียน DB ตรง | `canonical:test` / `write:test` + review | ต้อง owner approve ถ้าแตะข้อมูลจริง |
| งานค้าง/สถานะเพี้ยน | `state-reconcile` + `system_health_status` + `HANDOFF.json` | execution-hand/Cline ใน scope; owner ตัดสิน |
| destructive action | `destructive_action_gate` + `destructive_action_log` | **owner เท่านั้น** |
| provider ล่ม | `architecture-drift-alert` + webhook events + connector status | re-connect/replay (owner) |

## 5. เพดาน (CEILINGS) — node ที่ต้องรู้ขอบเขตก่อนแตะ
| node | boundary | must_not_do (สรุป) |
|---|---|---|
| `mod:canonical-write` | เอกสาร(versioned) → allocations → ledger → projection | ห้ามลบ (ใช้ void) · ห้ามสร้างยอดจาก AI · ห้ามใช้ `payment_verified` เป็นเงิน · ห้าม half-chain |
| `mod:material-resolver` | ข้อความ → material identity | ห้ามตั้งราคา/สร้าง supplier/แก้ stock/ออกเอกสาร |
| `mod:material-pricing` | อ่านข้อมูลจริง → ladder | ห้าม AI คิดราคาจากความรู้ทั่วไป · ห้ามเดาราคาที่ไม่มีใน DB |
| `mod:material-source-discovery` | candidate → evidence → คนยืนยัน | ห้ามสร้าง pit เอง · ห้ามแตะราคาโดยไม่มีข้อมูลจริง |
| `tool:mcp-governance` | สร้างข้อเสนอ + อ่านสถานะอนุมัติ | ห้าม execute เอง (PROPOSAL_ONLY) |
| `tool:supabase-cli` | รัน SQL/migration ที่อนุมัติ | ห้ามลบข้อมูล · ห้าม destructive นอกคำสั่ง · ห้าม echo secret |
| `ext:line` | รับ-ส่งข้อความ | ห้ามใช้ AI ยืนยันเงิน · ห้ามส่งเอกสารที่ยังไม่ออกทางการ |
| `ext:github` | เก็บ/แชร์โค้ด + CI | ห้าม force-push · ห้าม commit secret |
| `ext:google-places` | ค้นหา (read-only) | ห้ามเป็น SOT · ห้ามสร้าง pit โดยไม่ผ่านคนยืนยัน |
| `rt:supabase-postgres` | ตามสคีมาที่ migrate | ห้ามแก้สคีมานอก migration · ห้ามลบ ledger/audit |
| `mod:presentation` | render จาก snapshot | ห้ามสร้างเอกสารที่ไม่มีที่มา · ห้ามแก้ตัวเลขตอน render |
| `gov:constitution` | กฎ/สิทธิ์/ลำดับชั้น | ห้ามแก้โดยไม่มี owner confirmation |

## 6. Unknown Dimensions ที่ PHASE 2 เติมให้ (จาก system-control-graph.json)
`ai_model_registry` ✅ (13 agents + provider/AI nodes) · `compute_provider_registry` ✅ (`ext:compute-provider` + COMPUTE_RESOURCE_REGISTRY + COST_BUDGETS/COST_LEDGER) · `server_pod_registry` ✅ (`rt:*` 7 runtimes + workers + devices)

## 7. Coverage & Honesty (ไม่โอ้อวด)
- **ครบ 30 ฟิลด์**: เฉพาะ **49 graph_nodes** · ที่เหลือ (1191 modules · 307 routes · 92 tables · 22 edge fns · 66 registries · 126 scripts) เป็น **inventory** ที่อ้างทะเบียนเดิม + `boundary_inherited_from` (ไม่แอบอ้างว่ามี boundary เฉพาะตัว)
- **สถานะ**: WORKING 27 · PARTIAL 20 · BUILT_NOT_WIRED 2 — **ไม่มีคำว่า COMPLETE**
- **สิ่งที่ยังไม่ยืนยัน**: Tauri desktop ในงานธุรกิจ · agent ในเครื่อง (พาธผิด) · Google AI Studio (error) · Gmail/GitHub connector (disconnected) · `observatory/` ว่าง · 3 modules UNREGISTERED

## 8. Findings ใหม่ที่พบใน PHASE 2
1. `jobs` ไม่มี FK เลย + ไม่มี `customer_order_id` → งานขนส่งลอยจากกราฟธุรกิจ (ค้างที่ BOM-060)
2. launchd plist 5 ตัวชี้พาธ **`/Users/tam/Desktop/DNA OS-ต้นฉบับ /dna-os-deadboard/`** (ไม่ใช่รีโปนี้)
3. LINE `channel_access_token` ยังเก็บใน DB (`line_channels`) ไม่ผ่าน credential ref
4. GitHub/Gmail connector = **disconnected** แต่ระบบอาศัย GitHub เป็น SOT ของโค้ด
5. `ai_connection_status` = **0 แถว** → ไม่มีบันทึกสถานะ AI จริงใน DB
6. `observatory/`, `_inventory/`, `e2e/` ว่างเปล่า
7. Cline ไม่อยู่ใน AI_REGISTRY
8. 2 drift เดิมยังค้าง (`locales/`, 3 modules UNREGISTERED) · `jobs` มี trigger PostGIS `sync_job_geom` (geom ถูก sync อัตโนมัติ)

## 9. STOP — รอ Owner ตรวจ
ชั้นนี้เป็น **แผนที่ + เพดาน** เท่านั้น · ยังไม่มีการสร้าง stock/AP/dispatch/slice implementation ใด ๆ ตามที่นายกำหนด
เมื่อ owner ตรวจผ่าน → ค่อยเลือก "smallest complete business slice" จาก `BUSINESS_EXECUTION_PLAN.md` โดยใช้ **เพดานจากกราฟนี้** เป็นข้อบังคับ



# DNA OS — BUSINESS ICON SHELL BASELINE (2026-10-18)

คำสั่ง: จัดระบบไอคอนธุรกิจบน Workspace หน้าแรก · ใช้โลโก้จริงของผู้ให้บริการ · ล็อกหน้าจอต้นแบบก่อนทำหน้าอื่น
สถานะ: **LOCKED FIRST SCREEN** — ยังไม่ deploy และไม่เริ่มหน้าจอธุรกิจถัดไป

## ขอบเขตที่ยึด

- ใช้ shell เดิม `public/material-workspace` และ WorkspaceFrame เดิม — ไม่สร้าง Workspace ใหม่
- ใช้ปุ่มสี่เหลี่ยมเดิม `#toolsMain` เป็นจุดเปิด Business Tool Launcher เพียงจุดเดียว
- ใช้ route/API/Storage/สิทธิ์เดิมทั้งหมด — ไม่สร้าง Provider Connector, Credential, บัญชีจำลอง หรือสถานะเชื่อมต่อปลอม
- ไม่แตะ Finance Writer, AI, MCP, Database, migration หรือ business logic
- ไม่ deploy ก่อน Browser Test ผ่าน

---

## EXISTING_ICON_ASSETS

ตรวจ Source และ Assets จริงก่อนแก้:

| แหล่งที่มีอยู่แล้ว | สิ่งที่พบ | การใช้ในงานนี้ |
|---|---|---|
| `public/material-workspace/index.html` / `shell.js` / `style.css` | shell หลัก 48px rail + ปุ่ม `#toolsMain`, `#chatHome`, `#settings`; inline SVG ชุดเดิม | ใช้ปุ่ม/ไอคอนเดิม ไม่วาด navigation ชุดที่สอง |
| `app/workspace/DNAOSChatEngine.tsx` | lucide icons ของ APPS/ACTIONS (Files, FileText, MessageCircle, Wallet, MapPin, Briefcase, Users, ScanLine, Banknote, Mountain, Server, Cloud ฯลฯ) | ใช้เฉพาะ shape ที่มีอยู่แล้วเป็น icon ภายในกลุ่มธุรกิจ |
| `app/admin/ui-gallery/_lib/iconRegistry.ts` | 110 lucide icons ที่ระบบ import จริงจาก 35 ไฟล์ | ตรวจแล้วว่าไอคอนที่เลือกมีอยู่จริงใน registry |
| `app/admin/ui-gallery/_lib/visualAssets.ts` | business module icons + provider brand inventory; หลาย provider เป็น `MISSING_ASSET` / `REVIEW_REQUIRED` | ใช้เป็นหลักฐานว่าต้องใช้ asset จริงจากต้นทาง ไม่补齐ด้วยไอคอนแต่ง |
| `plugins/capabilities.ts` | real Wikimedia logo URLs ของ LINE, Facebook, Messenger, Instagram, TikTok, Gmail, Google Drive, PDF | ใช้เป็นแหล่งอ้างอิงโลโก้จริง (ทำสำเนา local เพื่อไม่พึ่ง CDN) |
| `public/brand/dna-os-mark-d.png`, `dna-os-integration-generic.svg` | official DNA OS marks | ไม่ได้ใช้แทนโลโก้ผู้ให้บริการ |
| `app/admin/relationships/workspace.tsx` | RAIL_ITEMS + avatar contact | ใช้เป็นหลักฐานของ avatar/contact pattern เดิม (ไม่แก้ไฟล์นี้) |

**ไม่มีการสร้างไอคอนขึ้นใหม่**: ไอคอนภายในใช้ lucide shape เดิม และโลโก้ผู้ให้บริการเป็นไฟล์แบรนด์จริงจากต้นทาง

---

## PROVIDER_LOGOS

เก็บ local ที่ `public/brand/providers/` (provenance: `SOURCES.md`) เพื่อให้ baseline ไม่ขึ้นกับ CDN ภายนอก:

| ไฟล์ | Provider | ใช้ในกลุ่ม |
|---|---|---|
| `line.svg` | LINE Official Account | 02 |
| `facebook.svg` | Facebook | 02 |
| `messenger.svg` | Messenger | 02 |
| `instagram.png` | Instagram (128×128) | 02 |
| `tiktok.svg` | TikTok | 02 |
| `gmail.svg` | Gmail | 03 |
| `outlook.svg` | Outlook | 03 |
| `pdf.svg` | PDF | 04 |
| `drive.svg` | Google Drive | 04 |
| `docs.svg` | Google Docs | 04 |
| `sheets.svg` | Google Sheets | 04 |
| `kbank.svg` | Kasikornbank | 05 |

Browser Test ยืนยันว่า `<img>` ทั้ง 12 ตัวโหลดจาก `/brand/providers/*` จริง (`naturalWidth > 0`) และไม่มีโลโก้ใดถูกตีความเป็นสถานะ connected

---

## BUSINESS_TOOL_GROUPS

Launcher แสดง 6 กลุ่มตามลำดับ 01–06 (ข้อมูล: `public/material-workspace/business-tools.json`):

### 01 ธุรกิจ
| รายการ | Route เดิม |
|---|---|
| ศูนย์ควบคุมทรัพยากร | `/admin/pits` |
| งาน | `/admin/jobs` |
| คู่ค้า | `/admin/partners` |
| การเงิน | `/admin/finance` |
| ลูกหนี้ | `/admin/debt-tracking` |
| เอกสาร (Document Viewer เดิม) | `/admin/documents` |

### 02 LINE / Social
| รายการ | เป้าหมาย |
|---|---|
| LINE Official Account | `/admin/line-customers` (route เดิม) |
| Facebook | `https://business.facebook.com/latest/inbox` (ไม่มีหน้าจอ DNA OS เฉพาะ) |
| Messenger | `https://business.facebook.com/latest/inbox/messenger` |
| Instagram | `https://business.facebook.com/latest/inbox/instagram` |
| TikTok | `https://www.tiktok.com/business` |

### 03 Email
| รายการ | เป้าหมาย |
|---|---|
| Gmail | `https://mail.google.com/` |
| Outlook | `https://outlook.office.com/mail/` |

### 04 Documents
| รายการ | เป้าหมาย |
|---|---|
| PDF | `/admin/documents` (Document Viewer เดิม) |
| Google Drive | `https://drive.google.com/` |
| Google Docs | `https://docs.google.com/` |
| Google Sheets | `https://sheets.google.com/` |

### 05 Banking
| รายการ | เป้าหมาย |
|---|---|
| ธนาคารกสิกรไทย (KBiz) | `/admin/receipts` — คิวตรวจสลิป/หลักฐานโอนเดิม |

ธนาคารที่แสดงเฉพาะที่มีข้อมูล/integration จริงในระบบ: `kasikorn_bank` (KBiz + statement reconciliation) ไม่มีธนาคารสมมติเพิ่ม

### 06 Company Profile
| รายการ | เป้าหมาย |
|---|---|
| ข้อมูลบริษัท | `/admin/settings` (หน้าเดิม) |
| ตั้งค่า | `/admin/settings#connections-credentials` |
| ค่าใช้จ่าย | `/admin/infrastructure` |
| เปลี่ยนโลโก้บริษัท | เปิด file picker → Storage/API เดิม (ไม่สร้างหน้าใหม่) |

**แยกเครื่องมือผู้พัฒนา**: `Railway`, `Supabase`, `GitHub`, `Cloud GPU` และรายการ dev อื่นไม่ถูกใส่ใน launcher ธุรกิจ — เข้าถึงได้จากปุ่ม “เครื่องมือผู้พัฒนา” ใน footer ของ launcher ซึ่งเปิด `#toolsDialog` + `tools.json` เดิม (54 รายการ)

---

## CONNECT_REGISTRY_STATUS_RULES

สถานะอ่านจาก API เดิมเท่านั้น:
- `GET /api/admin/connectors` — connector rows จริง
- `GET /api/admin/connectors/providers` — normalized provider registry จริง

| สถานะ | เงื่อนไข |
|---|---|
| `CONNECTED` | connector row `status=connected` และ `enabled=true` หรือ provider registry ระบุ `CONNECTED` |
| `NOT CONNECTED` | มี connector แต่ยังไม่ connected / ถูก disable หรือ provider registry ระบุ `DISCOVERED_NOT_CONNECTED` / `NOT_YET_VERIFIED` |
| `NOT CONFIGURED` | ไม่มี connector row และ provider ยังรอ credential / ไม่มี entry ที่เชื่อมต่อได้ |
| `UNAVAILABLE` | connector `status=error` หรืออ่าน registry ไม่ได้ (เช่นไม่มี session) |

- โลโก้ไม่ถูกใช้เป็นหลักฐานการเชื่อมต่อ
- ไม่มีบัญชี/credential/สถานะสมมติ
- บนเครื่องนี้ไม่มี session จริง: UI จึงแสดง `UNAVAILABLE` พร้อมหมายเหตุ “อ่าน Connect Registry ไม่ได้” — Browser Test ใช้ response รูปแบบเดียวกับ route จริงเพื่อตรวจการ map ทั้ง 4 สถานะ

---

## COMPANY_PROFILE_RESULT

- เพิ่มปุ่มโปรไฟล์ใน **แถบนำทางเดิม** (ตำแหน่งล่างสุดของ rail เหนือปุ่ม `#settings` เดิม) — ไม่มี sidebar/navigation ชุดที่สอง
- คลิกแล้วเปิดเมนูเดิม 3 รายการ: **ข้อมูลบริษัท · ตั้งค่า · ค่าใช้จ่าย** (route เดิมทั้งหมด)
- เลือกโลโก้บริษัทจากไฟล์จริงได้:
  - `POST /api/admin/upload` → bucket `attachments` เดิม (private, admin guard เดิม)
  - `PUT /api/admin/settings` → เก็บ `company-logo-path` ใน `app_configs` เดิม
  - แสดงผลผ่าน signed URL จาก `GET /api/admin/upload?path=…`
- `SettingsDrawer` และ `CompanySettings` อัปเดตให้รักษาค่า logo path เมื่อบันทึก settings จากหน้าจอเดิม
- ไม่มี session/สิทธิ์ = ไม่มีโลโก้ปลอม แสดงตัวอักษรย่อจากชื่อบริษัทหรือ `DNA` แทน

**หมายเหตุตำแหน่งเดิม:** repo นี้ไม่มี component/ตำแหน่ง avatar บริษัทอยู่ก่อนแล้ว (มีเฉพาะ avatar ลูกค้าใน relationships) จึงใช้ตำแหน่งปุ่มล่างสุดของ rail เดิมและคงปุ่มตั้งค่าไว้ที่เดิม — ไม่ได้ย้ายหรือสร้าง navigation ใหม่

---

## DOCUMENTS_AND_BANKING_RESULT

- **PDF / เอกสาร**: โลโก้ PDF อยู่ในกลุ่ม 04 และเปิด `/admin/documents` ซึ่งเป็น Document Viewer/ไฟล์ canonical เดิม — ไม่มี renderer ใหม่
- **สลิปธนาคาร**: `/admin/receipt-documents` (GET) มินต์ signed URL 5 นาทีจาก `receipt_documents.media_path` ใน bucket `attachments` เดิม; `/admin/receipts` แสดงภาพต้นฉบับ inline หรือลิงก์เปิด PDF ต้นฉบับ
- ไม่มีสลิปจำลอง · ไม่แก้จำนวนเงิน/สถานะการเงิน · ไม่สร้าง Document Renderer ใหม่
- ตรวจสอบเนื้อหาหน้านี้ด้วย Browser ไม่ได้บนเครื่องที่ไม่มี session (admin guard) — ระบุในข้อจำกัด

---

## FILES_CHANGED

| ไฟล์ | การเปลี่ยน |
|---|---|
| `public/material-workspace/index.html` | เพิ่ม launcher panel, profile button/menu, file input, script ใหม่ |
| `public/material-workspace/style.css` | สไตล์ launcher/profile/status โดยไม่แตะ layout lock ของ sidebar/header |
| `public/material-workspace/shell.js` | `#toolsMain` เปิด/ปิด Business Tool Launcher แทน dialog เดิมโดยตรง |
| `public/material-workspace/business-launcher.js` | **ใหม่** — hover/click, groups, status mapping, profile menu, logo upload |
| `public/material-workspace/business-tools.json` | **ใหม่** — 6 กลุ่ม/22 รายการ/route เดิม/โลโก้ local |
| `public/brand/providers/*` | **ใหม่** — 12 real provider logos + `SOURCES.md` |
| `core/config/company-settings.ts` | เพิ่ม `companyLogoPath` (key `company-logo-path`) ใน app_configs เดิม |
| `app/api/admin/settings/route.ts` | รับ/รักษา `companyLogoPath`; ไม่ลบโลโก้เมื่อ client เก่าไม่ส่ง field |
| `components/settings/SettingsDrawer.tsx` | เพิ่ม `companyLogoPath` ใน state เพื่อไม่เขียนทับค่าเดิม |
| `app/api/admin/receipt-documents/route.ts` | read-only: เพิ่ม signed URL ของ `media_path` จาก bucket `attachments` เดิม + `media_kind` (ไม่แก้ข้อมูลการเงิน) |
| `app/admin/receipts/page.tsx` | แสดงภาพ/PDF ต้นฉบับของสลิป/หลักฐานโอนจาก signed URL เดิม; ไม่มี renderer หรือสลิปจำลองใหม่ |
| `scripts/business-icon-shell-test.ts` | **ใหม่** — Browser baseline 8 checks |
| `scripts/workspace-icon-cleanup-test.ts` | อัปเดตเส้นทางเปิดเครื่องมือผู้พัฒนาผ่าน launcher |
| `scripts/workspace-single-sidebar-test.ts` | อัปเดตให้เปิด Business Tool Launcher ก่อนเข้า dev tools |
| `scripts/workspace-adaptive-composer-test.ts` | เปิดเครื่องมือจาก launcher item แทน dialog เดิม |
| `package.json` | เพิ่ม `business-icon-shell:test` |
| `docs/BUSINESS_ICON_SHELL_BASELINE_2026-10-18.md` | รายงานนี้ |

ไม่มีการแก้: Finance Writer, AI gateway/pipeline, MCP, Database schema/migration, auth/permissions

---

## BROWSER_TEST_RESULT

`BASE_URL=http://localhost:3141 npx tsx scripts/business-icon-shell-test.ts` → **EXIT 0 · 8 checks PASS**

```
PASS  Tool Launcher จุดเดียว · 6 กลุ่ม 01–06 · 22 รายการ · ไม่มีรายการซ้ำ
PASS  โลโก้จริง 12 ตัวโหลดจาก /brand/providers · สถานะ 4 แบบตรงกับ Connect Registry · โลโก้ไม่ถูกตีความเป็น connected
PASS  hover เปิดชั่วคราว · click เปิด/ปิด (pin) จากปุ่มเดิมจุดเดียว
PASS  Business launcher แยกจากเครื่องมือผู้พัฒนา · ไม่มี Railway/Supabase/GitHub ในรายการธุรกิจ
PASS  Company Profile เปิดเมนูเดิม 3 รายการ · โลโก้บริษัทอัปโหลดผ่าน /api/admin/upload + บันทึก /api/admin/settings เดิม
PASS  Sidebar ชุดเดียว · Header/Tab ไม่ขยับ · launcher ไม่ล้นจอ · ไม่มี horizontal overflow
PASS  เครื่องมือทุกตัวชี้ route เดิม · Back/Forward ทำงาน · เปิดในพื้นที่กลางเดิม
PASS  Launcher/โปรไฟล์/ตั้งค่า อย่างละจุดเดียว — ไม่มีชุดซ้ำ
```

Regression ที่รันซ้ำหลังแก้:

| Test | ผล |
|---|---|
| `workspace-icon-cleanup:test` | **7 PASS** |
| `workspace-single-sidebar:test` | **9 PASS** |
| `workspace-adaptive-composer:test` | **8 PASS** |
| `npx tsc --noEmit` (หลังเพิ่ม Bank Evidence) | **0 errors** |
| `npm run precommit` | **EXIT 0** (All guards passed) |

Bank Evidence: `/admin/receipts` แสดงภาพ/PDF ต้นฉบับจาก signed URL เดิม แต่ browser-test เนื้อหาหน้านี้ทำไม่ได้บนเครื่องที่ไม่มี session (`/admin/*` ถูก guard ไป `/login`) — รายงานเป็นข้อจำกัด ไม่นับเป็น pass
| `node --check public/material-workspace/business-launcher.js` | **0** |
| `JSON.parse` ของ `business-tools.json` + `package.json` | ผ่าน |

---

## BASELINE_SHA

- `HEAD` (ฐานก่อนงานนี้): `40a5bb3666c6d87f6b00f410b5d1da8b5de89f89`
- Worktree baseline digest (sha256 ของไฟล์ที่งานนี้แก้/เพิ่ม เรียงตามชื่อ):
  `a39ebae5c0428b1346212488c15a5375aba1c99a042c4de53e8e8bf216fce7ab`

ไฟล์หลัก:

| ไฟล์ | SHA-256 |
|---|---|
| `public/material-workspace/index.html` | `aee96849b2a9f9aaa13be5ea613f7dd85fd68deba95e0e339298c83913ae53ff` |
| `public/material-workspace/style.css` | `0d857b0c0ba466d6a1012a8f9096d28f4a1ba2bd4905dd2d9420bfa53d6c57fe` |
| `public/material-workspace/shell.js` | `f82efe35e7bc5da0412e75520cbf72b353cd8c8ec368f3c5a8a6388957e6413e` |
| `public/material-workspace/business-launcher.js` | `107f80b0b4450f1dce4383febb2d62568e3ec99b912c88106451b7063ea9109c` |
| `public/material-workspace/business-tools.json` | `9817b4235ac57d1a50494b78637589b42f0c4fd5713dbeff5f9614880c8a9546` |
| `core/config/company-settings.ts` | `ec27cf26f4b8615dda68cdada75f0fb792c073406a11011ba826fb52d450e6d1` |
| `app/api/admin/settings/route.ts` | `cf3a2884836d6d688ab1bd29406a8c5d8f595af5fcba0e0ba7a59f0ab609a363` |
| `components/settings/SettingsDrawer.tsx` | `0542111a53bf842c76c359fbfd4044dc5ab898ef901c536363b072395d1e5e30` |
| `scripts/business-icon-shell-test.ts` | `d7814b3c1e95f486c26d14426b1de8a202752c08f60b0f20bee27ed58fce5022` |
| `app/api/admin/receipt-documents/route.ts` | `c8679e0558e59f03675c6b6ca7dc604149ac1e2b9d084f16f180abedfb33e3cf` |
| `app/admin/receipts/page.tsx` | `1e5679d625d345df37ecf6358b1e2023b4f93fe7bd134bc8a1210e9a8d142c3f` |

---

## SCREENSHOT

Browser จริง 1440×900 (Chromium):

| ไฟล์ | เนื้อหา |
|---|---|
| `/tmp/business-icon-shots/before-1-default.png` | Workspace ก่อนเปิด launcher |
| `/tmp/business-icon-shots/after-1-launcher.png` | Business Tool Launcher 6 กลุ่ม · โลโก้จริง · สถานะจาก Connect Registry |
| `/tmp/business-icon-shots/after-2-developer-tools.png` | เครื่องมือผู้พัฒนาแยกจากรายการธุรกิจ (54 รายการ/3 กลุ่ม) |
| `/tmp/business-icon-shots/after-3-profile-logo.png` | Company Profile menu + โลโก้ที่อัปโหลดผ่าน Storage เดิม |
| `/tmp/business-icon-shots/after-4-tool-route.png` | เปิด `/admin/pits` ในพื้นที่กลางเดิม + Back/Forward |

ภาพ regression ของงานก่อนหน้า: `/tmp/sidebar-shots/`, `/tmp/composer-shots/`, `/tmp/icon-shots/`

---

## ข้อจำกัดที่รายงานตรง (ไม่นับเป็น pass)

1. **ไม่มี session จริงบนเครื่องนี้** — `/api/admin/connectors`, `/api/admin/settings`, `/api/admin/upload` ตอบ 401; UI แสดง `UNAVAILABLE` ตามจริง. Browser Test intercept เฉพาะ response รูปแบบเดียวกับ route เดิมเพื่อตรวจการ map สถานะ/อัปโหลด ไม่ได้ยืนยันข้อมูล production
2. **ผู้ให้บริการที่ไม่มีหน้าจอ DNA OS** (Facebook, Messenger, Instagram, TikTok, Gmail, Outlook, Drive, Docs, Sheets) เปิดเว็บผู้ให้บริการจริงในแท็บใหม่ — ไม่สร้าง route ใหม่และไม่ fake หน้าในระบบ. เครื่องมือที่มี route เดิม (12 รายการ) ชี้ route เดิมและถูกตรวจว่ามี `page.tsx` จริง
3. **ไม่มีตำแหน่ง avatar บริษัทเดิมใน repo** — ใช้ปุ่มล่างสุดของ rail เดิมเหนือ `#settings`; ไม่ได้ออกแบบหน้า Company Profile ใหม่
4. **Bank Evidence ต้นฉบับ**: เพิ่มการแสดงภาพ/PDF จาก signed URL เดิมใน `/admin/receipts` แล้ว แต่ **browser-test เนื้อหาหน้านี้ไม่ได้** เพราะ `/admin/*` ถูก server guard ไป `/login` เมื่อไม่มี session — ตรวจได้ถึงระดับ typecheck และโครง route/API เดิม
5. **ยังไม่ deploy** ตามคำสั่ง และ `public/material-workspace/` + `public/brand/providers/` ยัง untracked ใน git
6. **ไม่มีการทดสอบกับ Provider ที่เชื่อมต่อจริง** — การอ่าน registry และการอัปโหลดโลโก้ต้องมี session/admin จริง; โค้ดใช้ API เดิมเท่านั้น ไม่มี credential ใหม่

---

## LOCKED

ล็อกเฉพาะขอบเขตนี้และหยุดรอ Owner:

- Tool Launcher (จุดเดียว `#toolsMain`)
- 6 กลุ่มเครื่องมือธุรกิจ + โลโก้จริง 12 ตัว
- สถานะจาก Connect Registry 4 แบบ
- Company Profile menu + โลโก้ผ่าน Storage/settings เดิม
- Sidebar/Header/Content Viewport Boundary
- Single Chat Composer เดิม

**STOP — รอ Owner เลือกหน้าจอธุรกิจถัดไป**

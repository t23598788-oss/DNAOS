# connections/tiktok-authorization

ต่อบัญชี **TikTok ที่ Owner เป็นเจ้าของ** เข้า DNA OS ด้วย OAuth จริง (TikTok Login
Kit v2 — authorization code + PKCE) แล้วให้ระบบควบคุมผ่าน capability/permission gate
เดียวกับ provider อื่น โดย **ไม่มี token ดิบอยู่นอก macOS Keychain เลย**

## ทำไมมันปลอดภัยตามหลักของ DNA OS

- `AGENT != AUTHORITY` — DNA OS สร้าง authorize URL ให้ แต่ **ผู้กดอนุญาตคือ Owner**
  ใน browser จริงเท่านั้น ไม่มีทางที่ AI จะได้ token มาเองโดยไม่ผ่านการกดของ Owner
- **ไม่เก็บ secret ดิบ** — access_token/refresh_token ไปอยู่ Keychain เป็น
  `credential_ref` (สตริงอ้างอิง) `store.ts` มียามปฏิเสธการเขียนถ้าเจอ field ชื่อ
  `access_token`/`refresh_token`/`client_secret`
- **ผ่านประตูจริง** — credential เขียนผ่าน `credentials/macos-keychain` (allowlist
  ของผู้เขียน credential มีชื่อไฟล์นี้อยู่) และ connection ลงทะเบียนผ่าน
  `registerConnectionDeclaration` ประตูเดียวกับ Railway/Supabase
- **ไม่มี success ปลอม** — ถ้ายังไม่มี TikTok app หรือ TikTok ปฏิเสธ ทุก path คืน
  reason จริงจาก TikTok ไม่มีการแต่งผลสำเร็จ

## Owner ต้องทำอะไร (สิ่งที่ DNA OS ทำแทนไม่ได้)

1. สร้าง TikTok app ที่ <https://developers.tiktok.com/> — เพิ่ม **Login Kit**,
   ตั้ง **Redirect URI**, ขอ **scope** ที่ต้องใช้ (เช่น `user.info.basic`,
   `video.publish`)
2. ตั้ง env สามตัวก่อนสตาร์ท service:
   - `TIKTOK_CLIENT_KEY` (สาธารณะ)
   - `TIKTOK_CLIENT_SECRET` (ความลับ — อ่านเข้าหน่วยความจำเฉพาะตอนแลก/เพิกถอน token)
   - `TIKTOK_REDIRECT_URI` (ต้องตรงกับที่ลงทะเบียนใน TikTok app เป๊ะ)
3. เปิด `authorize_url` ที่ `beginAuthorization` คืนมา แล้วกดอนุญาต

ตราบใดที่ยังไม่ทำข้อ 1–2 `beginAuthorization` จะคืน
`TIKTOK_OAUTH_CLIENT_NOT_CONFIGURED` พร้อม `owner_action` — สถานะจริงวันนี้

## วงจร

```
beginAuthorization(scope)
  → อ่าน env → สร้าง PKCE(code_verifier) + state → เก็บ record PENDING
  → คืน authorize_url  ── Owner เปิด browser กดอนุญาต ──►  TikTok redirect กลับพร้อม code+state
completeAuthorization(code, state)
  → ตรวจ state (กัน CSRF) → แลก code เป็น token (พร้อม code_verifier)
  → เขียน token ลง Keychain เป็น credential_ref → ยืนยัน open_id ผ่าน user info
  → mark CONNECTED (record ไม่เคยมี token ดิบ)
revokeAuthorization(connection_id)
  → mark credential + record REVOKED
```

## endpoint (ตรวจสดจากเอกสารทางการก่อนเขียน — ไม่เดา)

| ขั้น | endpoint |
|------|----------|
| authorize | `https://www.tiktok.com/v2/auth/authorize/` |
| token / refresh | `POST https://open.tiktokapis.com/v2/oauth/token/` |
| revoke | `POST https://open.tiktokapis.com/v2/oauth/revoke/` |
| user info | `GET https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,display_name,username` |

**ข้อจำกัดที่บอกตรง ๆ:** เอกสาร PKCE ของ TikTok ที่เข้าถึงได้ไม่ได้ระบุการ derive
`code_challenge` ชัด ไฟล์ `tiktok-oauth.ts` ทำตาม spec desktop คือ
`code_challenge = sha256Hex(code_verifier)` (hex ไม่ใช่ base64url) ปักไว้ด้วย test
vector ถ้า TikTok ปฏิเสธ มันจะตอบ error จริง ไม่กลายเป็น success ปลอม

## ทดสอบ

```
npx tsx connections/tiktok-authorization/tests/lifecycle.test.ts   # 35 ผ่าน (ไม่มี network/keychain จริง)
npx tsx connections/tiktok-authorization/register-declaration.ts   # ลงทะเบียน connection (idempotent)
```

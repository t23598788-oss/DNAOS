/**
 * หน้าที่: ค่าตั้งค่าที่ "ไม่ลับ" ของ GitHub adapter ตัวนี้ — base URL,
 * API version, Accept header, timeout, ขีดจำกัดจำนวน path ต่อหนึ่ง command.
 * ตามรูปแบบที่ `../../config/connection-settings/README.md` ประกาศไว้
 * (ค่าไม่ลับอยู่ในไฟล์ได้, secret ไปที่ env var เสมอ) และ
 * `../../config/environment/README.md` (ชื่อ env var คือ "ข้อมูล" ไม่ใช่
 * "ค่า" — ค่าจริงอ่านจาก `process.env` เฉพาะตอนใช้งาน).
 *
 * เหตุผลที่ไฟล์นี้อยู่ใน `connections/github/` ไม่ใช่ใน
 * `../../config/connection-settings/`: Capability Folder Law ข้อ 3 และ 7 —
 * config ของความสามารถหนึ่งอยู่ในโฟลเดอร์ของความสามารถนั้น เพื่อให้
 * แก้/ย้าย/ลบ/ตรวจ dependency ได้ "เป็นโฟลเดอร์เดียว".
 * `config/connection-settings/` ยังคง NOT_YET_BUILT (ไม่มี source ให้
 * import) — ที่นำมาใช้จริงคือ *รูปแบบ* ที่มันประกาศไว้ ไม่ใช่โค้ดของมัน
 *
 * Input: none (constants only).
 * Output: constants used by ./github-read-api.ts, ./payload-validation.ts,
 * and ./credential-resolution.ts.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: **ห้ามมีชื่อ repo/owner/branch ปลายทางเป็นค่า default ใน
 * ไฟล์นี้เด็ดขาด** — owner/repo/branch เป็นข้อมูลที่มากับ CommandEnvelope
 * เสมอ adapter ตัวนี้ต้องใช้ได้กับทุก repo. ห้ามมีค่า token จริงในไฟล์นี้
 * ทุกกรณี.
 *
 * แก้ไขโดยตั้งใจ (Owner, 2026-08-14): เดิมข้อความตรงนี้ห้ามมีชื่อ env var
 * ของ credential เป็นค่า default (ให้มาจาก `credential_ref.name` เท่านั้น,
 * ทำให้ adapter ใช้ได้กับ connection ใดก็ได้) — Owner สั่งกลับกฎนี้เฉพาะ
 * ส่วน "ชื่อ env var" โดยตรง: capability นี้ต้อง authenticate ผ่าน
 * `GITHUB_PAT_INFRASTRUCTURE` เป็นช่องทางเดียวเท่านั้น (ดู
 * `EXPECTED_GITHUB_CREDENTIAL_ENV_VAR_NAME` ด้านล่าง และ
 * `./credential-resolution.ts`) — เพื่อตัดความเป็นไปได้ที่ connection
 * จะถูกตั้งค่าผิดให้ไปอ่าน env var อื่นโดยไม่มีใครรู้ตัว owner/repo/branch
 * ปลายทางยังคงห้ามมีค่า default เหมือนเดิมทุกประการ — ที่เปลี่ยนคือ "ชื่อ
 * ช่องทาง credential" เท่านั้น ไม่ใช่ "ค่า credential"
 */

/** GitHub REST API base. Not per-connection today; if GitHub Enterprise Server is ever needed, that base URL becomes payload data, not a new constant here. */
export const GITHUB_API_BASE_URL = "https://api.github.com";

/** Pinned REST API version — GitHub's own recommended header (2022-11-28). */
export const GITHUB_API_VERSION = "2022-11-28";

export const GITHUB_ACCEPT_HEADER = "application/vnd.github+json";

/** GitHub requires a User-Agent; it identifies this adapter, and carries no account/business identity. */
export const GITHUB_USER_AGENT = "dna-os-infrastructure-github-adapter";

/** Every request in this capability is bounded — a hung connector must fail, not hang forever. */
export const GITHUB_REQUEST_TIMEOUT_MILLISECONDS = 30_000;

/** Upper bound on how many repo paths one read-status command may ask about, so one Command cannot fan out into unbounded API calls. */
export const MAX_STATUS_PATHS_PER_COMMAND = 50;

/** Hard cap on how much of a GitHub error body is copied into a reason string (bodies are error JSON, never business data). */
export const MAX_ERROR_BODY_CHARACTERS = 300;

/**
 * The ONLY env var name this capability's TEST/LEGACY credential
 * fallback will accept (Owner, 2026-08-14 — see the file header for why
 * this is a deliberate exception to "no default credential env var
 * name"). A `ConnectionRegistration.credential_ref.name` that names any
 * other variable is refused by ./credential-resolution.ts before any
 * network call — there is no second, third, or additional env-var
 * fallback channel.
 *
 * แก้ไข (STEP "Build Real GitHub Connection Registration + Keychain
 * Resolution"): this env var is no longer the canonical production
 * credential channel. The canonical path is a `credential_ref.kind ===
 * "keychain_ref"` connection (registered through
 * `connections/connection-registry/`), resolved through
 * `credentials/macos-keychain/`'s real, allowlisted `MacOsKeychainProvider`
 * — see ./credential-resolution.ts. This env var remains supported only
 * as an explicit, secondary TEST/LEGACY fallback.
 */
export const EXPECTED_GITHUB_CREDENTIAL_ENV_VAR_NAME = "GITHUB_PAT_INFRASTRUCTURE";

/**
 * หน้าที่: non-secret config for the research-engine adapter — base URL,
 * the two known endpoint paths, request timeout. Mirrors
 * `../github/adapter-config.ts`'s own reasoning (Capability Folder Law
 * ข้อ 3/7 — config ของความสามารถหนึ่งอยู่ในโฟลเดอร์ของความสามารถนั้น).
 *
 * There is no credential in this capability — DNA-LAB-PERMISSION-REASONER's
 * Research & Evaluation Engine is a read-only local HTTP service with no
 * documented auth today (see ../README.md). If that ever changes, the
 * credential channel goes through the same `credential_ref` /
 * `resolveXCredential` shape `../github/credential-resolution.ts` already
 * established — not invented fresh.
 *
 * Input: none (constants only).
 * Output: constants used by ./research-read-api.ts and
 * ./research-engine-adapter.ts.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: ห้ามมี credential/token ใดๆ ในไฟล์นี้ — capability นี้
 * ไม่มีช่องทาง credential ให้ตั้งค่า.
 */

/** Overridable only by the caller passing `{ baseUrl }` into ./research-engine-adapter.ts — this constant is the real default, not a fallback guess. */
export const RESEARCH_ENGINE_BASE_URL = "http://localhost:8787";

export const RESEARCH_ENGINE_HEALTH_PATH = "/api/research/health";
export const RESEARCH_ENGINE_LATEST_PATH = "/api/research/latest";

/** Every request in this capability is bounded — a hung connector must fail (BLOCKED), never hang forever. Kept short: this is a local service, not a WAN call. */
export const RESEARCH_ENGINE_REQUEST_TIMEOUT_MILLISECONDS = 5_000;

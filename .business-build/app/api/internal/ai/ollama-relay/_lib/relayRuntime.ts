/**
 * Ollama transport relay RUNTIME (RAILWAY↔MAC LOCAL AI CONNECTION, 2026-10-17).
 *
 * หน้าที่เดียว: transport ของงานตัดสินใจ intent.classify จากโปรเซส Next
 * (Railway) ไปหา Ollama ที่รันบนเครื่อง Mac ของเจ้าของ — โดย Mac เป็นฝ่าย
 * เชื่อมออกเท่านั้น (long-poll) เพราะ Railway ไม่ถูกพิสูจน์ว่าเข้าถึง Tailnet
 * ได้ และ Ollama 127.0.0.1:11434 ต้องไม่เปิดออกสาธารณะเด็ดขาด
 *
 * ห้ามสับสนกับ AI Gateway เดิม: โมดูลนี้ไม่มี capability/selection/evidence/
 * provider logic ใด ๆ — selection ยังอยู่ที่ services/ai/resolver.ts และ
 * invokeAiGateway() การเชื่อมนี้เพียงขยาย "ทางส่ง HTTP body ของ adapter"
 * ให้ถึงเครื่องที่รัน Ollama จริง (ตัว adapter และ body contract เดิมไม่ถูกแตะ
 * ยกเว้นฟิลด์ request_id ที่ใช้ correlate กับ log บน Mac)
 *
 * สัญญาความปลอดภัย (ทำซ้ำแบบเดียวกับ computeRelay ของระบบเดิม):
 *  - token เทียบแบบ timing-safe ผ่าน tokenMatches ของ computeRelayRuntime
 *    (ไม่เขียนเวอร์ชันคู่ขนาน ไม่มี token ใน URL/query, ไม่ log เนื้อ token)
 *  - face "generate" (การเรียกจาก adapter ภายใน container เดียวกัน) ยอมรับ
 *    เฉพาะ Host loopback ที่ port ที่โปรเซสฟังจริง — public host = 403 เสมอ
 *  - model ต้องอยู่ในรายการ allow-list ที่ฝั่ง relay บังคับ (ค่าเริ่ม qwen3:8b)
 *  - job อยู่ในหน่วยความจำโปรเซสนี้เท่านั้น หมดอายุตามเวลา (fail-closed;
 *    adapter ของ gateway มี timeout 60s ของตัวเองอยู่แล้ว)
 */
import { tokenMatches } from "@/app/api/admin/devices/_lib/computeRelayRuntime";

export interface OllamaRelayJob {
  request_id: string;
  model: string;
  system: string | null;
  prompt: string;
  images?: string[];
  created_at: string;
}

export interface OllamaRelayResultInput {
  request_id: string;
  ok: boolean;
  response_text?: string | null;
  error?: string | null;
}

const POLL_WAIT_MS_CAP = 25_000;

/** TTL ของงานที่ยังไม่มีใครมารับ (ยาวกว่า 60s adapter timeout อยู่ดี) */
const JOB_TTL_MS = 120_000;

/** เวลารอให้ Mac ตอบผล (น้อยกว่า adapter timeout 60s ให้ error มาจาก relay
 * อย่างมีนัยสำคัญ ไม่ใช่ AbortError ที่ตีความไม่ได้) */
export const RELAY_INFER_WAIT_MS = 55_000;

/** โมเดลที่ relay ยอมรับ (deny-by-default) — อ่านจาก env ได้ ค่าเริ่มจาก
 * โมเดลที่ registry ปักหมุดไว้กับ intent.classify อยู่แล้ว */
export function allowedRelayModels(): string[] {
  const extra = (process.env.DNA_AI_RELAY_ALLOWED_MODELS ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  return extra.length > 0 ? extra : ["qwen3:8b"];
}

export function relayTokenMatches(presented: string | null): boolean {
  const expected = (process.env.DNA_AI_RELAY_SHARED_SECRET ?? "").trim();
  if (!expected || !presented) return false;
  return tokenMatches(presented.trim(), expected);
}

/** เรียง Tailscale ให้ผ่าน? — จริง ๆ สคริปต์นี้ไม่มีสิทธิ์เดาเครือข่ายข้ามระบบ;
 * การเชื่อมเดียวเท่านั้นคือ Mac โพลออกอยั่งโถง HTTP ของ Railway ด้วย token. */

/** x-forwarded-for / x-real-ip เป็น loopback หรือไม่? ข้ามช่อง proxy หลายตัวได้
 * (เห็นเป็นรายการคั่นลูกโซ่ ยอมทุกดอกเป็น 127.0.0.1/::1) — ดูจากหัวแรกสุด */
export function isLoopbackIpList(value: string | null): boolean {
  if (!value) return true; // ไม่มีหัวนี้ → ไม่ผ่าน proxy → loopback แท้
  // จัดรูปเมื่อขึ้น๐ IPv4-mapped IPv6 (::ffff:127.0.0.1) เช่นที่ Next dev แนบจริง
  const raw = value.split(",")[0]!.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const ip = raw.startsWith("::ffff:") ? raw.slice(7) : raw;
  return ip === "127.0.0.1" || ip === "::1" || ip === ":1";
}

/** Host เรียกเข้ามาเป็น loopback จริงของ container นี้ (Railway inject PORT
 * ชื่อพอร์ตที่พูดจากฝั่งรับไม่จำเป็นต้องตรงเป๊ะ — คอลที่ไม่ได้ผ่าน proxy ภายนอก
 * มี header x-forwarded-for ผู้แนะให้มีเสมอ: generate face ของ route บังคับ
 * ไม่มีหัวอันนี้ด้วย — ผู้มาจากสาธารณะหลอก Host=127.0.0.1 จะถูกปฏิเสธ) */
export function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  const h = host.trim().toLowerCase();
  return /^(127\.0\.0\.1|localhost|\[::1\]|::1):\d+$/.test(h) || h === "[::1]";
}

// ── process-wide state (รอดจาก Next hot-reload ด้วย globalThis) ─────────────
type Waiter = {
  resolve: (out: { ok: true; response: string } | { ok: false; error: string }) => void;
  timer: ReturnType<typeof setTimeout>;
};

interface RelayStore {
  jobs: Map<string, OllamaRelayJob>;
  waiters: Map<string, Waiter>;
  /** ว่า request_id ล่าสุดเสร็จอย่างไร (รายงาน/ดีบักเชื่อมต่อ target บนจอเท่านั้น) */
  finished: Map<string, { ok: boolean; at: string; error?: string | null }>;
  clock: () => number;
}

const store: RelayStore =
  (globalThis as { __dnaOllamaRelayStore?: RelayStore }).__dnaOllamaRelayStore ?? (() => {
    const s: RelayStore = { jobs: new Map(), waiters: new Map(), finished: new Map(), clock: () => Date.now() };
    (globalThis as { __dnaOllamaRelayStore?: RelayStore }).__dnaOllamaRelayStore = s;
    return s;
  })();

export function relayEnabled(): boolean {
  return Boolean((process.env.DNA_AI_RELAY_SHARED_SECRET ?? "").trim());
}

function sweepExpired(): void {
  const now = store.clock();
  for (const [id, job] of store.jobs) {
    if (now - Number(new Date(job.created_at).getTime()) > JOB_TTL_MS) {
      store.jobs.delete(id);
      const w = store.waiters.get(id);
      if (w) { clearTimeout(w.timer); w.resolve({ ok: false, error: "AI_RELAY_JOB_EXPIRED" }); store.waiters.delete(id); }
    }
  }
  if (store.finished.size > 50) {
    const surplus = store.finished.size - 50;
    for (const k of [...store.finished.keys()].slice(0, surplus)) store.finished.delete(k);
  }
}

/** เข้าคิวงานและรอผล (max RELAY_INFER_WAIT_MS) — หนึ่ง request_id เดียวเท่านั้น */
export function enqueueAndWait(job: OllamaRelayJob): Promise<{ ok: true; response: string } | { ok: false; error: string }> {
  if (store.waiters.has(job.request_id) || store.jobs.has(job.request_id)) {
    return Promise.resolve({ ok: false, error: "AI_RELAY_REQUEST_ID_COLLISION" });
  }
  return new Promise((resolve) => {
    const w: Waiter = {
      resolve,
      timer: setTimeout(() => {
        if (store.waiters.delete(job.request_id)) resolve({ ok: false, error: "AI_RELAY_TIMEOUT_WAITING_FOR_DEVICE" });
      }, RELAY_INFER_WAIT_MS),
    };
    store.waiters.set(job.request_id, w);
    store.jobs.set(job.request_id, job);
    sweepExpired();
  });
}

/** รับงานเก่าสุด (worker โพลเรียก) — waitMs คือเวลาที่ยอมถือช่องว่างไว้ */
export async function takeJob(waitMs: number, tokenOk: boolean): Promise<OllamaRelayJob | { empty: true }> {
  if (!tokenOk) return { empty: true };
  sweepExpired();
  const wait = Math.min(Math.max(Number(waitMs) || 0, 0), POLL_WAIT_MS_CAP);
  const deadline = store.clock() + wait;
  for (;;) {
    sweepExpired();
    const oldest = [...store.jobs.values()].sort((a, b) => a.created_at.localeCompare(b.created_at))[0] ?? null;
    if (oldest) {
      store.jobs.delete(oldest.request_id);
      return oldest;
    }
    if (store.clock() >= deadline) return { empty: true };
    await new Promise((r) => setTimeout(r, 400));
  }
}

/** ผลงานย้อนกลับจาก worker — request_id ต้องตรงกับ waiter ที่รออยู่จริง */
export function completeJob(input: OllamaRelayResultInput): { matched: boolean } {
  const w = store.waiters.get(input.request_id);
  if (!w) return { matched: false };
  store.waiters.delete(input.request_id);
  clearTimeout(w.timer);
  store.finished.set(input.request_id, { ok: input.ok, at: new Date().toISOString(), error: input.error ?? null });
  if (input.ok && typeof input.response_text === "string" && input.response_text.trim()) {
    w.resolve({ ok: true, response: input.response_text.trim() });
  } else {
    w.resolve({ ok: false, error: input.error ?? "AI_RELAY_EMPTY_DEVICE_RESULT" });
  }
  return { matched: true };
}

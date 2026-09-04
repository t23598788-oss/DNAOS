/**
 * R2 · สกัดหลักฐานขอบเขตจากซอร์สจริง
 *
 * ใช้ได้เมื่อหลักฐานใน Registry ไม่พอเท่านั้น (พิสูจน์แล้วว่าไม่พอ: 39 ฟิลด์
 * resolve ได้เฉลี่ย 6.6) ทุกค่าที่คืนออกไปต้องมาพร้อมไฟล์และรูปแบบที่พบจริง
 * ไม่พบรูปแบบ = ไม่คืนค่า ไม่ใช่คืนค่าว่าง
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

export interface Cited<T> { readonly value: T; readonly evidence: string; }
export const cite = <T>(value: T, evidence: string): Cited<T> => ({ value, evidence });

const REPO_PREFIX = "DNA-OS-INFRASTRUCTURE/";

/** แปลง source_location ของทะเบียนเป็นรายการไฟล์จริง — คืน [] เมื่อชี้ไปที่ที่ไม่มีอยู่ */
export function resolveSources(location: string): { files: string[]; note: string } {
  if (!location) return { files: [], note: "ไม่มี source_location" };
  if (/EXTERNAL REPOSITORY|NOT YET PHYSICALLY MIGRATED/i.test(location)) {
    return { files: [], note: "อยู่นอกรีโปนี้" };
  }
  const parts = location.split("+").map((s) => s.trim()).filter(Boolean);
  const files: string[] = [];
  for (const raw of parts) {
    let p = raw.startsWith(REPO_PREFIX) ? raw.slice(REPO_PREFIX.length) : raw;
    p = p.replace(/\s*\(.*\)\s*$/, "").trim();
    if (p.startsWith("/")) continue; // path สัมบูรณ์นอกรีโป
    if (!existsSync(p)) continue;
    const st = statSync(p);
    if (st.isDirectory()) {
      for (const f of readdirSync(p)) {
        const full = join(p, f);
        if (statSync(full).isFile() && [".ts", ".mjs", ".js", ".py"].includes(extname(f))) files.push(full);
      }
    } else if (st.isFile()) files.push(p);
  }
  return { files, note: files.length > 0 ? "" : "ชี้ไปที่ที่ไม่มีอยู่จริง" };
}

interface Probe { readonly key: string; readonly re: RegExp; }

const FS_PROBES: readonly Probe[] = [
  { key: "อ่าน/เขียนไฟล์ (node:fs)", re: /from\s+"node:fs"|require\("node:fs"\)|readFileSync|writeFileSync|appendFileSync/ },
  { key: "ระบบไฟล์แบบ promise", re: /node:fs\/promises/ },
];
const NET_PROBES: readonly Probe[] = [
  { key: "HTTP ขาออก (fetch)", re: /\bfetch\s*\(/ },
  { key: "HTTP server", re: /createServer\s*\(|\.listen\s*\(/ },
  { key: "node:http/https", re: /from\s+"node:https?"/ },
];
const OS_PROBES: readonly Probe[] = [
  { key: "รันโปรเซสภายนอก", re: /child_process|execFileSync|execSync|spawnSync/ },
  { key: "ควบคุมหน้าจอ/อินพุต", re: /CGEvent|cliclick|osascript/ },
  { key: "ควบคุมเบราว์เซอร์", re: /puppeteer|WebSocket|devtools|CDP/ },
];
const AUTH_PROBES: readonly Probe[] = [
  { key: "ผ่าน Write Gate", re: /permissions\/write-gate|evaluateWriteIntent/ },
  { key: "ต้องมี authority lease", re: /validateAuthority|authority_id/ },
  { key: "ต้องมี owner session", re: /requireOwnerSession|validateOwnerSession/ },
  { key: "อ้างอิง credential registry", re: /credentials\/registry|credential_ref/ },
];

function scan(files: readonly string[], probes: readonly Probe[]): Cited<string[]> | null {
  const hits = new Map<string, string>();
  for (const f of files) {
    let text = "";
    try { text = readFileSync(f, "utf8"); } catch { continue; }
    for (const p of probes) if (p.re.test(text) && !hits.has(p.key)) hits.set(p.key, f);
  }
  if (hits.size === 0) return null;
  return cite([...hits.keys()], [...hits.entries()].map(([k, f]) => `${k} @ ${f}`).join(" · "));
}

export const fsAccess = (f: readonly string[]) => scan(f, FS_PROBES);
export const netAccess = (f: readonly string[]) => scan(f, NET_PROBES);
export const osAccess = (f: readonly string[]) => scan(f, OS_PROBES);
export const authSignals = (f: readonly string[]) => scan(f, AUTH_PROBES);

/** สภาพแวดล้อมการรัน — ตัดสินจากนามสกุลไฟล์จริง ไม่ใช่จากชื่อโมดูล */
export function runtimeEnv(files: readonly string[]): Cited<string> | null {
  const ext = new Set(files.map((f) => extname(f)));
  if (ext.has(".py")) return cite("python", `พบไฟล์ .py: ${files.find((f) => f.endsWith(".py"))}`);
  if (ext.has(".ts") || ext.has(".mjs") || ext.has(".js")) {
    return cite("node", `พบไฟล์ ${[...ext].join("/")}: ${files[0]}`);
  }
  return null;
}

/** ฟิลด์บังคับของชนิดที่สัญญาระบุ — อ่านจาก interface/type จริงในซอร์ส */
export function requiredFieldsOf(typeNames: readonly string[], files: readonly string[]): Cited<string[]> | null {
  const out: string[] = []; const where: string[] = [];
  for (const t of typeNames) {
    const name = t.replace(/[^A-Za-z0-9_]/g, "");
    if (!name) continue;
    for (const f of files) {
      let text = "";
      try { text = readFileSync(f, "utf8"); } catch { continue; }
      const m = new RegExp(`(?:interface|type)\\s+${name}\\b[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(text);
      if (!m) continue;
      for (const line of m[1].split("\n")) {
        const fm = /^\s*(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)(\??)\s*:/.exec(line);
        if (fm && fm[2] !== "?") out.push(`${name}.${fm[1]}`);
      }
      where.push(`${name} @ ${f}`);
      break;
    }
  }
  return out.length > 0 ? cite(out, where.join(" · ")) : null;
}

/** สัญญาข้อผิดพลาด — reason_code ที่ประกาศจริงในซอร์ส */
export function errorContract(files: readonly string[]): Cited<string[]> | null {
  const codes = new Set<string>(); const where: string[] = [];
  for (const f of files) {
    let text = "";
    try { text = readFileSync(f, "utf8"); } catch { continue; }
    let found = false;
    for (const m of text.matchAll(/reason_code:\s*"([A-Z][A-Z0-9_]{2,})"/g)) { codes.add(m[1]); found = true; }
    for (const m of text.matchAll(/\breturn\s+deny\("([A-Z][A-Z0-9_]{2,})"/g)) { codes.add(m[1]); found = true; }
    if (found) where.push(f);
  }
  return codes.size > 0 ? cite([...codes].sort(), where.join(" · ")) : null;
}

/** เส้นทางพิสูจน์ — มี tests/ หรือ probe.ts จริงไหม */
export function verificationPath(location: string): Cited<{ method: string; evidence: string[] }> | null {
  let p = location.startsWith(REPO_PREFIX) ? location.slice(REPO_PREFIX.length) : location;
  p = p.split("+")[0].trim().replace(/\s*\(.*\)\s*$/, "");
  if (!p || p.startsWith("/") || !existsSync(p)) return null;
  const dir = statSync(p).isDirectory() ? p : p.replace(/\/[^/]+$/, "");
  const found: string[] = [];
  const t = join(dir, "tests");
  if (existsSync(t) && statSync(t).isDirectory()) {
    for (const f of readdirSync(t)) if (/\.test\.(ts|mjs|js)$/.test(f)) found.push(join(t, f));
  }
  const probe = join(dir, "probe.ts");
  if (existsSync(probe)) found.push(probe);
  if (found.length === 0) return null;
  return cite({ method: found.some((f) => f.endsWith("probe.ts")) ? "probe + test suite" : "test suite", evidence: found },
              `พบใน ${dir}: ${found.length} ไฟล์`);
}

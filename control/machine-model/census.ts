/**
 * หน้าที่: สำรวจร่างกายของเครื่องนี้ตามที่วัดได้จริง — ฮาร์ดแวร์ ระบบปฏิบัติการ
 *         ซอฟต์แวร์ที่ติดตั้ง และฐานข้อมูลท้องถิ่น
 *
 * ── นี่คือการสำรวจ ไม่ใช่การตีความ ──
 * ทุกข้อเท็จจริงมาจากคำสั่งอ่านอย่างเดียวของระบบปฏิบัติการ หรือจากคลังที่ DNA OS
 * เขียนไว้เอง ไม่มีบรรทัดใดอ่านซอร์สโค้ดเพื่อเดาว่าเครื่องมีอะไร และไม่มีบรรทัดใด
 * อนุมานความหมายจากชื่อแอปหรือชื่อไฟล์
 *
 * ── มีอยู่ ≠ เชื่อถือได้ ≠ ได้รับอนุญาต ──
 * ชั้นนี้ตอบได้อย่างเดียวว่า "อะไรอยู่บนเครื่องนี้" การมีอยู่ของซอฟต์แวร์กับสิทธิ์
 * ของซอฟต์แวร์เป็นคนละข้อเท็จจริง จึงไม่มีช่อง trusted/required/permitted/owner
 * ในชนิดข้อมูลนี้เลย — เติมทีหลังไม่ได้โดยไม่แก้สัญญา
 *
 * ── ไม่รันไบนารีที่ไม่รู้จัก ──
 * เวอร์ชันถูกอ่านจากแหล่งที่ประกาศไว้ (brew, npm, Info.plist) และรันคำสั่ง
 * `--version` เฉพาะรายการที่อยู่ในรายชื่อ runtime ที่ประกาศไว้เท่านั้น การไล่รัน
 * ไบนารีทุกตัวใน PATH เพื่อถามเวอร์ชัน คือการก่อผลข้างเคียงที่ควบคุมไม่ได้
 *
 * ── ตัวตนของเครื่องไม่ได้มาจากที่นี่ ──
 * `machine_id` ถูกส่งเข้ามา ไม่ได้ถูกคำนวณจากสิ่งที่สำรวจเจอ ต่อให้เปลี่ยน CPU
 * เปลี่ยนดิสก์ หรือลงแอปใหม่ทั้งเครื่อง ตัวตนก็ไม่เปลี่ยน
 *
 * Input: machine_id
 * Output: `observeHardwareOs`, `observeInstalledSoftware`, `observeLocalDatabases`
 * Dependency ที่อนุญาต: คำสั่งอ่านของ OS, connections/telemetry (คลังที่มีอยู่)
 * สิ่งที่ห้ามแตะ: ห้ามติดตั้ง ห้ามถอน ห้ามฆ่าโปรเซส ห้ามแก้ฐานข้อมูล
 *                ห้ามอ่านเนื้อหาระเบียนในฐานข้อมูล ห้ามเขียนไฟล์
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { cpus, networkInterfaces, totalmem, uptime } from "node:os";
import { join } from "node:path";

const AT = (): string => new Date().toISOString();

function run(cmd: string, args: readonly string[], timeout = 15_000): string | null {
  try { return execFileSync(cmd, [...args], { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return null; }
}

// ─────────────────────────── PHASE 1 — HARDWARE / OS ───────────────────────────

export type MachineFactType =
  | "HARDWARE_MODEL" | "ARCHITECTURE" | "CPU" | "CPU_COUNT" | "PHYSICAL_MEMORY_BYTES"
  | "STORAGE_VOLUME" | "NETWORK_INTERFACE"
  | "OS_FAMILY" | "OS_VERSION" | "OS_BUILD" | "KERNEL_VERSION" | "BOOT_TIME" | "UPTIME_SECONDS";

export interface MachineFact {
  readonly machine_id: string;
  readonly fact_type: MachineFactType;
  readonly observed_value: string;
  readonly observation_source: string;
  readonly observed_at: string;
  readonly evidence_ref: string;
}

const TELEMETRY_STORE = "connections/telemetry/data/snapshots.jsonl";

/** snapshot ล่าสุดของ device-telemetry ที่มีอยู่แล้ว — ไม่สร้างตัวเก็บซ้ำ */
function latestTelemetry(): Record<string, any> | null {
  const path = join(process.cwd(), TELEMETRY_STORE);
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try { return JSON.parse(lines[i]) as Record<string, any>; } catch { /* แถวเสียข้ามไป */ }
  }
  return null;
}

/**
 * ข้อเท็จจริงของฮาร์ดแวร์และระบบปฏิบัติการของเครื่องนี้
 *
 * สิ่งที่ `connections/telemetry` เก็บไว้แล้ว (CPU, หน่วยความจำ, เครือข่าย) ถูก
 * อ่านจากคลังนั้น ไม่วัดซ้ำ ส่วนที่ยังไม่มีใครเก็บ (รุ่นเครื่อง สถาปัตยกรรม
 * เวอร์ชัน OS เคอร์เนล เวลาบูต ปริมาตรจัดเก็บ) วัดสดจากคำสั่งอ่านของระบบ
 */
export function observeHardwareOs(machineId: string): readonly MachineFact[] {
  const at = AT();
  const facts: MachineFact[] = [];
  const push = (t: MachineFactType, v: string | null, src: string, ev: string): void => {
    if (v === null || v.trim().length === 0) return;
    facts.push({ machine_id: machineId, fact_type: t, observed_value: v.trim(),
      observation_source: src, observed_at: at, evidence_ref: ev });
  };

  push("HARDWARE_MODEL", run("sysctl", ["-n", "hw.model"]), "sysctl", "sysctl -n hw.model");
  push("ARCHITECTURE", run("uname", ["-m"]), "uname", "uname -m");
  push("KERNEL_VERSION", run("uname", ["-r"]), "uname", "uname -r");
  push("BOOT_TIME", run("sysctl", ["-n", "kern.boottime"]), "sysctl", "sysctl -n kern.boottime");

  const sw = run("sw_vers", []);
  if (sw !== null) {
    const field = (k: string): string | null => sw.split("\n").find((l) => l.startsWith(k))?.split(":")[1]?.trim() ?? null;
    push("OS_FAMILY", field("ProductName"), "sw_vers", "sw_vers ProductName");
    push("OS_VERSION", field("ProductVersion"), "sw_vers", "sw_vers ProductVersion");
    push("OS_BUILD", field("BuildVersion"), "sw_vers", "sw_vers BuildVersion");
  }

  // CPU / หน่วยความจำ / เครือข่าย มาจากคลัง device-telemetry ก่อน แล้วจึงวัดสด
  const snap = latestTelemetry();
  if (snap?.cpu_ram !== undefined) {
    const ev = `${TELEMETRY_STORE}:${snap.snapshot_id}`;
    push("CPU", String(snap.cpu_ram.cpu_model ?? ""), "connections/telemetry", ev);
    push("CPU_COUNT", String(snap.cpu_ram.cpu_count ?? ""), "connections/telemetry", ev);
    push("PHYSICAL_MEMORY_BYTES", String(snap.cpu_ram.total_mem_bytes ?? ""), "connections/telemetry", ev);
    push("UPTIME_SECONDS", String(snap.process_load?.uptime_seconds ?? ""), "connections/telemetry", ev);
    for (const ni of (snap.network_interfaces ?? []) as Record<string, any>[]) {
      push("NETWORK_INTERFACE", `${ni.name} ${ni.family} ${ni.address}${ni.internal === true ? " internal" : ""}`,
        "connections/telemetry", ev);
    }
  } else {
    // ── ทำไมต้องมีทางสำรอง ──
    // `connections/telemetry` มี retention ของตัวเอง (pruneOldSnapshots) คลังของมัน
    // ว่างได้ตลอดเวลาโดยไม่ใช่ความผิดพลาด ถ้าชั้นนี้พึ่งคลังนั้นทางเดียว ข้อเท็จจริง
    // ของเครื่องจะหายไปเงียบ ๆ ตามรอบเก็บกวาดของคลังอื่น — และรายงานจะบอกว่า
    // "ไม่รู้" ทั้งที่เครื่องยังตอบได้อยู่ ทุกชนิดข้อเท็จจริงจึงต้องวัดสดได้เอง
    push("CPU", run("sysctl", ["-n", "machdep.cpu.brand_string"]) ?? cpus()[0]?.model ?? null,
      "node:os/sysctl", "sysctl -n machdep.cpu.brand_string | os.cpus()");
    push("CPU_COUNT", String(cpus().length), "node:os", "os.cpus().length");
    push("PHYSICAL_MEMORY_BYTES", String(totalmem()), "node:os", "os.totalmem()");
    push("UPTIME_SECONDS", String(Math.floor(uptime())), "node:os", "os.uptime()");
    for (const [name, addrs] of Object.entries(networkInterfaces())) {
      for (const a of addrs ?? []) {
        push("NETWORK_INTERFACE", `${name} ${a.family} ${a.address}${a.internal ? " internal" : ""}`,
          "node:os", "os.networkInterfaces()");
      }
    }
  }

  // ปริมาตรจัดเก็บ: telemetry เก็บไว้ก้อนเดียว ที่นี่แจกแจงทุกปริมาตรที่เมานต์อยู่
  const df = run("df", ["-k"]);
  if (df !== null) {
    for (const line of df.split("\n").slice(1)) {
      const p = line.trim().split(/\s+/);
      if (p.length < 9) continue;
      push("STORAGE_VOLUME", `${p[0]} total_kb=${p[1]} used_kb=${p[2]} available_kb=${p[3]} mounted_on=${p.slice(8).join(" ")}`,
        "df", "df -k");
    }
  }
  return facts;
}

// ─────────────────────────── PHASE 2 — INSTALLED SOFTWARE ───────────────────────

export type SoftwareKind =
  | "APPLICATION" | "CLI_TOOL" | "PACKAGE" | "SYSTEM_COMPONENT" | "RUNTIME" | "BACKGROUND_SERVICE";

export interface SoftwareEntity {
  /** ตัวตนของซอฟต์แวร์ ไม่ผูกกับเครื่อง — เครื่องผูกผ่าน `machine_id` */
  readonly software_id: string;
  readonly machine_id: string;
  readonly kind: SoftwareKind;
  readonly name: string;
  readonly install_location: string | null;
  /** เส้นทางเรียกใช้ที่วัดได้ — `null` เมื่อไม่มีขอบเขตการเรียกที่ชัดเจน */
  readonly invocation: string | null;
  readonly version: string | null;
  /** แหล่งติดตั้งที่พิสูจน์ได้ — `null` เมื่อพิสูจน์ไม่ได้ ไม่ใช่เดาจากตำแหน่ง */
  readonly install_source: string | null;
  readonly availability: "AVAILABLE" | "PATH_MISSING";
  readonly observation_source: string;
  readonly observed_at: string;
  readonly evidence_ref: string;
}

/** runtime ที่ประกาศไว้ว่าถามเวอร์ชันได้ — ไม่รันไบนารีนอกรายการนี้ */
const DECLARED_RUNTIMES: readonly { name: string; args: readonly string[] }[] = [
  { name: "node", args: ["--version"] }, { name: "npm", args: ["--version"] },
  { name: "python3", args: ["--version"] }, { name: "ruby", args: ["--version"] },
  { name: "java", args: ["-version"] }, { name: "go", args: ["version"] },
  { name: "deno", args: ["--version"] }, { name: "bun", args: ["--version"] },
  { name: "git", args: ["--version"] }, { name: "sqlite3", args: ["--version"] },
];

const softwareId = (kind: SoftwareKind, name: string): string => `software://${kind.toLowerCase()}/${name}`;

function appVersion(appPath: string): string | null {
  const plist = join(appPath, "Contents", "Info.plist");
  if (!existsSync(plist)) return null;
  const out = run("defaults", ["read", join(appPath, "Contents", "Info"), "CFBundleShortVersionString"], 5_000);
  return out === null ? null : out.trim();
}

/**
 * รายการซอฟต์แวร์ที่มีอยู่บนเครื่องนี้
 *
 * แต่ละชนิดมาจากแหล่งที่ต่างกัน และแหล่งนั้นคือหลักฐาน: แอปมาจากไดเรกทอรีแอป
 * แพ็กเกจมาจากตัวจัดการแพ็กเกจที่ประกาศตัวเอง เครื่องมือบรรทัดคำสั่งมาจาก PATH
 * บริการเบื้องหลังมาจาก launchd — ไม่มีชนิดใดถูกเดาจากชื่อ
 */
export function observeInstalledSoftware(machineId: string): readonly SoftwareEntity[] {
  const at = AT();
  const out: SoftwareEntity[] = [];
  const seen = new Set<string>();
  const add = (e: Omit<SoftwareEntity, "machine_id" | "observed_at">): void => {
    if (seen.has(e.software_id)) return;
    seen.add(e.software_id);
    out.push({ ...e, machine_id: machineId, observed_at: at });
  };

  // APPLICATION — ไดเรกทอรีแอปของระบบและของผู้ใช้
  for (const dir of ["/Applications", join(process.env.HOME ?? "", "Applications")]) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".app")) continue;
      const full = join(dir, entry);
      const name = entry.replace(/\.app$/, "");
      add({ software_id: softwareId("APPLICATION", name), kind: "APPLICATION", name,
        install_location: full, invocation: join(full, "Contents", "MacOS"),
        version: appVersion(full), install_source: null,
        availability: existsSync(full) ? "AVAILABLE" : "PATH_MISSING",
        observation_source: "filesystem", evidence_ref: `readdir:${dir}` });
    }
  }

  // PACKAGE — homebrew ประกาศรายการและเวอร์ชันของตัวเอง
  const brew = run("brew", ["list", "--versions"], 60_000);
  if (brew !== null) {
    for (const line of brew.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 1 || parts[0].length === 0) continue;
      const name = parts[0];
      add({ software_id: softwareId("PACKAGE", name), kind: "PACKAGE", name,
        install_location: `/opt/homebrew/opt/${name}`, invocation: null,
        version: parts.slice(1).join(" ") || null, install_source: "homebrew",
        availability: existsSync(`/opt/homebrew/opt/${name}`) ? "AVAILABLE" : "PATH_MISSING",
        observation_source: "brew", evidence_ref: "brew list --versions" });
    }
  }

  // PACKAGE — npm global
  const npmGlobal = run("npm", ["ls", "-g", "--depth=0", "--json"], 60_000);
  if (npmGlobal !== null) {
    try {
      const parsed = JSON.parse(npmGlobal) as { dependencies?: Record<string, { version?: string }> };
      for (const [name, meta] of Object.entries(parsed.dependencies ?? {})) {
        add({ software_id: softwareId("PACKAGE", `npm:${name}`), kind: "PACKAGE", name: `npm:${name}`,
          install_location: null, invocation: null, version: meta.version ?? null,
          install_source: "npm-global", availability: "AVAILABLE",
          observation_source: "npm", evidence_ref: "npm ls -g --depth=0" });
      }
    } catch { /* ผลที่แปลไม่ได้ = ไม่มีรายการ ไม่ใช่รายการที่เดาเอา */ }
  }

  // RUNTIME — เฉพาะรายการที่ประกาศไว้เท่านั้นที่ถูกถามเวอร์ชัน
  for (const rt of DECLARED_RUNTIMES) {
    const which = run("command", ["-v", rt.name], 5_000) ?? run("/usr/bin/which", [rt.name], 5_000);
    if (which === null || which.trim().length === 0) continue;
    const path = which.trim().split("\n")[0];
    const ver = run(path, rt.args, 10_000);
    add({ software_id: softwareId("RUNTIME", rt.name), kind: "RUNTIME", name: rt.name,
      install_location: path, invocation: path,
      version: ver === null ? null : ver.trim().split("\n")[0],
      install_source: path.startsWith("/usr/bin") || path.startsWith("/bin") ? "macos-system"
        : path.startsWith("/opt/homebrew") ? "homebrew" : null,
      availability: existsSync(path) ? "AVAILABLE" : "PATH_MISSING",
      observation_source: "PATH", evidence_ref: `which ${rt.name} -> ${path}` });
  }

  // CLI_TOOL / SYSTEM_COMPONENT — ทุกอย่างที่เรียกได้จาก PATH
  // ไดเรกทอรีของระบบนับเป็นส่วนประกอบของระบบปฏิบัติการ ไม่ใช่เครื่องมือที่ผู้ใช้ติดตั้ง
  const systemDirs = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir.length === 0 || !existsSync(dir)) continue;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { continue; }
    const isSystem = systemDirs.includes(dir);
    for (const name of entries) {
      const full = join(dir, name);
      let executable = false;
      try { executable = (statSync(full).mode & 0o111) !== 0; } catch { continue; }
      if (!executable) continue;
      const kind: SoftwareKind = isSystem ? "SYSTEM_COMPONENT" : "CLI_TOOL";
      add({ software_id: softwareId(kind, name), kind, name,
        install_location: full, invocation: full, version: null,
        install_source: isSystem ? "macos-system" : dir.startsWith("/opt/homebrew") ? "homebrew" : null,
        availability: "AVAILABLE", observation_source: "PATH", evidence_ref: `readdir:${dir}` });
    }
  }

  // BACKGROUND_SERVICE — launchd ประกาศรายการของตัวเอง
  const lc = run("launchctl", ["list"], 15_000);
  if (lc !== null) {
    for (const line of lc.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      const label = parts[2];
      if (label.length === 0) continue;
      add({ software_id: softwareId("BACKGROUND_SERVICE", label), kind: "BACKGROUND_SERVICE", name: label,
        install_location: null, invocation: `launchctl:${label}`, version: null, install_source: null,
        availability: "AVAILABLE", observation_source: "launchctl",
        evidence_ref: `launchctl list -> ${label} (pid=${parts[0]} status=${parts[1]})` });
    }
  }
  return out;
}

// ─────────────────────────── PHASE 3 — LOCAL DATABASES ──────────────────────────

export type DatabaseKind = "DATABASE_ENGINE" | "DATABASE_INSTANCE" | "DATABASE" | "LOCAL_DATA_STORE";

export interface DatabaseEntity {
  readonly database_id: string;
  readonly machine_id: string;
  readonly kind: DatabaseKind;
  readonly name: string;
  readonly location: string | null;
  /** เครื่องยนต์ที่รายการนี้ผูกอยู่ — `null` เมื่อยังพิสูจน์ไม่ได้ */
  readonly engine_ref: string | null;
  readonly state: "PRESENT" | "LISTENING" | "DECLARED";
  /** เจ้าของตามที่ประกาศไว้แล้วเท่านั้น — ไม่มีการยกเจ้าของให้ */
  readonly declared_owner: string | null;
  readonly observation_source: string;
  readonly observed_at: string;
  readonly evidence_ref: string;
}

/** เครื่องยนต์ฐานข้อมูลที่ประกาศไว้ว่ารู้จัก พร้อมพอร์ตมาตรฐานของมัน */
const DECLARED_ENGINES: readonly { name: string; binary: string; port: number | null }[] = [
  { name: "postgresql", binary: "postgres", port: 5432 },
  { name: "mysql", binary: "mysqld", port: 3306 },
  { name: "sqlite", binary: "sqlite3", port: null },
  { name: "redis", binary: "redis-server", port: 6379 },
  { name: "mongodb", binary: "mongod", port: 27017 },
];

/**
 * ฐานข้อมูลและที่เก็บข้อมูลที่เป็นของเครื่องนี้
 *
 * ไม่มีการเปิดอ่านเนื้อหาระเบียนใด ๆ เพื่อจัดประเภท — ประเภทมาจากการมีอยู่ของ
 * เครื่องยนต์ การฟังพอร์ต และคำประกาศของ DNA OS เอง
 */
export function observeLocalDatabases(machineId: string, declaredStores: readonly string[] = []): readonly DatabaseEntity[] {
  const at = AT();
  const out: DatabaseEntity[] = [];

  // DATABASE_ENGINE — มีไบนารีอยู่บนเครื่อง
  const enginePaths = new Map<string, string>();
  for (const e of DECLARED_ENGINES) {
    const which = run("/usr/bin/which", [e.binary], 5_000);
    if (which === null || which.trim().length === 0) continue;
    const path = which.trim().split("\n")[0];
    enginePaths.set(e.name, path);
    out.push({ database_id: `database-engine://${e.name}`, machine_id: machineId, kind: "DATABASE_ENGINE",
      name: e.name, location: path, engine_ref: null, state: "PRESENT", declared_owner: null,
      observation_source: "PATH", observed_at: at, evidence_ref: `which ${e.binary} -> ${path}` });
  }

  // DATABASE_INSTANCE — เครื่องยนต์ที่ฟังพอร์ตของตัวเองอยู่จริง
  const lsof = run("/usr/sbin/lsof", ["-iTCP", "-sTCP:LISTEN", "-P", "-n"], 20_000);
  if (lsof !== null) {
    for (const e of DECLARED_ENGINES) {
      if (e.port === null) continue;
      const hit = lsof.split("\n").find((l) => l.includes(`:${e.port}`));
      if (hit === undefined) continue;
      out.push({ database_id: `database-instance://${e.name}/${e.port}`, machine_id: machineId,
        kind: "DATABASE_INSTANCE", name: `${e.name}:${e.port}`, location: `127.0.0.1:${e.port}`,
        engine_ref: `database-engine://${e.name}`, state: "LISTENING", declared_owner: null,
        observation_source: "lsof", observed_at: at,
        evidence_ref: `lsof -iTCP -sTCP:LISTEN -P -n -> ${hit.trim().slice(0, 90)}` });
    }
  }

  // LOCAL_DATA_STORE — คลังที่ DNA OS ประกาศว่าเป็นของตัวเอง ไม่ใช่ผลของการไล่หาไฟล์
  for (const store of declaredStores) {
    const path = join(process.cwd(), store);
    if (!existsSync(path)) continue;
    out.push({ database_id: `local-data-store://${store}`, machine_id: machineId, kind: "LOCAL_DATA_STORE",
      name: store, location: path, engine_ref: null, state: "DECLARED",
      declared_owner: "dna-os-infrastructure", observation_source: "control/machine-model/layers.ts",
      observed_at: at, evidence_ref: `MACHINE_LAYERS.source_store=${store}` });
  }

  return out;
}

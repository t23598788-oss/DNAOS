/**
 * หน้าที่: reads what macOS says about live processes, and turns only the
 * evidenced parts into relationships (Owner, 2026-08-26).
 *
 * TWO REAL SOURCES, BOTH READ-ONLY: `ps` for identity/lineage/argv/start time,
 * `lsof -p <pid>` for the mapped binary, cwd, open files and sockets. Nothing
 * here writes, signals, or attaches to a process.
 *
 * THE `comm` NAME IS NEVER USED AS EVIDENCE. `executable` is `lsof`'s `ftxt`
 * entry — the binary actually mapped into the process. A process called "node"
 * that maps `/Applications/Visual Studio Code.app/.../Code Helper` is a VS Code
 * helper because of the PATH, not the name; and a process whose ftxt cannot be
 * read gets `executable: null` and an entry in `unknown`, not a guess.
 *
 * SCOPED BY PID. `lsof` is run per process, only for the pids a caller asks
 * about. There is no machine-wide `lsof` sweep here.
 *
 * Input: `observeProcesses(pids)` / `findProcessesUnderPath(prefix)`.
 * Output: `ProcessObservation[]`, `relationshipsFor(observation)`.
 * Dependency ที่อนุญาต: ./types.ts, node built-ins.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามสรุปเจ้าของ process จากชื่อ.
 * - ห้ามสร้าง relationship ที่ไม่มีบรรทัด output รองรับ.
 * - ห้ามส่งสัญญาณหรือแก้ process ใดๆ.
 */

declare const require: any;

import type { ObservedRelationship, ProcessObservation } from "./types";

const { execFileSync } = require("node:child_process");

function run(command: string, args: readonly string[]): string {
  try {
    return String(execFileSync(command, args as string[], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return "";
  }
}

export interface PsRow { pid: number; ppid: number; user: string; started_at: string; argv: string }

/** `ps` for every process — identity and lineage only. Cheap, and it is the kernel's own table. */
export function listProcesses(): readonly PsRow[] {
  const out = run("/bin/ps", ["-axo", "pid=,ppid=,user=,lstart=,args="]);
  const rows: PsRow[] = [];
  for (const line of out.split("\n")) {
    // pid ppid user <lstart: 5 fields> args...
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/);
    if (!match) continue;
    rows.push({ pid: Number(match[1]), ppid: Number(match[2]), user: match[3], started_at: match[4], argv: match[5] });
  }
  return rows;
}

interface LsofFacts { executable: string | null; cwd: string | null; open_files: string[]; open_sockets: { fd: string; type: string; name: string }[]; listening_ports: string[]; unknown: string[] }

/** `lsof -Fpftn` for ONE pid. Field-mode output so nothing has to be guessed out of a column layout. */
export function lsofFor(pid: number): LsofFacts {
  const facts: LsofFacts = { executable: null, cwd: null, open_files: [], open_sockets: [], listening_ports: [], unknown: [] };
  const out = run("/usr/sbin/lsof", ["-p", String(pid), "-Fpftn"]);
  if (out.trim() === "") {
    facts.unknown.push(`lsof returned nothing for pid ${pid} — open files, cwd and mapped executable are UNKNOWN (permission or the process exited)`);
    return facts;
  }
  let fd = "";
  let type = "";
  for (const line of out.split("\n")) {
    const tag = line[0];
    const value = line.slice(1);
    if (tag === "f") { fd = value; type = ""; continue; }
    if (tag === "t") { type = value; continue; }
    if (tag !== "n") continue;
    if (fd === "cwd") { facts.cwd = value; continue; }
    if (fd === "txt") {
      // The FIRST mapped text file is the process's own binary; the rest are
      // its linked frameworks. Only the first is claimed as the executable.
      if (facts.executable === null) facts.executable = value;
      continue;
    }
    if (type === "IPv4" || type === "IPv6" || type === "unix") {
      facts.open_sockets.push({ fd, type, name: value });
      if (/^\*:\d+$/.test(value) || value.includes("(LISTEN)")) facts.listening_ports.push(value);
      continue;
    }
    if (type === "REG" || type === "DIR") facts.open_files.push(value);
  }
  if (facts.executable === null) facts.unknown.push(`no ftxt entry for pid ${pid} — mapped executable UNKNOWN`);
  if (facts.cwd === null) facts.unknown.push(`no fcwd entry for pid ${pid} — working directory UNKNOWN`);
  return facts;
}

/** A runtime is claimed only when the mapped binary path itself says so. */
function runtimeOf(executable: string | null): string | null {
  if (!executable) return null;
  if (/\/node$/.test(executable) || /\/node[\d.]*$/.test(executable)) return executable;
  if (/\/python3?[\d.]*$/.test(executable)) return executable;
  if (/Electron Framework/.test(executable)) return executable;
  return null;
}

export function observeProcesses(pids: readonly number[]): readonly ProcessObservation[] {
  const table = new Map(listProcesses().map((row) => [row.pid, row]));
  return pids.map((pid) => {
    const row = table.get(pid);
    const facts = lsofFor(pid);
    const unknown = [...facts.unknown];
    if (!row) unknown.push(`pid ${pid} is not in the process table — it exited or was never running`);
    return {
      pid,
      ppid: row?.ppid ?? -1,
      user: row?.user ?? "UNKNOWN",
      started_at: row?.started_at ?? "UNKNOWN",
      argv: row?.argv ?? "UNKNOWN",
      executable: facts.executable,
      cwd: facts.cwd,
      open_files: facts.open_files,
      open_sockets: facts.open_sockets,
      listening_ports: facts.listening_ports,
      runtime: runtimeOf(facts.executable),
      unknown,
    };
  });
}

/** Processes whose observed cwd sits under a path. The cwd comes from lsof, so this is an OS fact, not a name match. */
export function findProcessesUnderPath(pathPrefix: string, candidatePids: readonly number[]): readonly ProcessObservation[] {
  return observeProcesses(candidatePids).filter((observation) => observation.cwd !== null && (observation.cwd === pathPrefix || observation.cwd.startsWith(`${pathPrefix}/`)));
}

/** Only relationships the observation actually supports. Each names the lsof/ps field it came from. */
export function relationshipsFor(observation: ProcessObservation): readonly ObservedRelationship[] {
  const at = new Date().toISOString();
  const process = `process:${observation.pid}`;
  const edges: ObservedRelationship[] = [];

  if (observation.executable) edges.push({ from: process, kind: "EXECUTES", to: `executable:${observation.executable}`, evidence: [`lsof -p ${observation.pid} -Fpftn (ftxt)`], observed_at: at });
  if (observation.ppid >= 0) edges.push({ from: process, kind: "CHILD_OF", to: `process:${observation.ppid}`, evidence: [`ps -axo ppid= (pid ${observation.pid})`], observed_at: at });
  if (observation.cwd) edges.push({ from: process, kind: "WORKING_DIRECTORY", to: `path:${observation.cwd}`, evidence: [`lsof -p ${observation.pid} -Fpftn (fcwd)`], observed_at: at });
  if (observation.runtime) edges.push({ from: process, kind: "USES_RUNTIME", to: `runtime:${observation.runtime}`, evidence: [`lsof -p ${observation.pid} -Fpftn (ftxt) — the mapped binary itself is the runtime`], observed_at: at });
  for (const file of observation.open_files) edges.push({ from: process, kind: "HOLDS_OPEN", to: `file:${file}`, evidence: [`lsof -p ${observation.pid} -Fpftn (REG/DIR fd)`], observed_at: at });
  for (const socket of observation.open_sockets) edges.push({ from: process, kind: "LISTENS_ON", to: `socket:${socket.name}`, evidence: [`lsof -p ${observation.pid} -Fpftn (fd ${socket.fd}, ${socket.type})`], observed_at: at });

  return edges;
}

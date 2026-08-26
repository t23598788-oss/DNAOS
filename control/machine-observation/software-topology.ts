/**
 * หน้าที่: groups observed processes under the APPLICATION that really owns
 * them — by bundle path, never by process name (Owner, 2026-08-26).
 *
 * The rule this file enforces: a process belongs to `Claude.app` only if the
 * binary `lsof` reported for it lives inside `/…/Claude.app/`. A process named
 * "Claude" whose mapped binary is somewhere else is NOT claimed, and a process
 * named "node" whose mapped binary is inside the bundle IS. Ownership is a
 * path fact.
 *
 * It also refuses the bigger inference: nothing here connects one application
 * to another's files. "Claude wrote this VS Code setting" is not something a
 * bundle path can show, so this file never says it. That claim needs
 * ./correlation.ts, and even there it needs the process to actually hold the
 * file open.
 *
 * Input: candidate pids (or `discoverApplicationProcesses`'s own scan of the
 * process table).
 * Output: `SoftwareTopology` — application, its processes, and the evidenced
 * edges between them.
 * Dependency ที่อนุญาต: ./types.ts, ./process-observer.ts.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามอ้างความเป็นเจ้าของจากชื่อ process.
 * - ห้ามเชื่อมแอปหนึ่งกับไฟล์ของอีกแอปโดยไม่มีหลักฐาน fd จริง.
 */

import type { ObservedRelationship, ProcessObservation, SoftwareTopology } from "./types";
import { listProcesses, observeProcesses, relationshipsFor } from "./process-observer";

/** The `.app` bundle a binary really sits in, or null. Pure path parsing — no name matching. */
export function bundleOf(executable: string | null): string | null {
  if (!executable) return null;
  const match = executable.match(/^(.*?\/[^/]+\.app)\//);
  return match ? match[1] : null;
}

/**
 * Candidate pids for an application, taken from the process table's argv —
 * this is only a CANDIDATE step. Membership is decided afterwards by the
 * mapped binary's bundle path in `topologyFor`, so a name that merely looks
 * right never survives on its own.
 */
export function candidatePidsForBundle(bundlePath: string): readonly number[] {
  return listProcesses().filter((row) => row.argv.includes(bundlePath)).map((row) => row.pid);
}

export function topologyFor(bundlePath: string, pids: readonly number[]): SoftwareTopology {
  const observed = observeProcesses(pids);
  const at = new Date().toISOString();

  // The membership test: the MAPPED BINARY must live inside the bundle.
  const members: ProcessObservation[] = [];
  const rejected: string[] = [];
  for (const observation of observed) {
    const bundle = bundleOf(observation.executable);
    if (bundle === bundlePath) members.push(observation);
    else if (observation.executable === null) rejected.push(`pid ${observation.pid}: mapped executable UNKNOWN — not claimed for ${bundlePath}`);
    else rejected.push(`pid ${observation.pid}: mapped executable is ${observation.executable} (bundle ${bundle ?? "none"}) — not claimed for ${bundlePath}`);
  }

  const relationships: ObservedRelationship[] = [];
  for (const member of members) {
    relationships.push({ from: `application:${bundlePath}`, kind: "BUNDLES", to: `executable:${member.executable}`, evidence: [`lsof -p ${member.pid} -Fpftn (ftxt) is inside ${bundlePath}`], observed_at: at });
    relationships.push({ from: `application:${bundlePath}`, kind: "SPAWNS", to: `process:${member.pid}`, evidence: [`ps -axo pid=,ppid= and the ftxt bundle path`], observed_at: at });
    if (member.cwd) relationships.push({ from: `process:${member.pid}`, kind: "WORKS_IN", to: `workspace:${member.cwd}`, evidence: [`lsof -p ${member.pid} -Fpftn (fcwd)`], observed_at: at });
    relationships.push(...relationshipsFor(member));
  }

  return {
    application: members.length > 0 ? bundlePath : null,
    application_evidence: members.length > 0 ? [`${members.length} process(es) map a binary inside ${bundlePath}`] : [`no observed process maps a binary inside ${bundlePath}`],
    processes: members,
    relationships,
    unknown: rejected,
  };
}

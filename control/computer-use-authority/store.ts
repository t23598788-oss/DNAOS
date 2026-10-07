/**
 * หน้าที่: read/write path จริงของ `ComputerUseAuthorityLease` — append-only JSONL,
 * "record ล่าสุดต่อ authority_id ชนะ" convention เดียวกับ store อื่นของ DNA OS
 *
 * Input: lease writes ผ่าน `upsertLease`.
 * Output: `createAuthorityStore`, `findLease`, `upsertLease`, `listLeases`.
 * Dependency ที่อนุญาต: node:fs, node:path, ./types.ts.
 * สิ่งที่ห้ามแตะ: ห้ามเก็บ secret ดิบ — lease มีแค่ reference.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ComputerUseAuthorityLease } from "./types";

const DEFAULT_DATA_DIR_RELATIVE = "control/computer-use-authority/data";
const FILENAME = "authority-leases.jsonl";

export interface AuthorityStore {
  findLease(authority_id: string): ComputerUseAuthorityLease | null;
  upsertLease(lease: ComputerUseAuthorityLease): ComputerUseAuthorityLease;
  listLeases(): readonly ComputerUseAuthorityLease[];
}

export function createAuthorityStore(baseDir: string = join(process.cwd(), DEFAULT_DATA_DIR_RELATIVE)): AuthorityStore {
  const file = join(baseDir, FILENAME);
  function ensureFile(): void {
    mkdirSync(baseDir, { recursive: true });
    if (!existsSync(file)) writeFileSync(file, "", "utf-8");
  }
  function readLatest(): Map<string, ComputerUseAuthorityLease> {
    ensureFile();
    const latest = new Map<string, ComputerUseAuthorityLease>();
    for (const line of readFileSync(file, "utf-8").split("\n")) {
      if (line.trim().length === 0) continue;
      const rec = JSON.parse(line) as ComputerUseAuthorityLease;
      latest.set(rec.authority_id, rec);
    }
    return latest;
  }
  return {
    findLease(authority_id) {
      return readLatest().get(authority_id) ?? null;
    },
    upsertLease(lease) {
      ensureFile();
      appendFileSync(file, `${JSON.stringify(lease)}\n`, { encoding: "utf8", mode: 0o600 });
      return lease;
    },
    listLeases() {
      return [...readLatest().values()];
    },
  };
}

const defaultStore = createAuthorityStore();
export function findLease(authority_id: string): ComputerUseAuthorityLease | null {
  return defaultStore.findLease(authority_id);
}
export function upsertLease(lease: ComputerUseAuthorityLease): ComputerUseAuthorityLease {
  return defaultStore.upsertLease(lease);
}
export function listLeases(): readonly ComputerUseAuthorityLease[] {
  return defaultStore.listLeases();
}

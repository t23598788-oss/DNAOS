/**
 * หน้าที่: the one real, persistent write/read path for
 * `ConnectionRegistration` — REGISTER_CONNECTION, LOOKUP_CONNECTION,
 * UPDATE_CONNECTION_STATUS. This is the file `contracts/connector/
 * connection.ts`'s own header used to say did not exist
 * ("NOT_YET_BUILT: no real connection has been registered").
 *
 * Connection identity is deterministic — `buildConnectionId()` hashes
 * nothing; it builds a real, inspectable, canonical identity string from
 * exactly `provider`/`owner`/`repository`/`branch`/`connection_type`,
 * same encoding convention `credentials/registry/database-credential-
 * registry.ts`'s `buildDatabaseCredentialRef` already established.
 * Re-registering the identical identity is idempotent — never a
 * duplicate row.
 *
 * Persistence: append-only JSONL, "latest record per connection_id wins"
 * — the exact same convention `credentials/registry/*.ts` and
 * `connections/agent-registry/store.ts` already use. A restart re-reads
 * this file fresh; nothing durable ever lives only in an in-process Map.
 *
 * Input: `RegisterConnectionInput`, `ConnectionLookupQuery`.
 * Output: `registerConnection`, `lookupConnection`, `listConnections`,
 * `updateConnectionStatus`, `buildConnectionId`.
 * Dependency ที่อนุญาต: node:fs, node:path,
 * ../../contracts/connector/connection.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never accept or persist a raw secret value — only
 * `credential_ref` (already reference-only by contract) ever appears in
 * a stored record. Never write directly to this file's data file from
 * outside this module — ./contract.ts's exported functions are the only
 * boundary.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ConnectionRegistration } from "../../contracts/connector/connection";
import type { ConnectionLookupQuery, RegisterConnectionInput } from "./types";

const DEFAULT_DATA_DIR_RELATIVE = "connections/connection-registry/data";
const CONNECTIONS_FILENAME = "connections.jsonl";

/** Deterministic — same real inputs always produce the same connection_id, so re-registering the same real target is idempotent, never a duplicate row. */
export function buildConnectionId(input: { adapter: string; connection_type: string; target: { owner: string; repository: string; branch: string } }): string {
  const parts = [input.adapter, input.connection_type, input.target.owner, input.target.repository, input.target.branch].map(encodeURIComponent);
  return `connection://${parts.join("/")}`;
}

export interface ConnectionRegistryStore {
  registerConnection(input: RegisterConnectionInput): { connection: ConnectionRegistration; inserted: boolean };
  lookupConnection(query: ConnectionLookupQuery): ConnectionRegistration | null;
  listConnections(): readonly ConnectionRegistration[];
  updateConnectionStatus(connection_id: string, status: ConnectionRegistration["status"]): ConnectionRegistration;
  /** Attaches a real, already-registered credential_ref and flips status in one write — used by connections/provider-authorization/ once a Device Flow authorization completes. Never accepts a raw secret, only the reference string. */
  attachCredential(connection_id: string, credential_ref: ConnectionRegistration["credential_ref"], status: ConnectionRegistration["status"]): ConnectionRegistration;
}

export function createConnectionRegistryStore(
  baseDir: string = join(process.cwd(), DEFAULT_DATA_DIR_RELATIVE),
): ConnectionRegistryStore {
  const file = join(baseDir, CONNECTIONS_FILENAME);

  function ensureFile(): void {
    mkdirSync(baseDir, { recursive: true });
    if (!existsSync(file)) writeFileSync(file, "", "utf-8");
  }

  function readAll(): ConnectionRegistration[] {
    ensureFile();
    return readFileSync(file, "utf-8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as ConnectionRegistration);
  }

  function readLatest(): Map<string, ConnectionRegistration> {
    const latest = new Map<string, ConnectionRegistration>();
    for (const record of readAll()) latest.set(record.connection_id, record);
    return latest;
  }

  function appendEntry(entry: ConnectionRegistration): void {
    ensureFile();
    appendFileSync(file, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  return {
    registerConnection(input) {
      const connection_id = buildConnectionId({ adapter: input.adapter, connection_type: input.connection_type, target: input.target });
      const existing = readLatest().get(connection_id);
      if (existing) return { connection: existing, inserted: false };
      const connection: ConnectionRegistration = {
        connection_id,
        account_id: input.account_id,
        software_id: input.software_id,
        adapter: input.adapter,
        credential_ref: input.credential_ref,
        status: input.status,
        connection_type: input.connection_type,
        target: input.target,
        executor_capability_id: input.executor_capability_id,
        scope: [...input.scope],
      };
      appendEntry(connection);
      return { connection, inserted: true };
    },
    lookupConnection(query) {
      const latest = readLatest();
      if (query.connection_id !== undefined) return latest.get(query.connection_id) ?? null;
      const all = [...latest.values()];
      if (query.adapter !== undefined && query.target !== undefined) {
        return all.find((c) => c.adapter === query.adapter && c.target?.owner === query.target!.owner && c.target?.repository === query.target!.repository && c.target?.branch === query.target!.branch) ?? null;
      }
      if (query.adapter !== undefined) return all.find((c) => c.adapter === query.adapter) ?? null;
      return null;
    },
    listConnections() {
      return [...readLatest().values()];
    },
    updateConnectionStatus(connection_id, status) {
      const current = readLatest().get(connection_id);
      if (!current) throw new Error("CONNECTION_NOT_REGISTERED");
      const updated: ConnectionRegistration = { ...current, status };
      appendEntry(updated);
      return updated;
    },
    attachCredential(connection_id, credential_ref, status) {
      const current = readLatest().get(connection_id);
      if (!current) throw new Error("CONNECTION_NOT_REGISTERED");
      const updated: ConnectionRegistration = { ...current, credential_ref, status };
      appendEntry(updated);
      return updated;
    },
  };
}

const defaultStore = createConnectionRegistryStore();

export function registerConnection(input: RegisterConnectionInput): { connection: ConnectionRegistration; inserted: boolean } {
  return defaultStore.registerConnection(input);
}
export function lookupConnection(query: ConnectionLookupQuery): ConnectionRegistration | null {
  return defaultStore.lookupConnection(query);
}
export function listConnections(): readonly ConnectionRegistration[] {
  return defaultStore.listConnections();
}
export function updateConnectionStatus(connection_id: string, status: ConnectionRegistration["status"]): ConnectionRegistration {
  return defaultStore.updateConnectionStatus(connection_id, status);
}
export function attachCredential(connection_id: string, credential_ref: ConnectionRegistration["credential_ref"], status: ConnectionRegistration["status"]): ConnectionRegistration {
  return defaultStore.attachCredential(connection_id, credential_ref, status);
}

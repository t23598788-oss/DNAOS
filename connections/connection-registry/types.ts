/**
 * หน้าที่: the type contracts for the Connection Registry — one owner for
 * `ConnectionRegistration` register/read/update, nothing else.
 *
 * Input: none (pure type definitions).
 * Output: `RegisterConnectionInput`, `ConnectionLookupQuery`,
 * `GitRemoteDiscovery`.
 * Dependency ที่อนุญาต: ../../contracts/connector/connection.ts (types only).
 * สิ่งที่ห้ามแตะ: never add a field that carries a raw secret — only
 * `credential_ref` (a reference string) ever appears here.
 */

import type { ConnectionRegistration, ConnectionType, GithubRepositoryTarget } from "../../contracts/connector/connection";

export interface RegisterConnectionInput {
  adapter: string;
  connection_type: ConnectionType;
  account_id: string;
  software_id: string;
  target: GithubRepositoryTarget;
  credential_ref: ConnectionRegistration["credential_ref"];
  status: ConnectionRegistration["status"];
  executor_capability_id: string | null;
  scope: readonly string[];
}

export interface ConnectionLookupQuery {
  connection_id?: string;
  adapter?: string;
  target?: GithubRepositoryTarget;
}

/** What was actually read from the real local git repository — never invented. */
export interface GitRemoteDiscovery {
  owner: string;
  repository: string;
  branch: string;
  repository_root: string;
  remote_url: string;
}

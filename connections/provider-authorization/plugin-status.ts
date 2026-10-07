/**
 * หน้าที่: the UI-facing read model for one provider's plug-in status —
 * `provider, display_name, logo_key, login_status, plugin_status, account,
 * connection_status, authorization_status`. Pure composition of
 * `connections/connection-registry/` + `./store.ts` — never a new source
 * of truth, never a raw credential.
 *
 * Input: `connection_id`.
 * Output: `buildGithubPluginStatus`, `PluginStatusReadModel`.
 * Dependency ที่อนุญาต: ./types.ts, ./store.ts,
 * ../connection-registry/contract.ts.
 * สิ่งที่ห้ามแตะ: never add a field that could carry a token/secret.
 */

import type { PluginStatusReadModel } from "./types";
import { findAuthorizationRecord as defaultFindAuthorizationRecord } from "./store";
import { lookupConnection as defaultLookupConnection } from "../connection-registry/contract";

export interface PluginStatusDeps {
  lookupConnection: typeof defaultLookupConnection;
  findAuthorizationRecord: typeof defaultFindAuthorizationRecord;
}

const defaultDeps: PluginStatusDeps = { lookupConnection: defaultLookupConnection, findAuthorizationRecord: defaultFindAuthorizationRecord };

export function buildGithubPluginStatus(connection_id: string, deps: PluginStatusDeps = defaultDeps): PluginStatusReadModel {
  const connection = deps.lookupConnection({ connection_id });
  const record = deps.findAuthorizationRecord(connection_id);
  const state = record?.state ?? "NOT_CONNECTED";

  const login_status: PluginStatusReadModel["login_status"] = state === "CONNECTED" ? "LOGGED_IN" : state === "AUTHORIZATION_PENDING" ? "PENDING" : "NOT_LOGGED_IN";
  const plugin_status: PluginStatusReadModel["plugin_status"] =
    state === "CONNECTED" && connection?.status === "connected" ? "READY" :
    state === "AUTHORIZATION_PENDING" ? "PENDING" :
    state === "AUTHORIZATION_FAILED" ? "ERROR" :
    "NOT_READY";

  return {
    provider: "github",
    display_name: "GitHub",
    logo_key: "github",
    login_status,
    plugin_status,
    account: record?.account ?? null,
    connection_status: connection?.status ?? null,
    authorization_status: state,
  };
}

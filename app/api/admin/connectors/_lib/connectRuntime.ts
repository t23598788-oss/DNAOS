/**
 * Connect runtime wiring (app layer).
 *
 * engines/connectors/* may not import gateway (registry/dependency-graph.json
 * allowed_imports.engines = core/services/registry only), so the runtime pieces
 * a Connect contract needs are assembled HERE — in the one layer allowed to
 * import both — and shared by every Connect route instead of each route
 * re-wiring connector reads, the canonical Test call and this app's own origin.
 *
 * Nothing here exposes a secret value: a provider adapter receives status /
 * enabled / config plus secret FIELD NAMES only.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getConnector } from "@/core/connector-loader";
import { supabaseAdmin } from "@/services/supabase/queries";
import { runConnectorTest } from "@/gateway/connectors";
import type {
  ConnectRuntimeDeps,
  ConnectorSummary,
  DetectDeps,
} from "@/engines/connectors/contract";

/** Detection dependencies: file existence + environment variable NAMES only. */
export function buildDetectDeps(): DetectDeps {
  return {
    fileExists: (relPath: string) => existsSync(join(process.cwd(), relPath)),
    envNames: () => Object.keys(process.env),
  };
}

/** This app's own public origin, or null when it is genuinely unset. */
export function appOrigin(): string | null {
  const value = process.env.NEXT_PUBLIC_APP_URL;
  return value ? value.replace(/\/+$/, "") : null;
}

/** The connector summary a contract is allowed to see (no secret values). */
export async function getConnectorSummary(slug: string): Promise<ConnectorSummary | null> {
  const record = await getConnector(supabaseAdmin(), slug);
  if (!record) return null;
  return {
    id: record.id,
    slug: record.slug,
    status: record.status,
    enabled: record.enabled,
    auth_type: record.auth_type,
    config: record.config ?? {},
    secret_keys: Object.keys(record.secret ?? {}),
  };
}

/** Full runtime deps for a Connect contract. */
export function buildConnectRuntimeDeps(): ConnectRuntimeDeps {
  return {
    appOrigin,
    getConnectorSummary,
    // The canonical Test stage — the same function the admin Test route uses, so
    // auto-disable on failure and audit_logs behaviour stay identical.
    runCanonicalTest: async (connectorId: string) => {
      const updated = await runConnectorTest(connectorId);
      return { status: updated.status, last_error: updated.last_error };
    },
  };
}

import { supabaseAdmin } from "@/services/supabase/queries";
import { loadConnectors, requireConnector } from "@/core/connector-loader";
import type { ConnectorRecord } from "@/core/connector-loader";

function isGeminiSystemConnector(connector: ConnectorRecord): boolean {
  const provider = connector.config.provider;
  if (provider === "gemini" || provider === "google-gemini" || provider === "gemini-api") return true;
  return provider === "google" &&
    (connector.slug.startsWith("gemini-") || connector.name.toLowerCase().includes("gemini"));
}

export function findUsableSystemGeminiConnectors(connectors: ConnectorRecord[]): ConnectorRecord[] {
  return connectors.filter((connector) =>
    isGeminiSystemConnector(connector) &&
    connector.status === "connected" &&
    connector.enabled
  );
}

export async function resolveGeminiConnectorKey(): Promise<string | null> {
  const db = supabaseAdmin();
  const matches = findUsableSystemGeminiConnectors(await loadConnectors(db));
  if (matches.length > 1) throw new Error("AI_GATEWAY_CREDENTIAL_AMBIGUOUS");
  if (matches.length === 0) return null;

  const connector = await requireConnector(db, matches[0].slug, "services.ai.gateway");
  const key = connector.secret.api_key;
  return typeof key === "string" && key.length > 0 ? key : null;
}

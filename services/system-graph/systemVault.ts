import { getSystemGraphClient } from "@/services/system-graph/systemGraphClient";

export const SYSTEM_VAULT_SECRET_NAMES = [
  "cloudflare_api_token",
  "line_channel_access_token",
  "kodchat_bot_token",
  "neo4j_connection_uri",
  "neo4j_password",
  "business_supabase_service_role_key",
  "digitalocean_api_token",
] as const;

export type SystemVaultSecretName = (typeof SYSTEM_VAULT_SECRET_NAMES)[number];

export type SystemVaultMetadata = {
  secret_name: SystemVaultSecretName;
  secret_last4: string | null;
  updated_at: string;
};

function getClient() {
  const result = getSystemGraphClient();
  if (!result.ok) throw new Error(result.code);
  return result.client;
}

export async function listSystemVaultMetadata(): Promise<SystemVaultMetadata[]> {
  const { data, error } = await getClient()
    .from("vault_secrets")
    .select("secret_name, secret_last4, updated_at")
    .order("secret_name");
  if (error) throw new Error("SYSTEM_VAULT_METADATA_UNAVAILABLE");
  return (data ?? []) as SystemVaultMetadata[];
}

export async function writeSystemVaultSecret(
  name: SystemVaultSecretName,
  value: string,
  actorId: string,
): Promise<SystemVaultMetadata> {
  const { data, error } = await getClient().rpc("system_vault_secret_write", {
    p_secret_name: name,
    p_secret_value: value,
    p_actor_id: actorId,
  });
  if (error || !Array.isArray(data) || !data[0]) throw new Error("SYSTEM_VAULT_WRITE_FAILED");
  return data[0] as SystemVaultMetadata;
}

/** Server-side only. Never return this value from an HTTP route or log it. */
export async function readSystemVaultSecret(name: SystemVaultSecretName): Promise<string | null> {
  const { data, error } = await getClient().rpc("system_vault_secret_read", { p_secret_name: name });
  if (error) throw new Error("SYSTEM_VAULT_READ_FAILED");
  return typeof data === "string" ? data : null;
}

export async function deleteSystemVaultSecret(name: SystemVaultSecretName): Promise<void> {
  const { error } = await getClient().rpc("system_vault_secret_delete", { p_secret_name: name });
  if (error) throw new Error("SYSTEM_VAULT_DELETE_FAILED");
}

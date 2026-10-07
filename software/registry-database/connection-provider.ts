import type { Pool, PoolConfig } from "pg";
import type { KeychainReference, KeychainResolution } from "../../credentials/macos-keychain/types";
import { MacOsKeychainProvider } from "../../credentials/macos-keychain/provider";

export interface RegistryDatabaseRuntimeContext {
  credential_ref: KeychainReference;
  workspace_scope: string;
  expected_database?: string;
  expected_role?: string;
  expected_schema?: string;
}

export type DatabaseProviderState = "UNRESOLVED" | "CREDENTIAL_RESOLVED" | "CONNECTING" | "CONNECTED" | "VERIFIED" | "READY" | "INVALID_CREDENTIAL" | "WRONG_DATABASE" | "WRONG_ROLE" | "SCHEMA_MISSING" | "CONNECTION_FAILED";

export interface RegistryDatabaseHealth {
  state: DatabaseProviderState;
  database: string | null;
  role: string | null;
  schema_exists: boolean;
  can_read_registry: boolean;
}

export interface RegistryDatabaseConnection {
  kind: "postgres";
  pool: Pool;
  health: RegistryDatabaseHealth;
  close(): Promise<void>;
}

export interface RegistryDatabaseConnectionProvider {
  connect(context: RegistryDatabaseRuntimeContext): Promise<RegistryDatabaseConnection>;
}

export interface DatabaseCredentialResolver {
  resolve(reference: KeychainReference): Promise<KeychainResolution>;
}

function connectionString(secret: string): string {
  return secret;
}

/**
 * The only owner of pg.Pool construction. Secret material is resolved and
 * consumed inside this class; it is never returned in health or errors.
 */
export class PostgresRegistryConnectionProvider implements RegistryDatabaseConnectionProvider {
  constructor(private readonly resolver: DatabaseCredentialResolver = new MacOsKeychainProvider()) {}

  async connect(context: RegistryDatabaseRuntimeContext): Promise<RegistryDatabaseConnection> {
    const resolved = await this.resolver.resolve(context.credential_ref);
    if (!resolved.ok) throw new Error(`DATABASE_PROVIDER:${resolved.code}`);

    const config: PoolConfig = { connectionString: connectionString(resolved.secret), max: 4, application_name: "dna-os-registry" };
    const pool = new (await import("pg")).Pool(config);
    try {
      const client = await pool.connect();
      try {
        const database = (await client.query<{ name: string }>("select current_database() as name")).rows[0]?.name ?? null;
        const role = (await client.query<{ name: string }>("select current_user as name")).rows[0]?.name ?? null;
        const schema = context.expected_schema ?? "software_registry";
        const schemaExists = (await client.query<{ exists: boolean }>("select exists (select 1 from information_schema.schemata where schema_name = $1) as exists", [schema])).rows[0]?.exists === true;
        if (context.expected_database && database !== context.expected_database) throw new Error("DATABASE_PROVIDER:WRONG_DATABASE");
        if (context.expected_role && role !== context.expected_role) throw new Error("DATABASE_PROVIDER:WRONG_ROLE");
        if (!schemaExists) throw new Error("DATABASE_PROVIDER:SCHEMA_MISSING");
        await client.query("select 1 from software_registry.resources limit 1");
        return { kind: "postgres", pool, health: { state: "READY", database, role, schema_exists: true, can_read_registry: true }, close: () => pool.end() };
      } finally { client.release(); }
    } catch (error) {
      await pool.end();
      throw error;
    }
  }
}

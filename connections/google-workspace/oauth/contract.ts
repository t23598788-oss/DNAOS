/**
 * Folder-local OAuth contract re-exports for Google Workspace.
 * Client configuration remains Owner-admitted; source path alone ≠ CONNECTED.
 */

export {
  GOOGLE_AUTHORIZE_SCOPES,
  GOOGLE_CONNECTION_ID,
  GOOGLE_CREDENTIAL_REF,
  GOOGLE_IDENTITY_SCOPES,
  GOOGLE_OAUTH_AUTHORIZE_URL,
  GOOGLE_OAUTH_BEGIN_PATH,
  GOOGLE_OAUTH_CALLBACK_PATH,
  GOOGLE_OAUTH_CALLBACK_URI_TESTING,
  GOOGLE_OAUTH_CLIENT_ID_REF,
  GOOGLE_OAUTH_CLIENT_SECRET_REF,
  GOOGLE_OAUTH_TOKEN_URL,
  GOOGLE_WORKSPACE_READONLY_SCOPES,
  WRITE_ENABLED,
} from "../contract";

export const CLIENT_CONFIGURATION_STATE = "CONFIGURATION_REQUIRED" as const;
export const DEADBOARD_GMAIL_CLIENT_REUSED = false as const;
export const NEW_GENERIC_OAUTH_FRAMEWORK_CREATED = false as const;
export const GOOGLE_PKCE_METHOD = "S256_BASE64URL" as const;
export const OWNER_ADMISSION_ROUTE = "POST /owner/google-workspace/oauth-client" as const;
export const OWNER_APPROVAL_ACTION = "REGISTER_GOOGLE_WORKSPACE_OAUTH_CLIENT" as const;
export const PUBLIC_CONFIG_OWNER = "connections/google-workspace/oauth/client-config-store.ts" as const;
export const NEW_REGISTRIES_CREATED = 0 as const;

export type KeychainCredentialKind = "password" | "api_key" | "oauth_token";

export interface KeychainReference {
  service: string;
  account: string;
  kind: KeychainCredentialKind;
}

export type KeychainFailureCode =
  | "INVALID_REFERENCE"
  | "NOT_MACOS"
  | "NOT_FOUND"
  | "PERMISSION_DENIED"
  | "TIMEOUT"
  | "CANCELLED"
  | "FAILED"
  | "DUPLICATE_WORK_ORDER";

export type KeychainResolution =
  | { ok: true; secret: string; credential_source: string; kind: KeychainCredentialKind }
  | { ok: false; code: KeychainFailureCode; reason: string; credential_source: string };

export interface KeychainAuditEvent {
  recorded_at: string;
  operation: "resolve";
  service: string;
  account: string;
  kind: KeychainCredentialKind;
  outcome: "RESOLVED" | KeychainFailureCode;
  prompt: "OS_NATIVE_ONLY";
}

export interface KeychainCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal?: string;
}

export type KeychainCommandRunner = (
  executable: string,
  args: readonly string[],
  options: { timeout: number; signal?: AbortSignal },
) => Promise<KeychainCommandResult>;

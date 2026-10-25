import type { RuntimeProviderId, RuntimeProviderStatus } from "./runtime-provider";

export type ExternalConnectFailureCode =
  | "EXTERNAL_CONNECT_NOT_INSTALLED"
  | "OWNER_APPROVAL_REQUIRED"
  | "EXTERNAL_CONNECT_UNHEALTHY"
  | "EXTERNAL_CONNECT_MISSING_CAPABILITY"
  | "EXTERNAL_CONNECT_LATENCY_TOO_HIGH"
  | "EXTERNAL_CONNECT_ACTIVATION_FAILED"
  | "EXTERNAL_CONNECT_NOT_READY"
  | "EXTERNAL_CONNECT_RELEASE_MISMATCH";

export interface ExternalConnectStatus {
  provider_id: RuntimeProviderId;
  installed: boolean;
  ready: boolean;
  release_version: string | null;
  runtime: RuntimeProviderStatus;
}

export interface ExternalConnectActivationRequest {
  release_sha: string;
  authority: "dna-os";
}

export interface ExternalConnectActivationResult {
  ok: boolean;
  code?: ExternalConnectFailureCode;
}

export interface ExternalConnectAdapter {
  provider_id: RuntimeProviderId;
  observeConnectStatus(): Promise<ExternalConnectStatus> | ExternalConnectStatus;
  activateRelease(request: ExternalConnectActivationRequest): Promise<ExternalConnectActivationResult> | ExternalConnectActivationResult;
}

export interface ExternalConnectFailoverRequest {
  release_sha: string;
  required_capabilities: string[];
  max_latency_ms: number;
  allow_paid_providers: boolean;
}

export interface ExternalConnectFailoverResult {
  ok: boolean;
  provider_id: RuntimeProviderId | null;
  runtime_url: string | null;
  code: ExternalConnectFailureCode | null;
}

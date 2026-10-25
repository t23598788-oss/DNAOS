import type { ExternalConnectAdapter, ExternalConnectFailoverRequest, ExternalConnectFailoverResult, ExternalConnectStatus } from "./contracts/external-connect";

function reject(code: ExternalConnectFailoverResult["code"]): ExternalConnectFailoverResult {
  return { ok: false, provider_id: null, runtime_url: null, code };
}

function eligible(status: ExternalConnectStatus, request: ExternalConnectFailoverRequest): ExternalConnectFailoverResult["code"] {
  if (!status.installed) return "EXTERNAL_CONNECT_NOT_INSTALLED";
  if (status.runtime.cost.requires_owner_approval || (status.runtime.cost.paid && !request.allow_paid_providers)) return "OWNER_APPROVAL_REQUIRED";
  if (status.runtime.availability !== "available" || status.runtime.health !== "healthy" || !status.runtime.runtime_url) return "EXTERNAL_CONNECT_UNHEALTHY";
  if (status.runtime.latency_ms !== null && status.runtime.latency_ms > request.max_latency_ms) return "EXTERNAL_CONNECT_LATENCY_TOO_HIGH";
  if (request.required_capabilities.some((capability) => !status.runtime.capabilities.includes(capability))) return "EXTERNAL_CONNECT_MISSING_CAPABILITY";
  return null;
}

export async function activateStandbyConnect(
  standby: ExternalConnectAdapter,
  request: ExternalConnectFailoverRequest,
): Promise<ExternalConnectFailoverResult> {
  const observed = await standby.observeConnectStatus();
  const rejection = eligible(observed, request);
  if (rejection) return reject(rejection);

  const activation = await standby.activateRelease({ release_sha: request.release_sha, authority: "dna-os" });
  if (!activation.ok) return reject(activation.code ?? "EXTERNAL_CONNECT_ACTIVATION_FAILED");

  const ready = await standby.observeConnectStatus();
  if (!ready.installed) return reject("EXTERNAL_CONNECT_NOT_INSTALLED");
  if (!ready.ready) return reject("EXTERNAL_CONNECT_NOT_READY");
  if (ready.release_version !== request.release_sha) return reject("EXTERNAL_CONNECT_RELEASE_MISMATCH");
  if (!ready.runtime.runtime_url) return reject("EXTERNAL_CONNECT_UNHEALTHY");

  return {
    ok: true,
    provider_id: ready.provider_id,
    runtime_url: ready.runtime.runtime_url,
    code: null,
  };
}

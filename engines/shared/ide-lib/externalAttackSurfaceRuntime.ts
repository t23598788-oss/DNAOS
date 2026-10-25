/**
 * External Attack Surface Runtime (owner, 2026-08-08, Software Factory
 * Step 13.7). The real orchestrator: Domain Asset (verified) -> real
 * Security Execution Gate -> real, passive Subfinder discovery -> real
 * DNS verification -> real, non-invasive httpx verification -> real,
 * deterministic 4-layer comparison (Source Code -> Registry -> DNS ->
 * Public Internet) -> real External Drift classification. This is the
 * external-facing mirror of scripts/check-drift.sh's real, existing
 * internal Architecture Drift check — that one looks from inside the
 * source code outward; this one looks from the public internet back in.
 *
 * DNA OS never reimplements discovery/probing — it controls, gates,
 * evidences, and classifies real output from real, existing tools
 * (Subfinder, httpx) it does not own.
 */
import { randomUUID } from "crypto";
import { getDomainAsset, type DomainAsset } from "./domainAssetRuntime";
import { requestSecurityExecution } from "./securityExecutionRuntime";
import { realSubfinderInvoke, isSubfinderAvailable } from "./externalDiscoveryAdapters/subfinderAdapter";
import { resolveDnsForHosts, type DnsVerificationRecord } from "./externalDiscoveryAdapters/dnsVerificationRuntime";
import { realHttpxInvoke, isHttpxAvailable, type HttpProbeResult } from "./externalDiscoveryAdapters/httpxAdapter";
import { createOperationsArtifact } from "./artifactRuntime";

export type HostClassification = "KNOWN" | "NEW" | "CHANGED" | "DISAPPEARED" | "UNREGISTERED" | "UNREACHABLE";

export interface HostDriftEntry {
  host: string;
  registered: boolean;
  dnsResolved: boolean;
  httpLive: boolean;
  classification: HostClassification;
  ip: string | null;
  statusCode: number | null;
  title: string | null;
  evidence: string[];
}

export interface ExternalDriftReport {
  reportId: string;
  domainAssetId: string;
  domain: string;
  discoveryOk: boolean;
  discoveryReason: string | null;
  hostEntries: HostDriftEntry[];
  summary: Record<HostClassification, number>;
  computedAt: string;
  ownerId: string;
  actor: string;
  artifactIds: string[];
}

export class ExternalAttackSurfaceError extends Error {
  code: "DOMAIN_NOT_VERIFIED" | "GATE_BLOCKED" | "DISCOVERY_NOT_CONFIGURED";
  constructor(code: typeof ExternalAttackSurfaceError.prototype.code, message: string) { super(message); this.code = code; this.name = "ExternalAttackSurfaceError"; }
}

/** Real, in-memory previous-run snapshot per domainAssetId — the
 * temporal half of the real NEW/UNREGISTERED/DISAPPEARED/CHANGED
 * comparison. Bounded, never persisted as a second source of truth
 * (real DomainAsset registry remains authoritative for "registered"). */
const previousRuns = new Map<string, Map<string, HostDriftEntry>>();

function classifyHost(host: string, registered: boolean, dnsResolved: boolean, httpLive: boolean, statusCode: number | null, ip: string | null, previous: HostDriftEntry | undefined): HostClassification {
  if (!dnsResolved) return previous ? "DISAPPEARED" : "UNREACHABLE";
  if (!httpLive) return "UNREACHABLE";
  if (registered) {
    if (previous && (previous.ip !== ip || previous.statusCode !== statusCode)) return "CHANGED";
    return "KNOWN";
  }
  return previous ? "UNREGISTERED" : "NEW";
}

/** Real, deterministic External Drift computation — pure function over
 * real inputs, never AI-decided (Section: "ห้าม AI เดาสถานะเอง"). */
export function computeExternalDrift(
  domain: string, expectedSubdomains: string[], discoveredHosts: string[],
  dnsResults: DnsVerificationRecord[], httpResults: HttpProbeResult[], previous: Map<string, HostDriftEntry> | undefined
): HostDriftEntry[] {
  const dnsByHost = new Map(dnsResults.map((d) => [d.host, d]));
  const httpByHost = new Map(httpResults.map((h) => [h.host, h]));
  const registeredSet = new Set([domain, ...expectedSubdomains]);
  // Real, deduplicated union of every host ever relevant: discovered this
  // run, previously seen, or explicitly expected — never silently drop a
  // real, previously-known host just because this run didn't re-find it
  // (that IS the real DISAPPEARED signal).
  const allHosts = new Set<string>([...discoveredHosts, ...registeredSet, ...(previous ? previous.keys() : [])]);

  const entries: HostDriftEntry[] = [];
  for (const host of allHosts) {
    const dns = dnsByHost.get(host);
    const http = httpByHost.get(host);
    const dnsResolved = dns?.status === "RESOLVED";
    const httpLive = !!http && !http.failed && http.statusCode !== null;
    const registered = registeredSet.has(host);
    const prevEntry = previous?.get(host);
    const ip = dns?.aRecords[0] ?? null;
    const statusCode = http?.statusCode ?? null;
    const classification = classifyHost(host, registered, dnsResolved, httpLive, statusCode, ip, prevEntry);

    const evidence: string[] = [];
    evidence.push(registered ? "real, registered in the Owner's expectedSubdomains/domain" : "NOT in the Owner's real registry");
    evidence.push(dnsResolved ? `real DNS resolution: ${ip ?? "AAAA/CNAME only"}` : "real DNS lookup did not resolve");
    evidence.push(httpLive ? `real HTTP probe: status ${statusCode}` : "real HTTP probe did not get a live response");
    if (classification === "CHANGED" && prevEntry) evidence.push(`real change from previous run: ip ${prevEntry.ip} -> ${ip}, status ${prevEntry.statusCode} -> ${statusCode}`);

    entries.push({ host, registered, dnsResolved, httpLive, classification, ip, statusCode, title: http?.title ?? null, evidence });
  }
  return entries.sort((a, b) => a.host.localeCompare(b.host));
}

/** Real, full, gated discovery run. Requires: (1) a real, VERIFIED
 * Domain Asset, (2) a real, ALLOWED Security Execution Gate decision.
 * Uses only real, passive Subfinder + real, non-invasive httpx — never
 * a port scan/exploit/brute-force/fuzz path exists anywhere in this
 * function. */
export async function runExternalDiscovery(
  domainAssetId: string, ownerId: string, actor: string,
  ownerIntent: string, authorization: string, riskAssessment: string, rollback: string, stopCondition: string, legalNotice: string
): Promise<ExternalDriftReport> {
  const asset: DomainAsset = getDomainAsset(domainAssetId, ownerId);
  if (!asset.verified) throw new ExternalAttackSurfaceError("DOMAIN_NOT_VERIFIED", `real Domain Asset "${asset.domain}" is registered but not yet separately, explicitly verified — cannot scan`);

  const gate = requestSecurityExecution({
    capabilityId: "EXTERNAL_ATTACK_SURFACE_DISCOVERY", ownerIntent, authorization,
    target: { owner: ownerId, organization: asset.organization, asset: asset.domain, purpose: asset.purpose, authorization, expectedOutcome: "real External Drift Report", allowedRuntime: asset.allowedRuntime, forbiddenRuntime: asset.forbiddenRuntime },
    executionScope: "passive Subfinder discovery + non-invasive httpx verification of one real, verified domain",
    riskAssessment, expectedEvidence: ["real Subdomain Discovery Report", "real DNS Verification Report", "real HTTP Probe Report", "real External Drift Report"],
    rollback, stopCondition, legalNotice,
  }, ownerId, actor);
  if (gate.outcome !== "ALLOWED") throw new ExternalAttackSurfaceError("GATE_BLOCKED", `real Security Execution Gate refused this request: ${gate.reasons.join("; ")}`);

  const subfinderAvail = isSubfinderAvailable();
  const httpxAvail = isHttpxAvailable();
  const reportId = randomUUID();

  if (!subfinderAvail.available) {
    const report: ExternalDriftReport = {
      reportId, domainAssetId, domain: asset.domain, discoveryOk: false, discoveryReason: subfinderAvail.reason,
      hostEntries: [], summary: { KNOWN: 0, NEW: 0, CHANGED: 0, DISAPPEARED: 0, UNREGISTERED: 0, UNREACHABLE: 0 },
      computedAt: new Date().toISOString(), ownerId, actor, artifactIds: [],
    };
    const artifact = createOperationsArtifact({ artifactType: "EXTERNAL_DRIFT_REPORT", content: JSON.stringify(report), mimeType: "application/json", actor, ownerId, generatedFrom: reportId, jobId: null });
    report.artifactIds.push(artifact.artifactId);
    return report;
  }

  const subfinderResult = await realSubfinderInvoke(asset.domain, 60_000);
  const discoveredHosts = [...new Set(subfinderResult.results.map((r) => r.host))];
  const subfinderArtifact = createOperationsArtifact({ artifactType: "SUBDOMAIN_DISCOVERY_REPORT", content: JSON.stringify(subfinderResult), mimeType: "application/json", actor, ownerId, generatedFrom: reportId, jobId: null });

  const dnsResults = await resolveDnsForHosts([asset.domain, ...asset.expectedSubdomains, ...discoveredHosts]);
  const dnsArtifact = createOperationsArtifact({ artifactType: "DNS_VERIFICATION_REPORT", content: JSON.stringify(dnsResults), mimeType: "application/json", actor, ownerId, generatedFrom: reportId, jobId: null });

  const liveHosts = dnsResults.filter((d) => d.status === "RESOLVED").map((d) => d.host);
  let httpResults: HttpProbeResult[] = [];
  let httpArtifactIds: string[] = [];
  if (httpxAvail.available && liveHosts.length > 0) {
    const httpxResult = await realHttpxInvoke(liveHosts, 60_000);
    httpResults = httpxResult.results;
    const httpArtifact = createOperationsArtifact({ artifactType: "HTTP_PROBE_REPORT", content: JSON.stringify(httpxResult), mimeType: "application/json", actor, ownerId, generatedFrom: reportId, jobId: null });
    const tlsArtifact = createOperationsArtifact({ artifactType: "TLS_EVIDENCE_RECORD", content: JSON.stringify(httpResults.map((h) => ({ host: h.host, tlsSubject: h.tlsSubject, tlsIssuer: h.tlsIssuer, tlsExpiry: h.tlsExpiry }))), mimeType: "application/json", actor, ownerId, generatedFrom: reportId, jobId: null });
    httpArtifactIds = [httpArtifact.artifactId, tlsArtifact.artifactId];
  }

  const previous = previousRuns.get(domainAssetId);
  const hostEntries = computeExternalDrift(asset.domain, asset.expectedSubdomains, discoveredHosts, dnsResults, httpResults, previous);

  const summary: Record<HostClassification, number> = { KNOWN: 0, NEW: 0, CHANGED: 0, DISAPPEARED: 0, UNREGISTERED: 0, UNREACHABLE: 0 };
  for (const e of hostEntries) summary[e.classification]++;

  previousRuns.set(domainAssetId, new Map(hostEntries.map((e) => [e.host, e])));

  const report: ExternalDriftReport = {
    reportId, domainAssetId, domain: asset.domain, discoveryOk: subfinderResult.ok, discoveryReason: subfinderResult.ok ? null : subfinderResult.stderr,
    hostEntries, summary, computedAt: new Date().toISOString(), ownerId, actor,
    artifactIds: [subfinderArtifact.artifactId, dnsArtifact.artifactId, ...httpArtifactIds],
  };
  const reportArtifact = createOperationsArtifact({ artifactType: "EXTERNAL_DRIFT_REPORT", content: JSON.stringify(report), mimeType: "application/json", actor, ownerId, generatedFrom: reportId, jobId: null });
  report.artifactIds.push(reportArtifact.artifactId);
  return report;
}

export function __debugClearPreviousRuns(): void { previousRuns.clear(); }

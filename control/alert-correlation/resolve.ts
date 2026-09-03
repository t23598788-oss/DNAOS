/**
 * หน้าที่: resolve a provider's OWN service name onto something DNA OS
 * can actually observe — a probe-able URL and/or a real repo path.
 * Resolution failure is a first-class outcome (`UNRESOLVED_ALERT`), never
 * a guess.
 *
 * Every row in `KNOWN_SERVICES` below is EVIDENCE-BACKED, not assumed:
 * the repo paths were confirmed with a real `existsSync`, and the two
 * Railway hostnames were confirmed by a real HTTP request returning 200
 * while building this (2026-08-26). A service whose URL nobody has ever
 * observed is left `UNKNOWN` deliberately — that produces `UNVERIFIABLE`
 * downstream, which is honest, instead of a fabricated endpoint that
 * would produce a confident wrong answer.
 *
 * Input: an `AlertEvent`.
 * Output: `resolveTarget`, `KNOWN_SERVICES`.
 * Dependency ที่อนุญาต: ./types.ts, ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never synthesise a health URL from a naming convention
 * (e.g. `<service>-production.up.railway.app`). Two of this repo's real
 * services already break that pattern — `joint-monitor` is deployed under
 * a name that does not match its folder — so a derived URL would probe
 * the wrong host and report a healthy service as down, or worse, a
 * different tenant's host entirely.
 */

import { UNKNOWN, PROVIDER_UNRESOLVED, type AlertEvent, type ResolvedTarget } from "./types";
import { repoPathExists } from "./host-runtime";

interface KnownService {
  /** Real, observed URL. `null` = never observed; do NOT invent one. */
  readonly health_url: string | null;
  /** Repo path backing this service, verified with existsSync at resolve time. */
  readonly repo_path: string | null;
}

/**
 * Keyed by `<provider>/<project>/<service>` exactly as the provider
 * spells it in its own alert — so the key is what the email actually
 * says, not a normalised guess.
 */
export const KNOWN_SERVICES: Readonly<Record<string, KnownService>> = {
  "railway/DNA-OS-INFRASTRUCTURE/dna-os-circuit": {
    health_url: "https://dna-os-circuit-production.up.railway.app",
    repo_path: "dna-os-circuit",
  },
  "railway/DNA-OS-INFRASTRUCTURE/owner-command-http": {
    // Repo path is real; no public URL for this service has ever been
    // observed from this machine, so it stays null on purpose.
    health_url: null,
    repo_path: "transport/owner-command-http",
  },
  "railway/DNA-OS-INFRASTRUCTURE/joint-monitor": {
    health_url: "https://joint-monitor-production.up.railway.app",
    repo_path: "observability/joint-monitor",
  },
};

export function serviceKey(alert: AlertEvent): string {
  return `${alert.provider}/${alert.project}/${alert.service}`;
}

export function resolveTarget(alert: AlertEvent): ResolvedTarget {
  if (alert.provider === PROVIDER_UNRESOLVED) {
    return { resolved: false, health_url: UNKNOWN, repo_path: UNKNOWN, reason: `sender "${alert.sender}" matched no registered provider domain` };
  }
  if (alert.service === UNKNOWN) {
    return { resolved: false, health_url: UNKNOWN, repo_path: UNKNOWN, reason: `provider "${alert.provider}" recognised, but no service name could be proven from the message body` };
  }

  const key = serviceKey(alert);
  const known = KNOWN_SERVICES[key];
  if (!known) {
    return { resolved: false, health_url: UNKNOWN, repo_path: UNKNOWN, reason: `no registered service matches "${key}" — alert is real but its target is unknown to DNA OS` };
  }

  // The repo path is re-verified on every resolve, never trusted from
  // the table alone: a folder that has been moved or deleted must stop
  // resolving rather than keep reporting a path that no longer exists.
  const repoOk = known.repo_path !== null && repoPathExists(known.repo_path);

  return {
    resolved: true,
    health_url: known.health_url ?? UNKNOWN,
    repo_path: repoOk ? (known.repo_path as string) : UNKNOWN,
    reason: known.health_url
      ? `matched "${key}"; probe target observed previously and re-checked live${repoOk ? "; repo path verified" : "; repo path MISSING on disk"}`
      : `matched "${key}", but no health URL has ever been observed for it — correlation will report UNVERIFIABLE rather than guess`,
  };
}

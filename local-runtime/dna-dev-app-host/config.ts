/**
 * หน้าที่: the ONE place the DNA DEV launch target is declared. `./build.sh`
 * reads this file to stamp the launcher, so the built artifact can never point
 * somewhere this file does not say.
 *
 * The target was DISCOVERED, not chosen (2026-08-24). Evidence in
 * `CANONICAL_TARGET.evidence` below is what proves dna-os-circuit is the DNA DEV
 * UI rather than joint-monitor or owner-command-http.
 *
 * Input: none.
 * Output: `CANONICAL_TARGET`, `resolveLaunchTarget`.
 * Dependency ที่อนุญาต: ./types.ts.
 * สิ่งที่ห้ามแตะ: never make LOCAL_DEVELOPMENT the default and never fall back to
 * it silently — Owner, 2026-08-24: "Do not silently fall back to localhost if
 * Railway is the canonical runtime." `resolveLaunchTarget` therefore requires an
 * explicit opt-in and still reports which kind it returned.
 */

import type { LaunchTarget } from "./types";

export const CANONICAL_TARGET: LaunchTarget = {
  url: "https://dna-os-circuit-production.up.railway.app",
  runtime_kind: "RAILWAY_DEPLOYMENT",
  railway_service: "dna-os-circuit",
  evidence: [
    ".railway/railway.ts declares dna-os-circuit as `UI_APP — real reachable URL`, and declares owner-command-http as `API_SERVICE, not a UI — no public domain`",
    "dna-os-circuit/ui/circuit-board/index.html: title `DNA OS Circuit`, comment `Phase 20 — the one Owner-facing entry`",
    "dna-os-circuit/runtime/server.ts serves GET / -> ui/circuit-board/index.html plus the /gateway/dna_* Owner control routes",
    "live GET https://dna-os-circuit-production.up.railway.app/ -> HTTP 200, real circuit-board UI",
    "live GET https://dna-os-circuit-production.up.railway.app/circuit.json -> HTTP 200, 26 nodes / 27 edges of real data",
  ],
};

/**
 * The local development runtime, declared so it is NAMED rather than hidden in a
 * shell fallback. Returned only when a caller explicitly asks for it.
 */
export const LOCAL_TARGET: LaunchTarget = {
  url: "http://127.0.0.1:8790",
  runtime_kind: "LOCAL_DEVELOPMENT",
  railway_service: "(none — local dna-os-circuit/runtime/start.ts)",
  evidence: ["dna-os-circuit/runtime/start.ts reads CIRCUIT_PORT ?? 8790 for local runs"],
};

/** Explicit opt-in only. `prefer` must be stated by the caller; there is no implicit fallback. */
export function resolveLaunchTarget(prefer: "RAILWAY_DEPLOYMENT" | "LOCAL_DEVELOPMENT"): LaunchTarget {
  return prefer === "LOCAL_DEVELOPMENT" ? LOCAL_TARGET : CANONICAL_TARGET;
}

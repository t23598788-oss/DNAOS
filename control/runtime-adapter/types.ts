/**
 * หน้าที่: the type contracts for `control/runtime-adapter/` — the ONE
 * seam every externally-derived runtime primitive enters DNA OS through
 * (Phase 4, Owner: "RUNTIME PRIMITIVE BOUNDARY"). Two primitives live
 * behind this seam today: macOS Seatbelt profile generation (technique
 * adapted from `sandbox-runtime`, see ./UPSTREAM_REVIEW.md) and a real
 * PTY/streaming session (pattern adapted from `node-pty`, same file).
 *
 * This folder decides NOTHING about authority. It does not know what an
 * Agent is, what a WorkOrder is, who may run what, or whether a write is
 * permitted. It converts an already-decided `ConfinementSpec` into real
 * kernel-enforced confinement, and nothing else. Every caller must have
 * passed its own policy gate BEFORE it builds a spec here.
 *
 * Input: none (pure type definitions).
 * Output: `ConfinementSpec`, `NetworkPolicy`, `SeatbeltProfile`,
 * `ConfinementSpecError`, `PtySessionRequest`, `PtySessionResult`,
 * `PtyChunk`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never add a field that carries a raw, pre-rendered SBPL
 * fragment from a caller — every rule this capability emits must be
 * derived from a structured field below and escaped by ./seatbelt.ts.
 * A caller handing in profile text would reintroduce exactly the
 * injection class ./tests/adversarial-seatbelt.test.ts exists to prove
 * closed. Never add a `NetworkPolicy` variant that opens general egress
 * without naming the exact ports/hosts it opens.
 */

/**
 * The network boundary, stated explicitly.
 *
 * IMPORTANT, and empirically verified (see
 * ./tests/adversarial-seatbelt.test.ts case A): under a `(deny default)`
 * baseline, network egress is ALREADY denied by the kernel with no
 * network directive present at all. `DENY_ALL` therefore emits no
 * `allow` — it is the honest NAME for what the baseline already does,
 * not a new control. The reason it exists as a declared value is that
 * "denied because someone remembered not to add an allow" and "denied
 * because the caller asked for it" are different facts, and only the
 * second one survives a refactor.
 */
export type NetworkPolicy =
  /** No sockets at all. The default, and what every current DNA OS launch gets. */
  | { readonly mode: "DENY_ALL" }
  /**
   * Loopback-only egress to an explicit set of local ports — the seam a
   * future DNA-OS-owned filtering egress proxy plugs into (that proxy is
   * NOT built this round; see ./README.md). Never a route to the open
   * internet by itself: something must actually be listening on those
   * ports, and whatever listens is what enforces the domain allowlist.
   */
  | { readonly mode: "LOOPBACK_PORTS"; readonly ports: readonly number[] };

/**
 * A fully-decided confinement, ready to be rendered to SBPL. Every path
 * MUST be absolute and real; this capability never resolves, guesses, or
 * defaults a path on the caller's behalf.
 *
 * Field shape follows `sandbox-runtime`'s four-field filesystem model
 * (denyRead / allowRead-within-deny / allowWrite / denyWrite-within-allow)
 * rather than DNA OS's previous two ad-hoc lists, because Seatbelt is
 * last-match-wins and the carve-out cases are otherwise unexpressible.
 */
export interface ConfinementSpec {
  /** Absolute dirs the process may WRITE to. Everything else is unwritable. */
  readonly allowWritePaths: readonly string[];
  /**
   * Absolute paths denied for WRITE even though they sit inside an
   * `allowWritePaths` subtree — e.g. a `.git/config` inside the
   * workspace. Emitted after the write allows so it wins.
   */
  readonly denyWriteWithinAllowed: readonly string[];
  /**
   * Absolute dirs denied for READ. Read is broadly allowed as the
   * baseline (see ./seatbelt.ts's header for the dyld reason this is not
   * default-deny, and note that upstream `sandbox-runtime` makes the
   * same choice), so these are the targeted denies that actually bite.
   */
  readonly denyReadPaths: readonly string[];
  /**
   * Absolute paths re-allowed for READ inside a `denyReadPaths` subtree.
   * Emitted after the denies so it wins.
   */
  readonly allowReadWithinDenied: readonly string[];
  /**
   * The EXACT absolute executables this process may exec — nothing else,
   * ever. A list rather than a single value only because a PTY session
   * legitimately needs two (the helper and its target); it is never a
   * convenience hook for widening exec rights.
   */
  readonly execAllowPaths: readonly string[];
  /**
   * Absolute directory trees whose contents may be exec'd. Strictly
   * broader than `execAllowPaths` and therefore used ONLY where a single
   * literal is provably insufficient: macOS interpreter stubs re-exec
   * through several hops (`/usr/bin/python3` -> CLT symlink ->
   * `Python3.framework/.../Python.app/.../Python`), and enumerating every
   * hop is brittle across OS updates. Each entry is a real, disclosed
   * widening — never add one for convenience.
   */
  readonly execAllowSubpaths?: readonly string[];
  readonly network: NetworkPolicy;
  /**
   * Allocate/attach a pseudo-terminal. Off unless explicitly set, so a
   * plain launch is never widened for a capability it does not use.
   * Only `./pty.ts` sets it.
   */
  readonly allowPseudoTty?: boolean;
}

/** A rendered profile plus the spec it came from, so evidence can record both. */
export interface SeatbeltProfile {
  readonly sbpl: string;
  readonly spec: ConfinementSpec;
}

/**
 * Thrown — never returned as a value — when a spec cannot be rendered
 * safely. Fail-closed by construction: there is no "render it anyway"
 * path, because the only alternative to refusing is emitting a profile
 * whose meaning the caller did not choose.
 */
export class ConfinementSpecError extends Error {
  readonly code: ConfinementSpecErrorCode;
  constructor(code: ConfinementSpecErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ConfinementSpecError";
  }
}

export type ConfinementSpecErrorCode =
  | "PATH_NOT_ABSOLUTE"
  | "PATH_UNSAFE_CHARACTER"
  | "EMPTY_EXEC_ALLOWLIST"
  | "INVALID_PORT";

/** One streamed chunk from a live PTY session. */
export interface PtyChunk {
  readonly stream: "pty";
  readonly data: string;
  readonly atIso: string;
}

export interface PtySessionRequest {
  /** Absolute executable to run inside the PTY. */
  readonly executable: string;
  readonly argv: readonly string[];
  /** Absolute cwd for the session. */
  readonly cwd: string;
  readonly timeoutMs: number;
  /** Confinement for the session. `execAllowPaths` must include BOTH the helper and `executable`. */
  readonly confinement: ConfinementSpec;
  /** Env passed to the child — callers must supply an already-filtered, credential-free map. */
  readonly env: Readonly<Record<string, string>>;
}

export interface PtySessionResult {
  readonly sessionId: string;
  readonly pid: number | null;
  /** Full concatenated PTY output. Streaming callers also get it chunk-by-chunk as it arrives. */
  readonly output: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  /** True when the child observed a real tty on stdout — the thing that distinguishes this from a pipe. */
  readonly wasTty: boolean;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

/**
 * หน้าที่: render a decided `ConfinementSpec` into a real macOS Seatbelt
 * (SBPL) profile. This is Phase 4 step 5 — the adapted primitive.
 *
 * DESIGN ATTRIBUTION (Apache-2.0, technique only — no source text
 * copied): the rule-ordering model and, critically, the "escape every
 * interpolated path" rule come from
 * `anthropic-experimental/sandbox-runtime@bcad3881:src/sandbox/macos-sandbox-utils.ts`.
 * See ./UPSTREAM_REVIEW.md for the license gate and exactly what was and
 * was not taken.
 *
 * WHY THIS FILE EXISTS AT ALL — the confirmed defect it closes:
 * `control/agent-host/host-runtime.ts`'s `buildSandboxProfile` interpolates
 * caller-supplied paths into SBPL with raw `"${path}"` and no escaping. A
 * path containing SBPL syntax injects arbitrary directives into the
 * profile. This is not theoretical: `./tests/adversarial-seatbelt.test.ts`
 * case E reproduces it against the real kernel and shows a child being
 * granted `(allow network*)` that its caller never granted. This file is
 * the fixed renderer; agent-host is NOT yet switched over to it (see
 * ./README.md's WIRING STATUS — that is a separate, explicit step).
 *
 * READ CONFINEMENT, HONESTLY: `(allow file-read*)` remains the baseline
 * and read confinement is targeted-deny, not default-deny. That is the
 * same limitation `control/agent-host/host-runtime.ts` already documents
 * (dyld cannot bootstrap under a default-deny read profile on this host).
 * Phase 3's report suggested the upstream donor would close this gap. It
 * does not: `sandbox-runtime` at the pinned commit makes the SAME choice
 * (`(allow file-read*)` baseline, then denies, then carve-outs). So this
 * pass does not claim to have solved default-deny read, and no test here
 * asserts that it did.
 *
 * Input: `ConfinementSpec`.
 * Output: `buildSeatbeltProfile`, `escapeSbplString`, `MANDATORY_READ_DENY_SUBPATHS`.
 * Dependency ที่อนุญาต: ./types.ts, ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never interpolate a path into SBPL without
 * `escapeSbplString`. Never emit a caller-supplied regex — the regex
 * denies below are a closed, code-owned constant set precisely because
 * regex escaping is a second injection surface this capability refuses
 * to open. Never move the mandatory denies above the caller's own
 * allow rules: Seatbelt is last-match-wins, so ordering IS the control.
 */

import { ConfinementSpecError, type ConfinementSpec, type SeatbeltProfile } from "./types";
import { homeDir, joinPath, realPath } from "./host-runtime";

/**
 * Read denies that hold no matter what the caller asked for. Emitted
 * AFTER `allowReadWithinDenied` so a caller cannot carve a hole back
 * into them. Relative to the real home directory.
 */
export const MANDATORY_READ_DENY_SUBPATHS = [
  "Library/Keychains",
  ".config/gh",
  ".ssh",
  ".aws",
  ".gnupg",
] as const;

/**
 * Write denies applied inside EVERY allowed write root — AND every
 * repository nested arbitrarily deep beneath it. Adapted from
 * sandbox-runtime's mandatory write protections: a process with write
 * access to a repo can otherwise rewrite `.git/config` or drop a
 * `.git/hooks/*` script and get arbitrary execution the next time any
 * git command runs — an authority escalation that bypasses this whole
 * boundary without ever touching a denied path.
 *
 * Phase 4.1 fix (Owner-disclosed gap): the prior per-root literal join
 * (`joinPath(root, ".git/config")`) only covered a `.git` directory
 * sitting directly at the writable root — a candidate build script that
 * runs `git init`/`npm install` and creates a NESTED repo (e.g.
 * `<root>/vendor/some-dep/.git/config`) was never covered, since that
 * path does not exist at profile-build time and a literal join can only
 * name paths that already exist or are explicitly enumerated. A REGEX
 * deny matches the pattern regardless of depth or whether the nested
 * repo exists yet, closing the gap for repos a script creates DURING
 * its own run, not just ones already on disk when the profile is built.
 */
const MANDATORY_GIT_CONFIG_WRITE_DENY_REGEX = '\\.git/config$';
const MANDATORY_GIT_HOOKS_WRITE_DENY_REGEX = '\\.git/hooks';

/**
 * Characters that must never reach an SBPL string. Newline and NUL can
 * terminate or restructure the profile regardless of quoting; the
 * control range is rejected because its behaviour in Seatbelt's parser
 * is unspecified and this boundary does not guess.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE_SBPL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * The fix for the injection vector. Two layers, deliberately redundant:
 *
 * 1. REJECT any path containing a character that could restructure the
 *    profile even when escaped (fail-closed — throws, never renders).
 * 2. ESCAPE `\` and `"` so a path containing a quote becomes a quoted
 *    literal rather than a string terminator plus injected directives.
 *
 * Layer 2 alone matches upstream. Layer 1 is added on top because a
 * rejected launch is a strictly better failure than a launch whose
 * profile depends on Seatbelt's escape handling being bug-free.
 */
export function escapeSbplString(value: string): string {
  if (UNSAFE_SBPL_CHARS.test(value)) {
    throw new ConfinementSpecError(
      "PATH_UNSAFE_CHARACTER",
      `path contains a control character and cannot be safely expressed in SBPL: ${JSON.stringify(value)}`,
    );
  }
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function requireAbsolute(path: string, field: string): string {
  if (!path.startsWith("/")) {
    throw new ConfinementSpecError(
      "PATH_NOT_ABSOLUTE",
      `${field} must be an absolute path, got ${JSON.stringify(path)}`,
    );
  }
  // Resolve symlinks BEFORE emitting: Seatbelt matches the kernel's
  // resolved path, so an unresolved one silently matches nothing. See
  // realPath's own header for the concrete macOS /var -> /private/var case.
  return realPath(path);
}

function subpathRule(operation: string, path: string, field: string): string {
  return `(${operation} (subpath "${escapeSbplString(requireAbsolute(path, field))}"))`;
}

function literalRule(operation: string, path: string, field: string): string {
  return `(${operation} (literal "${escapeSbplString(requireAbsolute(path, field))}"))`;
}

/**
 * Emission order IS the policy — Seatbelt resolves last-match-wins, so
 * every block below is placed relative to the ones it must override.
 */
export function buildSeatbeltProfile(spec: ConfinementSpec): SeatbeltProfile {
  if (spec.execAllowPaths.length === 0) {
    throw new ConfinementSpecError(
      "EMPTY_EXEC_ALLOWLIST",
      "execAllowPaths is empty — a confinement that can exec nothing cannot launch its own target; refusing rather than emitting a profile that always fails",
    );
  }

  const lines: string[] = [
    "(version 1)",
    "(deny default)",
  ];

  // Baseline: the empirically-verified minimum any process needs to
  // start at all under `(deny default)` on this host. Carried over
  // unchanged from control/agent-host/host-runtime.ts, which documents
  // the direct testing behind each one (without these, even /bin/echo
  // SIGABRTs before running).
  lines.push(
    "(allow mach-lookup)",
    "(allow sysctl-read)",
    "(allow signal)",
    "(allow ipc-posix-shm)",
    "(allow file-read-metadata)",
    "(allow process-fork)",
  );

  // --- READ ---------------------------------------------------------
  // Broad allow first (see header for why this is not default-deny),
  // then caller denies, then caller carve-outs, then mandatory denies
  // last so nothing above can re-open them.
  lines.push("(allow file-read*)");
  for (const path of spec.denyReadPaths) {
    lines.push(subpathRule("deny file-read*", path, "denyReadPaths"));
  }
  for (const path of spec.allowReadWithinDenied) {
    lines.push(subpathRule("allow file-read*", path, "allowReadWithinDenied"));
  }
  const home = homeDir();
  for (const relative of MANDATORY_READ_DENY_SUBPATHS) {
    lines.push(subpathRule("deny file-read*", joinPath(home, relative), "MANDATORY_READ_DENY_SUBPATHS"));
  }
  // Any dotenv-shaped file anywhere. Code-owned constant, never caller
  // input — see this file's "ห้ามแตะ" note on regex injection.
  lines.push('(deny file-read* (regex #"\\.env($|\\.)"))');

  // --- WRITE --------------------------------------------------------
  for (const path of spec.allowWritePaths) {
    lines.push(subpathRule("allow file-write*", path, "allowWritePaths"));
  }
  for (const path of spec.denyWriteWithinAllowed) {
    lines.push(subpathRule("deny file-write*", path, "denyWriteWithinAllowed"));
  }
  if (spec.allowWritePaths.length > 0) {
    // Regex, code-owned constants only (never caller input — same
    // "ห้ามแตะ" discipline as the dotenv read-deny above) — matches
    // `.git/config`/`.git/hooks` at ANY depth under ANY writable root,
    // including a nested repo a candidate script creates during its own
    // run, not just one already on disk when this profile is built.
    lines.push(`(deny file-write* (regex #"${MANDATORY_GIT_CONFIG_WRITE_DENY_REGEX}"))`);
    lines.push(`(deny file-write* (regex #"${MANDATORY_GIT_HOOKS_WRITE_DENY_REGEX}"))`);
  }

  // --- PTY ----------------------------------------------------------
  // Emitted only for a PTY session, and derived empirically rather than
  // guessed: `os.forkpty()` returns EPERM under (deny default) without
  // ALL THREE of these. Narrowed by bisection against the real kernel —
  // `(allow pseudo-tty)` is accepted by the parser but has NO effect on
  // forkpty and is deliberately NOT emitted, because shipping a rule
  // that grants nothing misrepresents what the profile actually allows.
  // Placed after the write block so the mandatory denies above cannot
  // clobber the /dev grants.
  if (spec.allowPseudoTty) {
    lines.push("(allow file-ioctl)");
    lines.push('(allow file-write* (literal "/dev/ptmx"))');
    lines.push('(allow file-write* (regex #"^/dev/ttys"))');
  }

  // --- EXEC ---------------------------------------------------------
  for (const path of spec.execAllowPaths) {
    lines.push(literalRule("allow process-exec", path, "execAllowPaths"));
  }
  for (const path of spec.execAllowSubpaths ?? []) {
    lines.push(subpathRule("allow process-exec", path, "execAllowSubpaths"));
  }

  // --- NETWORK ------------------------------------------------------
  if (spec.network.mode === "DENY_ALL") {
    // Intentionally emits no rule: `(deny default)` already denies every
    // socket operation, verified against the real kernel in
    // ./tests/adversarial-seatbelt.test.ts case A. The comment exists so
    // that "no network line" reads as a decision rather than an omission.
    lines.push("; network: DENY_ALL — covered by (deny default), no allow emitted");
  } else {
    for (const port of spec.network.ports) {
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new ConfinementSpecError("INVALID_PORT", `network port out of range: ${String(port)}`);
      }
      lines.push(`(allow network-outbound (remote ip "localhost:${port}"))`);
    }
  }

  return { sbpl: lines.join("\n") + "\n", spec };
}

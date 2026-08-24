/**
 * หน้าที่: a real PTY session with live stdout streaming, run under the
 * same kernel-enforced confinement every other launch in this repo uses
 * (Phase 4 step 7). Closes two gaps Phase 3 recorded as MISSING:
 * "Terminal API / PTY" and "stdout/stderr live streaming" — DNA OS's
 * existing executors are buffered-until-exit and hand the child a pipe,
 * so any tool that checks `isatty` behaves differently under DNA OS than
 * it does for a human.
 *
 * DESIGN ATTRIBUTION (MIT, pattern only — no source used): the
 * forkpty-pair-plus-streaming-read-loop shape is node-pty's
 * (`microsoft/node-pty@56c6ac3b`). node-pty itself is NOT a dependency
 * of this repo and no node-pty code is present. See ../UPSTREAM_REVIEW.md
 * for the license gate and ./pty-helper.py's header for the empirical
 * reason a helper executable was used instead of the native addon.
 *
 * HONEST SCOPE — what this is not:
 * - Output only. There is no write-to-stdin path, so this cannot drive an
 *   interactive REPL. Input would need a second, separately-gated channel.
 * - No resize/ioctl (`TIOCSWINSZ`). The pty is created at the OS default
 *   size and never changes. A caller needing resize needs real node-pty.
 * - stdout and stderr are MERGED, because that is what a terminal does —
 *   both land on the same tty. Callers needing them separated must keep
 *   using `../../execution/run/`.
 *
 * Input: `PtySessionRequest` (+ optional chunk callback).
 * Output: `PtySessionResult`.
 * Dependency ที่อนุญาต: ./types.ts, ./seatbelt.ts, ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never spawn the target executable directly here — it
 * must always be reached through `./pty-helper.py` under sandbox-exec, or
 * the session silently loses both the pty and the confinement. Never
 * default `confinement.execAllowPaths` on the caller's behalf; a session
 * whose allowlist omits its own target must fail, not be repaired.
 */

import { buildSeatbeltProfile } from "./seatbelt";
import {
  PTY_HELPER_PATH,
  PYTHON3_PATH,
  python3ExecLiterals,
  python3ExecSubpaths,
  ensureDir,
  joinPath,
  killPid,
  newSessionId,
  nowIso,
  spawnConfined,
  writeTextFile,
} from "./host-runtime";
import type { PtyChunk, PtySessionRequest, PtySessionResult } from "./types";

const MARKER = "__DNA_OS_PTY_END__";

/** Grace period between the timeout firing and a hard kill of the sandbox-exec wrapper. Matches `../agent-host/host.ts`'s own KILL_GRACE_PERIOD_MS. */
const KILL_GRACE_PERIOD_MS = 5_000;

/** The two executables a PTY session ALWAYS needs, on top of its target. */
export function ptyRequiredExecPaths(): readonly string[] {
  return python3ExecLiterals();
}

/** Subpath exec grants a PTY session needs — see host-runtime's own note on why literals are insufficient. */
export function ptyRequiredExecSubpaths(): readonly string[] {
  return python3ExecSubpaths();
}

interface ParsedMarker {
  wasTty: boolean;
  exitCode: number | null;
  timedOut: boolean;
}

/**
 * Splits helper output into (child output, structured trailer). Absent or
 * malformed trailer is reported honestly as "unknown", never defaulted to
 * a success-shaped value.
 */
function parseHelperOutput(raw: string): { output: string; marker: ParsedMarker | null } {
  const index = raw.lastIndexOf(`\n${MARKER} `);
  if (index < 0) return { output: raw, marker: null };
  const trailer = raw.slice(index + MARKER.length + 2).trim();
  const output = raw.slice(0, index);
  const fields = new Map<string, string>();
  for (const part of trailer.split(/\s+/)) {
    const eq = part.indexOf("=");
    if (eq > 0) fields.set(part.slice(0, eq), part.slice(eq + 1));
  }
  const exitRaw = fields.get("exit");
  return {
    output,
    marker: {
      wasTty: fields.get("tty") === "1",
      exitCode: exitRaw === undefined || exitRaw === "null" ? null : Number(exitRaw),
      timedOut: fields.get("timedout") === "1",
    },
  };
}

/**
 * Runs one PTY session to completion. `onChunk` fires as data actually
 * arrives from the pty master — that is the real streaming property, and
 * `./tests/pty-stream.test.ts` asserts it by proving a chunk is observed
 * strictly before the process exits.
 */
export function runPtySession(
  request: PtySessionRequest,
  onChunk?: (chunk: PtyChunk) => void,
): Promise<PtySessionResult> {
  const sessionId = newSessionId();
  const profileDir = joinPath(request.cwd, ".runtime-adapter-profiles");
  ensureDir(profileDir);
  const profilePath = joinPath(profileDir, `${sessionId}.sb`);

  // pseudo-tty is the one capability a PTY session needs beyond a normal
  // launch, and it is requested explicitly rather than granted globally.
  const profile = buildSeatbeltProfile({
    ...request.confinement,
    allowPseudoTty: true,
    // Additive only — the caller's own subpath grants are preserved.
    execAllowSubpaths: [...(request.confinement.execAllowSubpaths ?? []), ...python3ExecSubpaths()],
  });
  writeTextFile(profilePath, profile.sbpl);

  const startedAt = nowIso();
  const startedMs = Date.now();
  const timeoutSeconds = (request.timeoutMs / 1000).toFixed(3);

  const child = spawnConfined(
    profilePath,
    PYTHON3_PATH,
    [PTY_HELPER_PATH, timeoutSeconds, request.executable, ...request.argv],
    request.cwd,
    { ...request.env },
  );

  return new Promise<PtySessionResult>((resolve) => {
    let raw = "";
    let stderr = "";
    let settled = false;

    child.stdout.on("data", (buffer: Buffer) => {
      const text = buffer.toString("utf-8");
      raw += text;
      // Never surface the structured trailer as if it were child output.
      if (onChunk && !text.includes(MARKER)) {
        onChunk({ stream: "pty", data: text, atIso: nowIso() });
      }
    });
    child.stderr.on("data", (buffer: Buffer) => {
      stderr += buffer.toString("utf-8");
    });

    // Outer guard: the helper enforces its own timeout, so this only
    // fires if the helper itself is wedged. Real kill, not a resolve.
    const guard = setTimeout(() => {
      if (child.pid !== undefined) killPid(child.pid, "SIGKILL");
    }, request.timeoutMs + KILL_GRACE_PERIOD_MS);
    guard.unref?.();

    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      const { output, marker } = parseHelperOutput(raw);
      const completedAt = nowIso();
      resolve({
        sessionId,
        pid: child.pid ?? null,
        // Helper stderr is appended rather than dropped: a failure to
        // even start the helper is otherwise invisible to the caller.
        output: stderr.length > 0 ? `${output}${stderr}` : output,
        exitCode: marker ? marker.exitCode : exitCode,
        timedOut: marker ? marker.timedOut : false,
        wasTty: marker ? marker.wasTty : false,
        startedAt,
        completedAt,
        durationMs: Date.now() - startedMs,
      });
    };

    child.on("exit", (code) => finish(code));
    child.on("error", () => finish(null));
  });
}

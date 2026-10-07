#!/usr/bin/env python3
"""
หน้าที่: the registered PTY helper executable for `control/runtime-adapter/`
(Phase 4 step 7). Allocates a real pseudo-terminal with `os.forkpty()`,
execs exactly one caller-supplied executable inside it, and streams the
master side to stdout until EOF or timeout.

WHY A HELPER EXECUTABLE AND NOT node-pty: node-pty is a native addon and
needs a build toolchain to install; `/usr/bin/script` was tested first
and is unusable here because it calls tcgetattr on its OWN stdin, which
DNA OS's launch path (`stdio: ["ignore", "pipe", "pipe"]`) never makes a
tty. `os.forkpty()` has no such requirement — verified directly with
stdin redirected from /dev/null. See ../UPSTREAM_REVIEW.md.

Contract with ./pty.ts, deliberately narrow:
  argv[1]        = timeout in seconds (float)
  argv[2:]       = the executable and its arguments, already absolute
  stdout         = raw PTY output, then a final marker line
  exit code      = the child's exit status, or 124 on timeout

The marker line is the ONLY structured output; everything before it is
verbatim child output. It carries the facts ./pty.ts cannot otherwise
observe from outside the pty (whether the child saw a tty, its real exit
status, and whether the timeout fired).

สิ่งที่ห้ามแตะ: never add a shell invocation here — this file execs the
literal argv it is given and nothing else. Never make the timeout
optional: an un-timed forkpty read loop can hang forever holding a
sandboxed process open.
"""

import errno
import os
import select
import signal
import sys
import time

MARKER = "__DNA_OS_PTY_END__"


def main() -> int:
    if len(sys.argv) < 3:
        sys.stderr.write("usage: pty-helper.py <timeout_seconds> <executable> [args...]\n")
        return 2

    try:
        timeout_s = float(sys.argv[1])
    except ValueError:
        sys.stderr.write("timeout must be a number\n")
        return 2

    argv = sys.argv[2:]
    executable = argv[0]

    pid, master_fd = os.forkpty()
    if pid == 0:
        # Child: replace this process with the target, inside the pty.
        try:
            os.execv(executable, argv)
        except Exception:
            os._exit(127)

    deadline = time.time() + timeout_s
    timed_out = False

    while True:
        remaining = deadline - time.time()
        if remaining <= 0:
            timed_out = True
            break
        try:
            readable, _, _ = select.select([master_fd], [], [], min(remaining, 0.5))
        except (OSError, select.error):
            break
        if not readable:
            continue
        try:
            data = os.read(master_fd, 65536)
        except OSError as exc:
            # EIO is the normal way a pty master reports "child closed it".
            if exc.errno == errno.EIO:
                break
            raise
        if not data:
            break
        # Write through IMMEDIATELY and flush — this is what makes the
        # session actually stream. Buffering here and writing once at the
        # end would make ./pty.ts's onChunk callback fire only at exit,
        # which is exactly the buffered behaviour this capability exists
        # to replace (caught by tests/pty-stream.test.ts case B).
        sys.stdout.write(data.decode("utf-8", "replace"))
        sys.stdout.flush()

    if timed_out:
        # Kill the whole session, not just the direct child: anything the
        # child forked shares this pty's session and would otherwise
        # outlive the timeout.
        try:
            os.killpg(os.getpgid(pid), signal.SIGKILL)
        except OSError:
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass

    exit_code = None
    try:
        _, status = os.waitpid(pid, 0)
        exit_code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else -os.WTERMSIG(status)
    except OSError:
        pass

    try:
        os.close(master_fd)
    except OSError:
        pass

    # The child ran on the slave side of a real pty by construction, so
    # "was a tty" is a fact about this mechanism, not something guessed.
    sys.stdout.write(
        "\n%s tty=1 exit=%s timedout=%d\n"
        % (MARKER, "null" if exit_code is None else str(exit_code), 1 if timed_out else 0)
    )
    sys.stdout.flush()
    return 124 if timed_out else (exit_code if exit_code is not None else 1)


if __name__ == "__main__":
    sys.exit(main())

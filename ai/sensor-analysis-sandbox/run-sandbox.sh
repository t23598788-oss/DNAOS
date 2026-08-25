#!/bin/zsh
# หน้าที่: the launch boundary for ./sandbox-runner.py (Owner, 2026-08-26).
#
# `env -i` is the isolation: the sandbox process starts with an EMPTY
# environment and receives back only what is named on this line. No
# JOINT_MONITOR_SUPABASE_JWT, no RAILWAY_TOKEN, no GITHUB_TOKEN, no
# DNA_OS_*_SHARED_SECRET can be read from inside, because none of them are
# there to read.
#
# HOME is needed to find the already-downloaded model in ~/.cache/huggingface,
# and HF_HUB_OFFLINE=1 makes the loader refuse to reach the network for it.
# The working directory is the caller-supplied sandbox dir, which holds the
# input file and nothing else — the repo is not reachable by relative path.
#
# Usage: run-sandbox.sh <sandbox_dir> <input_file_name|--print-environment>
set -e
SANDBOX_DIR="$1"
INPUT_ARG="$2"
# zsh's ${0:A} resolves to an absolute path without reading the repo directory.
# The previous `cd "$(dirname "$0")" && pwd` form silently produced an empty
# path when this was run under a profile that denies reading the repo — found
# 2026-08-26 while taking the network-denied measurement below.
SELF_DIR="${0:A:h}"
RUNNER="$SELF_DIR/sandbox-runner.py"
PROFILE="$SELF_DIR/sandbox-profile.sb"

# The first measurement of this boundary (2026-08-26) caught the process still
# sitting in the repo root: cwd was inherited, so `open("README.md")` from
# inside would have read this repository. Fixed by entering the sandbox
# directory before exec, and re-measured — cwd is now the sandbox dir.
cd "$SANDBOX_DIR"

# Apple's /usr/bin/python3 is an xcrun shim: it re-adds SDKROOT, CPATH,
# LIBRARY_PATH, MANPATH and LC_CTYPE after `env -i`, so the child's environment
# is never literally the five variables below. Measured, stated, and checked by
# tests/isolation-proof.test.ts, which asserts the environment carries no
# credential-shaped variable rather than pretending it is empty.
# sandbox-exec applies ./sandbox-profile.sb: (deny network*) plus no read or
# write access to this repository, enforced by the kernel rather than by
# convention. Measured 2026-08-26: the model produces its normal structured
# output with both denials in force.
exec /usr/bin/sandbox-exec -f "$PROFILE" env -i \
  HOME="$HOME" \
  PATH=/usr/bin:/bin \
  HF_HUB_OFFLINE=1 \
  TOKENIZERS_PARALLELISM=false \
  /usr/bin/python3 "$RUNNER" "$INPUT_ARG"

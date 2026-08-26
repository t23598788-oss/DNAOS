#!/bin/zsh
# หน้าที่: the launch boundary for ./semantic-runner.py (Owner, 2026-08-26).
#
# Absolute paths are resolved BEFORE `cd`, because a relative $0 stops meaning
# anything once the working directory changes — and because reading the repo
# directory is denied by the profile below.
#
# `env -i` starts the process with an empty environment; only the four
# variables named here come back. No shared secret, no Supabase JWT, no Railway
# or GitHub token is present to be read. HOME is needed to find the
# already-downloaded model; HF_HUB_OFFLINE=1 stops the loader reaching the
# network for it.
#
# Usage: run-semantic.sh <sandbox_dir> <input_file_name|--print-environment>
set -e
SANDBOX_DIR="$1"
INPUT_ARG="$2"
SELF_DIR="${0:A:h}"
RUNNER="$SELF_DIR/semantic-runner.py"
PROFILE="$SELF_DIR/sandbox-profile.sb"

cd "$SANDBOX_DIR"

exec /usr/bin/sandbox-exec -f "$PROFILE" env -i \
  HOME="$HOME" \
  PATH=/usr/bin:/bin \
  HF_HUB_OFFLINE=1 \
  TOKENIZERS_PARALLELISM=false \
  /usr/bin/python3 "$RUNNER" "$INPUT_ARG"

#!/bin/bash
# Global Background Voice Listener — real fix, 2026-07-30 (see
# report-wake.mjs's own comment for the full root-cause explanation): a
# plain bash script is now the top-level launchd process and the one that
# actually calls `rec` — bash can be granted real macOS microphone
# permission (System Settings -> Privacy & Security -> Microphone -> look
# for "bash" or "sh" in the list), unlike the Homebrew node binary this
# used to run through, which macOS silently and permanently denies with no
# prompt at all (verified via the real tccd system log, not guessed).
CHUNK_PATH="/tmp/dna-os-voice-wake-chunk.wav"
WHISPER_MODEL="/Users/tam/whisper-models/ggml-base.bin"
REPORT_SCRIPT="/Users/tam/dna-os-ollama/report-wake.mjs"
NODE_BIN="/usr/local/bin/node"

echo "[voice-wake-watcher] started — listening continuously for the wake word"

# Reverted 2026-07-31: tried sox's `silence`-triggered VAD recording (waits
# for an utterance boundary instead of a fixed window) as a real local
# alternative to a Python/cloud speech_recognition idea the owner found —
# but live-tested with the owner repeatedly saying the wake word and it
# never triggered even once under the real launchd-run daemon (a short
# isolated manual test earlier looked promising but wasn't a real
# validation — it only ever recorded incidental noise at the moment the
# test process was killed, never an actual live trigger). Reverted to the
# original, already-verified-working fixed 4-second window rather than ship
# something unconfirmed. The "wake word cut at a chunk boundary" limitation
# from capability #33 stands — a real VAD fix needs more investigation
# before trying again, not assumed to work from a single passing test.
while true; do
  /opt/homebrew/bin/rec -c 1 "$CHUNK_PATH" trim 0 4 >/dev/null 2>&1
  TRANSCRIPT=$(/opt/homebrew/bin/whisper-cli -m "$WHISPER_MODEL" -l th -nt --prompt "ธวัชชัย" "$CHUNK_PATH" 2>/dev/null | tr -d '\n')
  rm -f "$CHUNK_PATH"

  if [[ "$TRANSCRIPT" == *"ธวัชชัย"* ]]; then
    echo "[voice-wake-watcher] wake word detected: \"$TRANSCRIPT\""
    "$NODE_BIN" "$REPORT_SCRIPT" "$TRANSCRIPT"
  fi
done

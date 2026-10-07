# connections/voice-command/

Voice Control for DNA OS's existing Screen Reader — never a new screen-reading or speech system.

```
MICROPHONE -> Speech-to-Text -> Voice Command Ingress -> Intent Resolver
  -> DNA OS Command Router (via runUiWorkOrder) -> existing read_screen
  -> existing Screen Reader -> existing Voice Queue / Speech Output
```

## Reused, unmodified

- `connections/os-ui/adapter-contract.ts`'s `runUiWorkOrder` — the one real, admitted, audited entry point for `read_screen`/`speak`.
- `connections/os-ui/screen-reader.ts`, `work-order.ts` — untouched.
- `control/command-router/` — reached indirectly through the same registered `os-ui` capability every other caller already uses.

## Extended (not duplicated)

- `connections/os-ui/voice-queue.mjs` gained `isSpeaking()` and `cancelActiveSpeech()` — the same single shared `say` lock every caller (voice-alert-worker, claude-voice-bridge, and now this capability) already uses, now with a real cancel handle. No second speech engine.

## New (did not exist before)

- `./intent-resolver.ts` — deterministic Thai/English keyword resolution. No AI guessing; ambiguous or unmatched input resolves `UNKNOWN`. Extended 2026-08-21 (Owner instruction — Natural Voice Output Intent) from binary READ|STOP|UNKNOWN into `STOP | TRANSLATE | SUMMARIZE | SELECTIVE_READ | SCREEN_INTERPRETATION | READ | UNKNOWN`, checked in that exact order, STOP always first and unconditional (never re-checked against any other category — a phrase containing both, like `"ไม่ต้องอ่าน"`, resolves STOP, never READ or UNKNOWN).
- `./dispatcher.ts` — the `IDLE -> READING -> SPEAKING -> IDLE` state machine, generation-token cancellation, audit trail. STOP cancellation is gated on the real, shared `isSpeaking()` signal (`../os-ui/voice-queue.mjs`) OR this dispatcher's own state — real bug found and fixed 2026-08-21: gating on this dispatcher's own state alone missed real speech that some other caller (sharing the same `say` lock) started, so STOP could be a silent no-op against audio that was genuinely still playing.

### Natural Voice Output Intent (2026-08-21)

| Intent | Real execution |
|---|---|
| `STOP` | Real, immediate SIGTERM to whatever is really speaking (see above) — absolute priority over every other intent. |
| `READ` | Unchanged: `read_screen` -> `speak`. |
| `SCREEN_INTERPRETATION` | Real `read_screen` -> a deterministic regex filter strips Task-ID/UUID/correlation-ID-shaped text -> `speak`. **Not genuine contextual interpretation** — that needs real language understanding, checked this round and not available locally (see below) — this only removes system-metadata shapes, documented honestly rather than oversold. |
| `SELECTIVE_READ` (line number / last paragraph) | Real: `read_screen` -> extract the requested line/paragraph from the real text (Thai number-words 1–10 and Arabic digits both parse) -> `speak`. If the target doesn't exist in the current screen text, action is `IGNORED` with the real reason — never a guessed line. |
| `SELECTIVE_READ` (mouse/cursor/"ตรงนี้"/"ส่วนที่เลือก") | `NOT_AVAILABLE` — no mouse-position/text-selection API exists anywhere in `../os-ui/screen-reader.ts` (checked before building, not assumed). |
| `TRANSLATE`, `SUMMARIZE` | `NOT_AVAILABLE` — no real local Thai translation/summarization capability confirmed this round (Ollama installed but its server was not running, no model manifest checked). Recognized correctly, never faked, never silently downgraded to plain `READ`. |

`action: "NOT_AVAILABLE"` is a distinct, honest outcome from `"IGNORED"` — the intent WAS correctly recognized; the capability to execute it just doesn't exist yet, matching the same "hole, not a blocker, never faked" discipline as Speaker Separation/Language Layer in `connections/language-listening/`.
- `./microphone.mjs` — real capture via `rec` (sox, already installed on this machine).
- `./speech-to-text.swift` / `./speech-to-text.mjs` — real transcription via Apple's `Speech` framework (`SFSpeechRecognizer`), the official macOS mechanism — never a third-party STT engine or an unconfigured cloud API.
- `./listener.ts` — the real orchestration loop (capture -> transcribe -> dispatch), self-audio-suppressed via `isSpeaking()`.

## State machine

```
IDLE -> START_COMMAND -> READING -> SPEAKING -> COMPLETE -> IDLE
READING|SPEAKING -> STOP_COMMAND -> CANCEL -> IDLE
```

Screen Reader never polls itself — `read_screen` only ever runs from inside `handleTranscript()`, itself only reachable from a real resolved READ intent.

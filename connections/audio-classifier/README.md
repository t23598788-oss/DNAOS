# audio-classifier

Capability folder for the **Audio Classifier** layer (2026-08-21,
Owner-directed): the second stage of the Listening pipeline, a separate
capability folder from `../language-listening/` (Segmenter) on purpose —
never imports it, never writes to its files. Communication is by passing a
real file path in (a `*.segments.jsonl` the Segmenter already produced),
never a hardcoded cross-capability import.

```
Raw -> Segment (../language-listening/) -> Classify (HERE) -> Speaker [⏸ NOT_IMPLEMENTED] -> STT -> Language -> Context -> Evidence
```

Speaker Separation is currently an explicit hole, not a blocker (Owner
decision, 2026-08-21, see `../language-listening/README.md`'s own section
on it) — no real local diarization tool exists yet. Any record this
classifier's output feeds into downstream must carry `speaker_id:
"UNKNOWN"` until that slot is filled — never a guessed speaker label.

## What this does

Given a Segmenter evidence file + the WAV it came from, classifies every
non-`SILENCE` segment as `SPEECH` / `MUSIC` / `NOISE` / `MIXED` /
`UNKNOWN`, using Apple's own **`SoundAnalysis.framework`**
(`SNClassifySoundRequest`, `.version1`) — a real system framework already
present on this Mac (confirmed via `find .../SoundAnalysis.framework`),
never a downloaded model. `./classify-tool/` is a small Swift CLI
(`build.sh` compiles it, same plain-`swiftc` convention as
`../voice-command/app-host/`) that runs the classifier over a whole WAV
and prints one JSON line per ~1.5s-step/3s-window classifier window;
`./audio-classifier.mjs` aggregates the windows overlapping each Segmenter
segment and applies a decision rule.

Every output row carries `session_wav`, `segment_id`, `start_ms`,
`end_ms` — traceable back to the exact WAV + sample range every time.
Segmenter's own `*.segments.jsonl` is read-only input here — this module
writes a separate `*.classified.jsonl`, never overwriting it.

## Real evidence from this round (not simulated)

Ran against a real 189s recording already captured by
`../voice-command/listen-observe.mjs`. Apple's classifier correctly
detected a real speech onset at ~28.5s (`speech` confidence jumping from
near-zero to `0.60`, then `0.86` one window later) — independently
confirming that the Segmenter's own VAD-detected "speech" region starting
at `30880ms` genuinely was voiced human speech, even though the STT layer
(`whisper-cli`) had hallucinated a meaningless repeated-syllable
transcript for that exact same span (`"เธอมันว่า ว่าล่าล่าล่า..."`) — this
is a real, useful cross-check: two independently-built tools agreeing on
"there is speech here" while STT accuracy for THAT span was separately,
verifiably bad.

## Honest limits — read before trusting this layer's output

- **Not a hand-built noise taxonomy.** The decision rule only looks at two
  of Apple's own ~300 labels — `speech` and `music` confidence — and
  buckets everything else as `NOISE` (if some other label scored >= 0.3)
  or `UNKNOWN` (if nothing did). It does NOT distinguish "wind" from
  "engine" from "crowd noise" — all of those currently collapse into the
  single `NOISE` bucket. Do not read `NOISE` as a specific noise type.
- **Thresholds (`0.5` high / `0.3` low) are a first pass, not tuned.**
  Picked to be simple and legible, not validated against a labeled
  dataset — expect them to need adjustment once there is real
  ground-truth to check against.
- **A segment's classification says nothing about its transcript
  accuracy.** `SPEECH` here means "this time range sounds like human
  speech to Apple's classifier," not "the Segmenter/STT text for it is
  correct" — see `../language-listening/README.md`'s own caveat about
  `avg_token_confidence` for why those are separate questions.

## Dependency ที่อนุญาต

`node:child_process` (spawn `./classify-tool/classify-tool` only),
`node:fs`, `node:path`, `./classify-tool/main.swift`'s compiled binary
(`AVFoundation`, `SoundAnalysis` — both system frameworks). Never imports
`../language-listening/*` or `../voice-command/*`.

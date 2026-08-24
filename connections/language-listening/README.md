# language-listening

Capability folder for the **Listening** pipeline (2026-08-21, Owner-directed
architecture): hearing, sound separation, and language understanding are a
different concern from Voice Command's command-dispatch path
(`connections/voice-command/`) and must never share implementation or state
with it — the two are separate capability folders, communicating (if ever
needed) only through `../../contracts/`, never by importing each other's
internal files.

Full intended layer stack (Owner's design, 2026-08-21):

```
MIC -> RAW AUDIO
    -> Segmenter (speech vs silence, real time boundaries)      [BUILT — 2026-08-21, this folder]
    -> Audio Classifier (speech / music / noise / silence)      [BUILT — 2026-08-21, ../audio-classifier/]
    -> Speaker Separation (same speaker vs different speaker)   [⏸ NOT_IMPLEMENTED — dependency unavailable, see below]
    -> STT per segment                                          [BUILT — 2026-08-21, ../stt-per-segment/]
    -> Language Layer (Thai central / Isaan / English / other)  [⏸ NOT_IMPLEMENTED — see below; every record carries language: "UNKNOWN", dialect: "UNKNOWN"]
    -> Context Boundary (same topic vs topic change)             [BUILT — 2026-08-21, ../context-boundary/]
    -> Transcript/Evidence Store                                 [partial — each layer writes its own per-run JSONL evidence; no unified store yet]
```

### Language Layer — ⏸ NOT_IMPLEMENTED (Owner decision, 2026-08-21)

Investigated real local options first (same discipline as Speaker
Separation): no langdetect/fasttext/langid/cld3/pycld2 installed, no
fastText `lid.*` model file anywhere on disk, no Thai/Isaan dictionary or
corpus file found. `whisper-cli --detect-language`/`-l auto` exists but
cannot structurally distinguish Isaan from Thai (Whisper's language
taxonomy has no "Isaan" class at all) — and a real test run of it against
already-captured audio from this project mis-detected the language as
English (`en`, confidence `0.371`) even for genuinely Thai/Isaan speech,
so it isn't reliable even for the coarser task it does support. Ollama is
installed but its server wasn't running, and using an LLM here would need
real validation before being trusted, not just being present.

Owner decision: **do not build a keyword/heuristic Isaan detector.** Every
record downstream of STT carries the literal fields `language: "UNKNOWN"`,
`dialect: "UNKNOWN"` until a real model or a large-enough labeled dataset
justifies filling this slot — same "hole, not a blocker" pattern as
Speaker Separation. Context Boundary (next layer) was deliberately
designed to need only `session + segment_id + timestamp + gap`, never
language/dialect, so this hole does not block it.

### Speaker Separation — ⏸ NOT_IMPLEMENTED (Owner decision, 2026-08-21)

Investigated real local options before building anything (per Owner
instruction to check before rushing to build): no genuine speaker
diarization/embedding capability exists on this machine —
`whisper-cli --tinydiarize` needs a `tdrz`-tagged model (not present, only
`ggml-base.bin`/`ggml-silero-v5.1.2.bin` exist), `whisper-cli --diarize`
only separates stereo channels (our recordings are mono, and it does not
identify speakers even on stereo), and no pyannote.audio/speechbrain/
resemblyzer or any cached speaker-embedding model file was found anywhere
on disk.

Owner decision: **do not build a heuristic pseudo-diarizer, do not
download a new model.** This layer is explicitly a hole in the pipeline,
not a blocker — every downstream layer must set `speaker_id: "UNKNOWN"`
for every record until this slot is filled, never a guessed
`SPEAKER_01`/`SPEAKER_02`. Because the raw WAV + real timestamps are
already preserved (`../voice-command/listen-observe.mjs`'s `-sa` output),
re-processing everything once a real diarization model is actually
installed is a pure addition later — no earlier layer's output needs to
change.

Each layer changes independently — swapping the STT model, adding a real
speaker-separation model, or adding an Isaan-specific model later touches
only that one file/layer, never this whole folder.

## What exists today

- `segmenter.mjs` — offline, real Voice-Activity-Detection pass over an
  already-recorded WAV file. Reuses existing, already-installed tools only:
  `/opt/homebrew/bin/whisper-cli` (file-based, not the streaming
  `whisper-stream` binary `connections/voice-command/` uses) +
  `/Users/tam/whisper-models/ggml-base.bin` (STT) +
  `/Users/tam/whisper-models/ggml-silero-v5.1.2.bin` (the real Silero VAD
  model already present on this machine — discovered during the 2026-08-21
  local-model inventory, never usable from `whisper-stream`, only from
  `whisper-cli`). No new model downloaded, no model/VAD parameters invented.
- `segment-cli.mjs` — thin CLI wrapper: `node segment-cli.mjs <wav-path> [out-dir]`.

## What this is NOT (yet)

- Not a music/noise classifier — `segmenter.mjs`'s `kind` field only ever
  distinguishes `SILENCE` (VAD found no speech) from `SPEECH_CANDIDATE` (VAD
  found a voiced region), plus passthrough of whisper's own
  self-reported `[เสียงดนตรี]`/`[Music]` tag as a weak, not-verified
  secondary signal — a real Audio Classifier layer (trained to actually
  distinguish music/noise/speech) is future work, not this file.
- Not a speaker-separation system — cannot tell two different people apart.
- VAD correctly finding "there is a voice-shaped signal in this time range"
  is a DIFFERENT claim from "the transcript for that range is accurate" —
  real evidence from this round: a VAD-detected 31-second "speech" segment
  transcribed as `"เธอมันว่า ว่าล่าล่าล่าล่า..."` (a decoder repetition
  hallucination) — the boundary was real, the transcript content was not.
  Callers must not treat a `SPEECH_CANDIDATE` segment's `text` as
  automatically trustworthy.
- `avg_token_confidence` does NOT reliably flag this kind of hallucination
  — real measured evidence: that same 31s repetition-loop segment scored
  `0.913`, and a 35s `"โอเค โอเค โอเค..."` loop scored `0.928`, both HIGHER
  than several genuinely coherent segments recorded in the same run
  (`0.42`–`0.64`). Each repeated token is individually a plausible
  continuation given the preceding repeated context, so per-token
  probability stays high even while the segment as a whole is garbage.
  Do not build a hallucination filter on this field alone.

## Real bug found and fixed (2026-08-21, against real 57-minute Observation Mode audio)

`segmenter.mjs` spawned `whisper-cli` without draining its `stdout` pipe.
On short test files this never mattered; against a real ~57-minute
Observation Mode recording, the child produced enough stdout output
during audio decode/VAD that the OS pipe buffer filled, blocking the
child's `write()` and hanging the whole process — confirmed via a real
run killed after 3m09s of real elapsed time but only 61s of actual CPU
time (the gap was time spent blocked, not computing). Fixed by spawning
with `stdio: ["ignore", "ignore", "pipe"]` so stdout is discarded at the
OS level. Re-verified against the original 189s test WAV afterward with
identical output (13 segments, 3 silence/67380ms, 8 speech_candidate, 2
tagged-nonspeech) — the fix changed nothing for a file short enough to
never have hit the bug.

## Dependency ที่อนุญาต

`node:child_process`, `node:fs`, `node:path`, `/opt/homebrew/bin/whisper-cli`
(subprocess only). Never imports anything from `../voice-command/`.

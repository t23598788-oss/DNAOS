# stt-per-segment

Capability folder for the **STT per segment** layer (2026-08-21,
Owner-directed): a separate capability folder from `../audio-classifier/`
and `../language-listening/` on purpose — never imports either, only reads
the evidence file paths it's given.

```
Raw -> Segment -> Classify -> Speaker [⏸ NOT_IMPLEMENTED, speaker_id="UNKNOWN"] -> STT (HERE) -> Language -> Context -> Evidence
```

## What this does

Given `../audio-classifier/audio-classifier.mjs`'s `*.classified.jsonl`
(read-only) + the WAV it came from, transcribes every segment whose
`classification` is `SPEECH` or `MIXED` using real, existing
`/opt/homebrew/bin/whisper-cli` + `/Users/tam/whisper-models/ggml-base.bin`
— no new model, same binary/model `../language-listening/segmenter.mjs`
already uses. Uses whisper-cli's own `--offset-t`/`--duration` flags
(confirmed via `--help` and a real test run this round) to seek to and
transcribe EXACTLY the segment's `[start_ms, end_ms)` window — no audio
slicing/sox step needed.

`MUSIC`/`NOISE`/`UNKNOWN` segments are NOT transcribed (skipped, but still
recorded with `status: "SKIPPED_NOT_SPEECH"` so the evidence file has one
row per input segment — nothing silently disappears from the trail).

## Language discipline (strict — Owner instruction)

The `raw_transcript` field is whisper-cli's raw output, verbatim:
- **No translation.**
- **No Isaan-to-standard-Thai normalization or spelling correction.**
- **No LLM rewrite.**

Interpreting what language/dialect a transcript is in, and what it means,
belongs to the next layer (Language/Dialect), not this one.

## speaker_id

Always the literal string `"UNKNOWN"` on every record — Speaker Separation
is `⏸ NOT_IMPLEMENTED` (see `../language-listening/README.md`). Never a
guessed `SPEAKER_01`/etc.

## Known, honest limitation

Transcribing a segment in isolation (its own `--offset-t`/`--duration`
window) can produce a slightly different transcript than a continuous
whole-file pass would for the same span, because whisper loses
cross-segment decoding context at the window boundary — real example from
this round: the same real span, transcribed once as part of a continuous
`../language-listening/segmenter.mjs` run
(`"นี่ทานของ listening observation เรื่องทุกของส้างแล้ว"`) and once via this
layer's isolated-window pass
(`"ตอนนี้ทางของลิสเนิกอบสิ่ง เริ่มทุกของส้างแล้ว"`) — recognizably the same
underlying speech, different exact wording. This is an expected trade-off
of per-segment isolation, not a bug — flagged here rather than hidden.

## Real bug found and fixed (2026-08-21)

Same undrained-`stdout` hang as `../language-listening/segmenter.mjs`
(see that file's README for the real evidence) — fixed here the same way,
`stdio: ["ignore", "ignore", "pipe"]`, before this layer was ever run
against a long real recording.

## Dependency ที่อนุญาต

`node:child_process` (spawn `whisper-cli` only), `node:fs`, `node:path`.
ห้าม import `../audio-classifier/*` หรือ `../language-listening/*`.

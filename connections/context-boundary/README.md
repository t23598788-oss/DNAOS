# context-boundary

Capability folder for the **Context Boundary** layer (2026-08-21,
Owner-directed): a separate capability folder from `../stt-per-segment/`
and every earlier layer — never imports any of them, only reads the
evidence file path it's given.

```
Raw -> Segment -> Classify -> Speaker [⏸ NOT_IMPLEMENTED] -> STT -> Language [⏸ NOT_IMPLEMENTED, UNKNOWN] -> Context Boundary (HERE) -> Evidence
```

## What this does

Groups consecutive `TRANSCRIBED` segments from
`../stt-per-segment/stt-segment.mjs`'s `*.transcribed.jsonl` (read-only)
into `context_id` runs — segments likely to belong to the same
event/conversation. Deliberately uses ONLY `session (wav path) +
segment_id + timestamp (start_ms/end_ms) + gap` to decide this — never
transcript content, never language/dialect (Owner instruction: this layer
does not need to know Thai vs Isaan to do its job, and must not start
interpreting meaning — that belongs to a later layer). `raw_transcript` is
carried through byte-for-byte, never edited/translated/summarized.

Rule: two consecutive `TRANSCRIBED` segments share a `context_id` if the
real time gap between them is `<= MAX_CONTINUATION_GAP_MS` (currently
`5000`); a bigger gap starts a new `context_id`. Non-`TRANSCRIBED` rows
(`SKIPPED_NOT_SPEECH`, `TRANSCRIBE_FAILED`) get `context_id: null` but are
still written out — nothing disappears from the evidence trail — and the
real time they occupy still counts toward the next segment's gap
(the gap is real elapsed wall-clock time, regardless of what filled it).

Every row also carries `language: "UNKNOWN"`, `dialect: "UNKNOWN"`
(Owner instruction, 2026-08-21 — Language Layer is `⏸ NOT_IMPLEMENTED`,
see `../language-listening/README.md`) — this layer does not compute
these, only stamps the literal placeholder so downstream consumers always
see the field present.

## Honest limits

- `MAX_CONTINUATION_GAP_MS = 5000` is a first-pass default, **not**
  validated against any labeled ground-truth — a real conversation with a
  6-second pause would incorrectly split into two `context_id`s under
  this rule today. Expect to need tuning once there's real data to check
  it against.
- This is pure time-gap grouping, not topic/semantic segmentation — two
  segments 2 seconds apart on completely different subjects still get the
  same `context_id`. That is by design for this layer (Owner instruction)
  — real topic-change detection is future work for a later layer, not a
  gap this one is trying to hide.

## Dependency ที่อนุญาต

`node:fs`, `node:path`. ห้าม import `../stt-per-segment/*`,
`../audio-classifier/*`, `../language-listening/*`.

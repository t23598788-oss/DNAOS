# evidence-store

Capability folder for the **Evidence** layer (2026-08-21, Owner-directed)
— the last stage of the base Listening pipeline. A separate capability
folder from every earlier layer — never imports any of them, only reads
the evidence file path it's given.

```
Raw -> Segment -> Classify -> Speaker -> STT -> Language -> Context -> Evidence (HERE)
```

With this layer in place, the base Listening pipeline the Owner specified
on 2026-08-21 is complete end to end (Speaker and Language still sit as
`⏸ NOT_IMPLEMENTED` slots — see `../language-listening/README.md` — but
they don't block anything downstream, by design).

## What this does — and deliberately does NOT do

**Does not analyze anything new.** Consolidates every earlier layer's
already-decided fields into one canonical record per line, renamed/
reordered into the exact chain the Owner specified:

```
context_id -> segment_id -> classification -> speaker_id ->
raw_transcript -> language -> dialect -> start_ms/end_ms -> source_wav
```

plus two purely mechanical additions (not new decisions):

- `sample_offset_start`/`sample_offset_end` — the real PCM sample index
  for `start_ms`/`end_ms` at 16000 Hz (every WAV this pipeline has
  produced/consumed is mono/16-bit/16000 Hz — see
  `../voice-command/listen-observe.mjs`).
- `verify_command` — a real, ready-to-run `sox "<wav>" -d trim <start_s>
  <dur_s>` command that plays exactly that record's original audio slice.
  This is what makes "trace this line of text back to the exact sound
  that produced it" something a human can actually do, not just a
  theoretical property. Swap `-d` for an output file path to save the
  slice instead of playing it live.

Every field any earlier layer produced (`avg_token_confidence`,
`gap_from_prev_transcribed_ms`, `error`, ...) rides along unchanged in
the output row — this layer only ever adds or renames, never drops, never
recomputes, never edits an upstream layer's result.

## Real end-to-end proof (this round)

Ran the full chain on the same 189s real recording every earlier layer
was tested against: Segment (13 rows, 3 silence) -> Classify (10
non-silence rows) -> STT (10/10 transcribed, `speaker_id: "UNKNOWN"`) ->
Context (2 `context_id` runs) -> **Evidence (10 final rows)** — every row
traces back to `source_wav` + an exact `sample_offset_start/end` + a
working `verify_command`.

## What comes after this (Owner's next stated goal)

Once this layer is trusted, the Owner's plan is to build a real Thai/Isaan
**ground-truth dataset** FROM this evidence — because every transcript
line here already resolves back to its exact original audio via
`verify_command`, labeling from this point on is verification against
real sound, not a guess. That work is separate from — and does not
require changes to — this layer.

## Dependency ที่อนุญาต

`node:fs`, `node:path`. ห้าม import `../context-boundary/*`,
`../stt-per-segment/*`, `../audio-classifier/*`, `../language-listening/*`.

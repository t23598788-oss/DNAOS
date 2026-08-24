# human-verified-text

Capability folder for the **Human Verified Text** layer (2026-08-21,
Owner-directed) — the start of a NEW, separate pipeline built on top of
the completed Listening pipeline (`../language-listening/`,
`../audio-classifier/`, `../stt-per-segment/`, `../context-boundary/`,
`../evidence-store/`, all registered `REGISTERED` in the Persistent
Software Registry):

```
Evidence (../evidence-store/) -> Human Verified Text (HERE) -> THAI/ISAN/MIXED label (HERE) -> Ground Truth Dataset (NOT BUILT YET)
```

Never imports `../evidence-store/` or any earlier Listening-pipeline
capability — only reads the evidence file path it's given, same
discipline as every layer before it.

## What this is

A real, interactive terminal tool — `verify-tool.mjs` — nothing here is
decided by code. For every `TRANSCRIBED` row in an
`../evidence-store/`-produced `*.evidence.jsonl`, it:

1. Shows the raw transcript and the exact `verify_command` (a real `sox`
   command, already proven this round to extract the correct audio slice
   to the millisecond) so a human can listen to the real original sound.
2. Asks the human to type a corrected transcript (or press Enter to
   accept the raw one as-is, or `skip` to leave it for a later session).
3. Asks the human to label the segment `THAI` / `ISAN` / `MIXED` /
   `OTHER` / `UNKNOWN` — `OTHER` and `UNKNOWN` are real, legitimate
   answers (e.g. genuinely another language, or a reviewer who truly
   can't tell) — a labeling tool that forces a THAI/ISAN/MIXED choice even
   when the honest answer is "I don't know" would corrupt the ground
   truth it's trying to build.

Run: `node verify-tool.mjs <evidence.jsonl> [out-dir] [labeled-by]`.
Resumable — re-running against the same evidence file skips any
`(source_wav, segment_id)` pair already written to the output file, so a
labeling session can span multiple sittings.

Output: `<session>.verified.jsonl` — every original evidence field
(`context_id`, `segment_id`, `raw_transcript`, `start_ms`/`end_ms`,
`source_wav`, `sample_offset_start/end`, `verify_command`, ...) plus
`verified_text`, `language_label`, `labeled_by`, `labeled_at`.
`raw_transcript` is never overwritten — `verified_text` is a new,
separate field, so the pipeline never loses what the machine originally
heard versus what a human confirmed it actually was.

## Honest note on this round's testing

**This tool was syntax-checked and its file I/O logic was exercised with
scripted/fake terminal input to confirm the code works mechanically** —
that test run is explicitly NOT a real verified dataset and must never be
treated as one. Labeling requires the Owner's real judgment listening to
real audio; nothing here can substitute for that. No fake session output
was kept as if it were real data.

## What comes after this

**Ground Truth Dataset** — aggregating `*.verified.jsonl` files across
sessions into one dataset, still `NOT BUILT`. Deliberately not started
yet, matching the "one pipe at a time" discipline the Owner has used for
every layer so far — build it once there is real verified data to
aggregate, not before.

## Dependency ที่อนุญาต

`node:fs`, `node:path`, `node:readline`. ห้าม import
`../evidence-store/*` หรือ layer อื่นใดใน Listening pipeline.

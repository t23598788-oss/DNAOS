"""
หน้าที่: the ONLY file in this repo that loads or talks to a model
(Owner, 2026-08-26 — first AI sandbox). It reads one input JSON file, runs
mlx-community/Qwen3-4B-Instruct-2507-4bit locally, and prints the model's raw
text to stdout. Nothing else.

WHAT THIS FILE DELIBERATELY DOES NOT IMPORT: no http/urllib/requests/socket, no
subprocess/os.system, no supabase client, no git. The model is given text and
its answer is read back as text; there is no tool loop, no function calling and
no callback it could reach. `mlx_lm` is loaded with HF_HUB_OFFLINE=1 so even the
model loader cannot reach the network.

HOW IT IS LAUNCHED (see ./run-sandbox.sh): with a scrubbed environment — no
Supabase JWT, no Railway token, no GitHub token, no repo path — and with its
working directory set to a directory that contains the input file and nothing
else. `--print-environment` exists so the sandbox can be made to testify about
its own environment, which is how PROOF 1 is taken.

Input: argv[1] = path to the input JSON (the fixed input contract).
Output: stdout = the model's raw text. Validation is NOT done here on purpose:
the untrusted side must not be the one deciding whether its own answer is
acceptable. ../output-contract.ts does that, outside this process.
"""

import json
import os
import sys

SYSTEM_PROMPT = """You analyse DNA OS sensor telemetry. You are given one JSON document and you may use NOTHING else.

Return ONE JSON object, no prose, no markdown fence, matching exactly:
{
  "analysis_id": "<copy from input>",
  "window": {"from": "<copy>", "to": "<copy>"},
  "findings": [
    {
      "joint_id": "<a joint_id that appears in input.events, or null>",
      "pattern_type": "repeated_sequence|repeated_failure|joint_health|latency_outlier|unexpected_transition|none",
      "pattern_reference": "<the exact state_sequence or failure_class string from the input pattern row, or null>",
      "occurrence_count": <the occurrences number copied from that input pattern row, or null>,
      "anomaly_class": "REPEATED_SEQUENCE|REPEATED_FAILURE|LATENCY_OUTLIER|UNEXPECTED_TRANSITION|NONE|INSUFFICIENT_EVIDENCE",
      "related_event_ids": ["<event_id values copied from input.events>"],
      "evidence_refs": ["<evidence_ref values copied from input.events>"],
      "confidence": "LOW|MEDIUM|HIGH|UNKNOWN",
      "unknowns": ["<what you could not determine from this input>"]
    }
  ],
  "insufficient_evidence": <true|false>,
  "unknowns": ["<what the input did not contain>"]
}

HARD RULES:
1. Every event_id, evidence_ref, joint_id and occurrence_count you write MUST be copied character-for-character from the input. Never invent, never reformat, never guess an id.
2. A finding may ONLY be produced from a row that already exists in input.patterns. input.events exists so you can cite ids for such a row -- you must NEVER derive a pattern from input.events yourself. If every array in input.patterns is empty, "findings" MUST be []. Measured on 2026-08-26 without this rule, the model invented a REPEATED_SEQUENCE with occurrence_count 5 from a five-event single-task window that contained no repetition at all.
3. If the input lacks what you would need (no events, missing fields, empty patterns), set insufficient_evidence to true and use anomaly_class INSUFFICIENT_EVIDENCE with confidence UNKNOWN. Say what is missing in unknowns. Never fill a gap with a plausible value.
4. You are not being asked what to do about anything. Do not recommend, do not instruct, do not address anyone. Report only what the data shows.
"""


def main() -> int:
    if len(sys.argv) >= 2 and sys.argv[1] == "--print-environment":
        # PROOF 1: the sandbox reports the environment it actually received, so
        # "it has no credentials" is a measurement rather than a claim.
        print(json.dumps({
            "cwd": os.getcwd(),
            "env_keys": sorted(os.environ.keys()),
            "argv": sys.argv,
            "hf_hub_offline": os.environ.get("HF_HUB_OFFLINE"),
        }))
        return 0

    if len(sys.argv) < 2:
        print("usage: sandbox-runner.py <input.json>", file=sys.stderr)
        return 2

    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        sandbox_input = json.load(handle)

    from mlx_lm import load, generate
    from mlx_lm.sample_utils import make_sampler

    model, tokenizer = load("mlx-community/Qwen3-4B-Instruct-2507-4bit")
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(sandbox_input, ensure_ascii=False)},
    ]
    prompt = tokenizer.apply_chat_template(messages, add_generation_prompt=True)
    # Greedy: the same input must produce the same analysis, so a finding can be
    # re-derived rather than re-rolled.
    text = generate(model, tokenizer, prompt=prompt, max_tokens=1600, sampler=make_sampler(temp=0.0), verbose=False)
    sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

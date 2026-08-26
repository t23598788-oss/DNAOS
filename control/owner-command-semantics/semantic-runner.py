"""
หน้าที่: the ONLY file in this layer that loads a model. It reads one JSON
file holding the Owner's text, runs mlx-community/Qwen3-4B-Instruct-2507-4bit
locally, and prints raw text to stdout. Nothing else.

ITS JOB IS TRANSLATION, NOT DECISION. It turns natural language into named
fields. It does not decide permission, does not pick a capability, does not
name a resource, does not touch a registry, and cannot: it has no network, no
credentials, no repo access, and its output is checked by ../ai-contract.ts
before anything downstream sees it.

No http/urllib/requests/socket/subprocess import anywhere in this file, and
HF_HUB_OFFLINE=1 keeps the loader off the network too.

Input: argv[1] = path to a JSON file {"raw_text": "..."} (or
--print-environment, which makes the process report the environment it
actually received).
Output: stdout = the model's raw text. Validation happens outside this
process, in ../ai-contract.ts — the untrusted side never judges its own answer.
"""

import json
import os
import sys

SYSTEM_PROMPT = """You read one Owner command written in Thai or English and label what it says. You are a translator, not a decision maker.

Return ONE JSON object, no prose, no markdown fence, exactly these fields:
{
  "raw_text": "<the Owner's text, copied character for character>",
  "intent": "<one short phrase for what the Owner wants>",
  "action": "<ONE verb in caps: CHECK, CONNECT, RUN, CREATE, LIST, EXPLAIN, CONTINUE, STOP, DELETE, UPDATE, UNKNOWN>",
  "target_text": "<the exact words naming what is acted on, or null>",
  "entity_mentions": ["<each distinct thing the Owner named, in the Owner's own words>"],
  "resource_reference": "<the words that seem to name a resource, or null>",
  "capability_reference": "<the words that seem to name a tool or capability, or null>",
  "parameters": {"<name>": "<value the Owner actually stated>"},
  "constraints": ["<any limit the Owner stated>"],
  "continuation_reference": "<PREVIOUS_CONTEXT if the Owner referred to something from earlier (อันเมื่อกี้, ตัวเดิม, that one, the previous one), else null>",
  "previous_context_reference": "<the exact words that pointed backwards, or null>",
  "requested_result": "<what the Owner wants back, or null>",
  "ambiguities": ["<anything you could not tell for certain>"]
}

HARD RULES:
1. NEVER output an identifier. No capability-<uuid>, no resource-<uuid>, no task-<uuid>, no cmd_<id>. You do not know which thing in the system this is, and you must not guess. Say only what the Owner CALLED it, in the Owner's own words.
2. Copy raw_text exactly. Do not translate it, correct it, or shorten it.
3. Put anything you are unsure about in "ambiguities". An unclear command with ambiguities listed is a correct answer; a confident wrong one is not.
4. If the Owner referred to something earlier without naming it, set continuation_reference to PREVIOUS_CONTEXT and put the pointing words in previous_context_reference. Do not try to work out what it was.
5. Do not recommend, do not instruct, do not answer the Owner. Only label.
"""


def main() -> int:
    if len(sys.argv) >= 2 and sys.argv[1] == "--print-environment":
        print(json.dumps({"cwd": os.getcwd(), "env_keys": sorted(os.environ.keys()), "hf_hub_offline": os.environ.get("HF_HUB_OFFLINE")}))
        return 0

    if len(sys.argv) < 2:
        print("usage: semantic-runner.py <input.json>", file=sys.stderr)
        return 2

    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        owner_text = json.load(handle)["raw_text"]

    from mlx_lm import load, generate
    from mlx_lm.sample_utils import make_sampler

    model, tokenizer = load("mlx-community/Qwen3-4B-Instruct-2507-4bit")
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": owner_text},
    ]
    prompt = tokenizer.apply_chat_template(messages, add_generation_prompt=True)
    # Greedy: the same Owner sentence must label the same way every time.
    text = generate(model, tokenizer, prompt=prompt, max_tokens=900, sampler=make_sampler(temp=0.0), verbose=False)
    sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

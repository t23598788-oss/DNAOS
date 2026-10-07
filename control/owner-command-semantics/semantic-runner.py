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

Mode routing is fail-closed: an unknown mode does not fall back to the
default semantic prompt (MINIMAL_SELF_QUESTION_PYTHON_ROUTE_FIX_V1).
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


# The executable intent vocabulary is NOT owned here. It is read from the one
# deterministic contract that also drives validation, so the prompt can never
# offer the model a word the runtime cannot execute — which is exactly how
# LIST_CAPABILITIES came to be offered with no consumer behind it.
INTENT_CONTRACT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "owner-command", "data", "executable-intent-contract.json",
)


def allowed_intent_values():
    with open(INTENT_CONTRACT_PATH, "r", encoding="utf-8") as handle:
        contract = json.load(handle)
    values = [entry["intent_type"] for entry in contract["executable"]]
    values += [entry["intent_type"] for entry in contract["non_executable"]]
    return values


# Proven self-question prompt restored from stash@{0} (prior alignment work).
# Output shape matches control/conversation-runtime/self-question-classifier.ts.
def self_question_prompt(allowed_candidates):
    return """You classify one Owner question about the running DNA OS program or system itself. Return ONE JSON object, no prose, no markdown fence, exactly these fields and no others:
{
  "raw_text": "<the Owner's text, copied character for character>",
  "subject_candidate": "SELF" if the Owner is asking about the program/system that is currently talking to them (however they refer to it — "you", "มึง", "คุณ", "this program", "this file", or no pronoun at all), or the exact words naming a DIFFERENT specific thing if the question is clearly about something else, or null if you cannot tell what the question is about,
  "question_type_candidate": "<exactly one value from the allowed list below, or null if none fit>",
  "confidence": <a number from 0 to 1, your own confidence in this classification>
}

Do not emit intent, action, target_text, entity_mentions, resource_reference, capability_reference, parameters, constraints, continuation_reference, previous_context_reference, requested_result, or ambiguities. Those belong to a different contract.

Allowed values for question_type_candidate — choose the single best match, or null:
""" + ", ".join(allowed_candidates) + """

HARD RULES:
1. Never output an identifier (no capability-<uuid>, no resource-<uuid>, no task-<uuid>). subject_candidate is either the literal string SELF, the Owner's own words for something else, or null.
2. Copy raw_text exactly from the Owner. Do not translate it, correct it, or shorten it.
3. question_type_candidate must be copied EXACTLY from the allowed list, or null. Never invent a new value, never abbreviate, never translate it.
4. subject_candidate and question_type_candidate answer two DIFFERENT questions: subject_candidate is WHO/WHAT the question is about; question_type_candidate is WHAT KIND of question it is. Never copy one field's value into the other.
5. A question asking which repository/repo the program lives in, with no other specific thing named, is about SELF with question_type_candidate REPOSITORY — not about "REPOSITORY" as the subject.
6. A question naming a specific other thing (a capability, a file, a component — anything that is not the program answering) is NOT about SELF, even if it also asks "where does it come from" — subject_candidate must be that thing's own name, never SELF.
7. WORK_STATUS means asking about progress on a task/objective the Owner gave (what got done, what is blocked, what is left) — it has NOTHING to do with "working copy" as in a git/source-code sense. A question about whether a file/artifact IS a working copy versus the original/canonical source is ROLE, never WORK_STATUS.
8. CONNECTIONS means asking which registered connections/connectors/external systems or protocols exist, whether an integration is connected/verified/blocked/not wired, or how an external system reaches DNA OS. Questions of the form "does the system have [an integration/protocol]" or "is [an external system] connected" are CONNECTIONS, even when they use the words "has" or "can". For example, "what external systems are connected?" and "does the system have an integration?" are CONNECTIONS; "what can DNA OS do?" is CAPABILITIES. CAPABILITIES means asking what DNA OS can do; do not use CAPABILITIES for a connection-status question.
9. If the question mixes several things or you are not confident, prefer null over a guess.

EXAMPLES (format only — do not reuse these exact answers for different text):
Owner text: "มึงมาจากไหน" -> {"raw_text": "มึงมาจากไหน", "subject_candidate": "SELF", "question_type_candidate": "SOURCE", "confidence": 0.95}
Owner text: "โปรแกรมตัวนี้อยู่ repo ไหน" -> {"raw_text": "โปรแกรมตัวนี้อยู่ repo ไหน", "subject_candidate": "SELF", "question_type_candidate": "REPOSITORY", "confidence": 0.95}
Owner text: "DNA OS มี connection อะไรบ้าง" -> {"raw_text": "DNA OS มี connection อะไรบ้าง", "subject_candidate": "SELF", "question_type_candidate": "CONNECTIONS", "confidence": 0.95}
"""


def select_prompt_text(request):
    """Select the exact prompt for the requested mode. Unknown modes fail closed."""
    mode = request.get("mode")
    if mode is None or mode == "":
        return SYSTEM_PROMPT
    if mode == "OWNER_TOOL_REQUEST_V1":
        return """Translate the Owner request into exactly one JSON object. Do not execute anything. Choose only a capability_id and supported command present in legacy_routing_candidates. legacy_routing_candidates are candidate command/routing surfaces currently exposed by a compatibility layer; membership does NOT prove runtime availability. Candidate presence does not mean the capability is executable, does not mean it is runtime healthy, and does not mean a worker is available. Classify and match the Owner intent only: a deterministic runtime decides whether execution is allowed. Never claim that anything executed successfully, and never infer health or availability from candidate membership. intent_type must be exactly one of these values and nothing else: """ + ", ".join(allowed_intent_values()) + """. For LIST_AVAILABLE_CAPABILITIES and CAPABILITY_STATUS, selected_capability and selected_tool must be null unless an exact catalog item was named by the Owner. Return exactly this shape, replacing each <...> with a real value: {\"intent_type\":\"<one value from the list above>\",\"selected_capability\":\"catalog capability_id or null\",\"selected_tool\":\"catalog supported command or null\",\"arguments\":{},\"intended_outcome\":\"string\",\"ambiguity\":[],\"confidence\":0}. Never invent identifiers or tools. If no catalog item fits, use UNKNOWN and null selections."""
    if mode == "OWNER_MULTI_MEANING_V1":
        return """Interpret the Owner's natural language without executing anything. First enumerate every independent question, action, or desired outcome internally, then serialize that complete enumeration. Preserve one separate requests item for each independent outcome; never merge two outcomes merely because they concern the same system, and never omit an outcome because it is broad, ambiguous, implicit, lacks punctuation, or is adjacent to another outcome. Split by meaning, not by newline, punctuation, keywords, or fixed phrases. If two outcomes are dependent, keep separate items and record the dependency only in ambiguity or arguments. Return exactly {\"requests\":[{\"request_id\":\"req-1\",\"intent_type\":\"<one value from: """ + ", ".join(allowed_intent_values()) + """>\",\"intended_outcome\":\"string\",\"arguments\":{},\"ambiguity\":[],\"confidence\":0}]}. request_id is a local sequence identity only. Do not choose capabilities/resources/tools, do not execute, and do not drop ambiguous requests. For one independent outcome return one item; for multiple independent outcomes return one item per outcome. The request_id values must be unique within this response."""
    if mode == "OWNER_DISPLAY_RESPONSE_V1":
        return """Turn the provided DISPLAY_PAYLOAD into one concise Thai sentence for the Owner. The input is already a deterministic projection. Do not add facts, IDs, evidence, logs, source, or JSON. Do not execute anything and do not change state. Return plain text only."""
    if mode == "OWNER_SELF_QUESTION_CLASSIFY_V1":
        candidates = request.get("allowed_candidates", [])
        if not isinstance(candidates, list):
            raise ValueError("allowed_candidates must be a list")
        return self_question_prompt(candidates)
    raise ValueError("unsupported language mode: %s" % (mode,))


def main() -> int:
    if len(sys.argv) >= 2 and sys.argv[1] == "--print-environment":
        print(json.dumps({"cwd": os.getcwd(), "env_keys": sorted(os.environ.keys()), "hf_hub_offline": os.environ.get("HF_HUB_OFFLINE")}))
        return 0

    if len(sys.argv) < 2:
        print("usage: semantic-runner.py <input.json>", file=sys.stderr)
        return 2

    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        request = json.load(handle)
    owner_text = request["raw_text"]
    catalog = request.get("catalog", [])
    context = request.get("context", {})

    try:
        prompt_text = select_prompt_text(request)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2

    from mlx_lm import load, generate
    from mlx_lm.sample_utils import make_sampler

    model, tokenizer = load("mlx-community/Qwen3-4B-Instruct-2507-4bit")
    user_content = (json.dumps({"raw_owner_text": owner_text, "conversation_context": context, "legacy_routing_candidates": catalog}, ensure_ascii=False)
                    if request.get("mode") == "OWNER_TOOL_REQUEST_V1"
                    else json.dumps({"DISPLAY_PAYLOAD": request.get("display_payload")}, ensure_ascii=False)
                    if request.get("mode") == "OWNER_DISPLAY_RESPONSE_V1" else owner_text)
    messages = [
        {"role": "system", "content": prompt_text},
        {"role": "user", "content": user_content},
    ]
    prompt = tokenizer.apply_chat_template(messages, add_generation_prompt=True)
    # Greedy: the same Owner sentence must label the same way every time.
    text = generate(model, tokenizer, prompt=prompt, max_tokens=900, sampler=make_sampler(temp=0.0), verbose=False)
    sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

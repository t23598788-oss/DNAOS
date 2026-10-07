#!/bin/bash
# DNA OS physical-scope admission for Cursor. Policy layer only — not a second
# sandbox. Always emit valid JSON and exit 0 so failClosed cannot deadlock.
set +e
input="$(cat)"
parsed="$(printf '%s' "$input" | python3 -c 'import json,sys
raw=sys.stdin.read()
try:
  e=json.loads(raw or "{}")
except Exception:
  e={}
cmd=e.get("command") or (e.get("tool_input") or {}).get("command") or ""
path=e.get("file_path") or e.get("path") or (e.get("tool_input") or {}).get("path") or ""
print(cmd.replace("\n"," ").replace("\r"," "))
print(path.replace("\n"," ").replace("\r"," "))')"
command="$(printf '%s' "$parsed" | sed -n '1p')"
path="$(printf '%s' "$parsed" | sed -n '2p')"

deny() {
  printf '{"permission":"deny","agent_message":"%s","user_message":"%s"}\n' "$1" "$1"
  exit 0
}

if printf '%s' "$command" | grep -Eq 'git[[:space:]]+remote[[:space:]]+set-url|git[[:space:]]+remote[[:space:]]+add'; then
  deny "GIT_SCOPE_DENIED"
fi
if printf '%s' "$command" | grep -Eq 'git[[:space:]].*push' && printf '%s' "$command" | grep -Eq '://|git@'; then
  deny "GIT_SCOPE_DENIED"
fi
if printf '%s' "$command" | grep -Eq '(^|[[:space:]])kill[[:space:]]+[0-9]{2,}'; then
  deny "RUNTIME_SCOPE_DENIED"
fi
if printf '%s' "$command" | grep -Eq ':5181|[[:space:]]5181([[:space:]]|$)|:8791|[[:space:]]8791([[:space:]]|$)'; then
  deny "PORT_SCOPE_DENIED"
fi
if printf '%s' "$command" | grep -Eq 'launchctl[[:space:]]+(bootout|kickstart|kill)'; then
  deny "RUNTIME_SCOPE_DENIED"
fi
if printf '%s' "$command" | grep -Eq '\.\./|^/Users|/Desktop/DNA-OS|Application Support/DNA OS'; then
  deny "PATH_SCOPE_DENIED"
fi
if printf '%s' "$path" | grep -Eq '^/Users|/Desktop/DNA-OS|Application Support/DNA OS|(^|[[:space:]])\.\./'; then
  deny "PATH_SCOPE_DENIED"
fi

printf '{"permission":"allow","agent_message":"NON_CANONICAL_UNTRUSTED_EXECUTION"}\n'
exit 0

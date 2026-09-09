# Google Workspace

Human projection of [connection-document.json](./connection-document.json).
Runtime state authority is **not** this file.

```text
CONNECTION
connection.google.workspace.v1

STATE_SOURCE
connections/google-workspace/oauth/store.ts
→ connections/google-workspace/oauth/data/authorizations.jsonl

AUTH
POST /oauth/google/workspace/begin
GET  /oauth/google/workspace/callback

IMPLEMENTATION
connections/google-workspace/oauth/google-oauth.ts
connections/google-workspace/oauth/lifecycle.ts
transport/owner-command-http/google-oauth-routes.ts

ACCOUNT
dnaos.tech@gmail.com
(id 100151411141238003583)

CREDENTIAL
credential://google/workspace/oauth

SCOPES
openid
userinfo.email   (requested as email; equivalent)
gmail.readonly
calendar.calendarlist.readonly
calendar.events.readonly
drive.readonly
spreadsheets.readonly

CAPABILITIES
google.gmail.readonly      CONNECTED
google.calendar.readonly   CONNECTED
google.drive.readonly      CONNECTED
google.sheets.readonly     CONNECTED

STATE
CONNECTED

WRITE
false

ENVIRONMENT
TESTING

PRODUCTION
NOT_READY

NEXT
PRODUCTION_READINESS
```

## Rules

- One OAuth family / one `credential://google/workspace/oauth` — no per-service credentials.
- `login_hint` is transaction input only; provider identity is proof.
- `expected_account_email` mismatch → `ACCOUNT_MISMATCH` → prior CONNECTED binding preserved.
- Downloaded OAuth JSON = optional bootstrap only; runtime = public client-config + Keychain.
- `connection-document.json` = DOCUMENTATION_PROJECTION (aligned to runtime; not independent authority).
- Owner primary UI: provider mark + status + one action. Scopes/OAuth/project details stay in advanced/debug.

## Account history

```text
PREVIOUS  t23598788@gmail.com
CURRENT   dnaos.tech@gmail.com
METHOD    expected-account guarded OAuth rebind
```

## Tests (known)

```text
OAUTH_HERMETIC           71/71
ACCOUNT_BINDING          21/21
OWNER_ADMISSION          41/41
OAUTH_JSON_DISCOVERY     26/26
GOOGLE_CONNECTION        14/14
BRAND                    18/18
INVENTORY_REGRESSION     14/14
CANONICAL_TOOLING        27/27
MCP_SERVER               FAIL (PRE_EXISTING_OR_ENVIRONMENTAL; not Google-bind related)
```

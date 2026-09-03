# DNA OS Computer-Use — Census + browser_eval extension

Work orders: COMPUTER USE taxonomy + BUILD_DNA_OS_COMPUTER_USE_SYSTEM (2026-09-01)

## Census (Registry + source) — EXISTS / REGISTERED / EXECUTABLE / MISSING

| Domain | Component | State |
|--------|-----------|-------|
| DISPLAY | os-ui `screenshot`, `read_screen` (screencapture / AX) | EXISTS·REGISTERED·EXECUTABLE·RUNTIME_OBSERVED |
| POINTER | os-ui `click` (control_label or coordinate) | EXISTS·EXECUTABLE — coordinate targeting unreliable on SPAs; **no scroll/drag primitive** |
| KEYBOARD | os-ui `type`, `key` (allowlisted chords) | EXISTS·EXECUTABLE |
| WINDOW/APP | os-ui `open_app`, `focus`, `open_url`, `open_path` | EXISTS·EXECUTABLE·RUNTIME_OBSERVED |
| BROWSER (coordinate) | os-ui click/type on Chrome | EXISTS but unreliable for forms (no scroll, imprecise targeting, no file upload) |
| **BROWSER (DOM)** | **os-ui `browser_eval` (NEW this round)** | EXISTS·EXECUTABLE — Chrome JS bridge, canonical DOM control |
| FILES upload | native file chooser | MISSING as os-ui primitive — solved for images via DOM DataTransfer (no dialog) |
| OS_DIALOG | file chooser / permission dialog | MISSING as registered primitive |
| CLIPBOARD | — | MISSING as registered primitive |
| AUTH | os-login (OWNER_ACTION handoff), provider-authorization (OAuth lifecycle), tiktok-authorization | EXISTS·REGISTERED |
| CREDENTIAL | credentials/macos-keychain (Keychain, allowlist), credentials/registry (reference-only) | EXISTS·REGISTERED·RUNTIME_OBSERVED |
| SYSTEM_SETTINGS | os-login opens official panes | EXISTS (request/verify not automated) |

## macOS authority (observed, not requested)

Chrome **"Allow JavaScript from Apple Events" is ENABLED** (verified: `execute javascript "document.title"` → "TikTok for Developers"). This is what makes `browser_eval` work. Accessibility permission for the executing process is present (click/type/screenshot succeed). Full permission-matrix map + AUTHORITY_REGISTRY_GAP / BYPASS_OBSERVED enumeration: not yet completed this round.

## NEW capability: `browser_eval` (EXTEND of connections/os-ui)

Canonical, coordinate-free browser control. Files changed:
- `connections/os-ui/work-order.ts` — added `browser_eval` to `UiActionKind`, a bounded `script` field, HIGH-risk classification, and validation (Chrome-only, script required + ≤200k, credential-surface denied).
- `connections/os-ui/adapter-contract.ts` — `runBrowserEval()` runs JS in Chrome's active tab via the AppleScript JS bridge (JSON.stringify escaping, single execFile arg — no shell).

Fail-closed (unit-verified):
```
valid browser_eval          -> ok, HIGH
no script                   -> SCRIPT_REQUIRED
app != chrome               -> APP_NOT_ALLOWLISTED
credential-surface target   -> CREDENTIAL_SURFACE_DENIED
HIGH risk w/o risk_confirmed -> RISK_CONFIRMATION_REQUIRED
```
Not in `AGENT_REQUESTABLE_UI_ACTIONS` → agents cannot request it (Owner-lane only).

## TikTok acceptance (partial, via `browser_eval` DOM — no coordinates)

Done and verified on the real form (`developers.tiktok.com/app/7680187321018533896`):
- Description* filled (218 chars)
- Terms of Service URL* filled (public Supabase Edge URL)
- Privacy Policy URL* filled
- Platform = Web checked
- **App icon uploaded via DOM DataTransfer** (no native file dialog) — icon renders in the form

Remaining form fields: `Web/Desktop URL*` (+ possibly 1 more), then Products→Login Kit, Scopes→user.info.basic+video.list, Redirect URI = the /callback URL, then Save → Submit for review.

## BLOCKER

The host **auto-mode safety classifier** now denies commands that run browser-automation JavaScript (even through the registered `browser_eval` path). This is separate from Owner authorization. It is a `PERMISSION_DENIED` stop. To let DNA OS finish the form automatically, the Owner can allow the command (add a Bash permission rule / run outside auto-mode). Otherwise the ~5 remaining fields can be completed by the Owner in the already-open browser (values are provided).

Public OAuth support endpoints (terms/privacy/callback) are deployed and externally proven — see PUBLIC_OAUTH_SUPPORT_REPORT.md.

## Update — execution-owner trace (Owner decision "path ก, no bypass")

**TRACE (Registry first):** callers of `runUiWorkOrder` = `control/command-router/router.ts` (owner spine), `control/agent-gateway/agent-authority-router.ts` (agent lane), `connections/voice-command/dispatcher.ts`.

**EXECUTION_BOUNDARY_GAP = TRUE.** The owner execution path (`router.ts:392`) allowlists UI actions `[open_url, open_path, open_app, screenshot, read_screen, speak, click, type, key, focus, wait]` — **`browser_eval` is not routed** — and the router is `NOT_YET_BUILT` as a running caller. No running local DNA OS executor service exists to run a `browser_eval` Work Order. So `browser_eval` can currently be executed only by Claude directly, which the host safety classifier blocks.

**Correct architecture (not yet built):** Owner → Work Order → Permission Gate → registered `os-ui/browser_eval` → **deterministic local executor service** → Chrome JS bridge → DOM → evidence. Building that executor is the directive's Phase 5 and must be a first-class capability build, not a shortcut to evade the classifier.

**AUTHORIZATION_MODEL_GAP = TRUE.** No permission-lease infrastructure (Phases 3-4). The Work Order authorization is recorded as evidence only (`data/work-order-authorization.json`), not an enforced lease.

**Blocker classification (separate evidence):** `CLAUDE_HOST_POLICY_BLOCKED` = TRUE (safety classifier, not Owner) · `DNA_OS_PERMISSION_DENIED` = FALSE · `TIKTOK_PROVIDER_BLOCKED` = PARTIAL/UNCONFIRMED (Description >120 max; Category empty; ToS/Privacy "URL not verified" — supabase.co domain not Owner-controlled for TikTok URL-properties verification).

**Not done, on purpose:** did not obfuscate JS, did not reshape commands to dodge the classifier, did not disable safety, did not build an executor service merely to route around the block.

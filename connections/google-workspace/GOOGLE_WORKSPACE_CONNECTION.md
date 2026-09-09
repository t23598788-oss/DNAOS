# DNA OS ↔ Google Workspace Connection Family

Canonical document ID: `connection.google.workspace.v1`

This is the human/developer projection of [connection-document.json](./connection-document.json). The JSON record is authoritative.

## Family model (one identity)

```text
GOOGLE_CONNECTION_ID = connection.google.workspace.v1
  → GOOGLE_ACCOUNT_ID          (resolved after Owner OAuth — never invented)
  → CREDENTIAL_REF             = credential://google/workspace/oauth
  → GRANTED_SCOPES             (tracked individually)
  → Gmail    service://google/gmail
  → Calendar service://google/calendar
  → Drive    service://google/drive
  → Sheets   service://google/sheets
```

One OAuth family. Do **not** create four independent login systems or four credential identities.

## Status summary

Overall parent status: `AUTH_REQUIRED` until an ACTIVE `credential://google/workspace/oauth` reference exists with granted scopes.

| Service | Capability ID | Required scope | V1 write |
|---|---|---|---|
| Gmail | `google.gmail.readonly` | `gmail.readonly` | disabled |
| Calendar | `google.calendar.readonly` | `calendar.calendarlist.readonly` + `calendar.events.readonly` | disabled |
| Drive | `google.drive.readonly` | `drive.readonly` | disabled |
| Sheets | `google.sheets.readonly` | `spreadsheets.readonly` | disabled |

Free/busy (`calendar.events.freebusy`) is **not** requested until a capability actually performs free/busy lookup.

## OAuth path (TikTok lifecycle discipline, Google semantics)

```text
POST /oauth/google/workspace/begin  → beginAuthorization()
GET  /oauth/google/workspace/callback → completeAuthorization()
```

- Client refs: `credential://google/workspace/oauth-client/client-id` / `.../client-secret`
- User token ref: `credential://google/workspace/oauth`
- PKCE: S256 base64url (not TikTok hex)
- `CLIENT_CONFIGURATION_STATE = CONFIGURATION_REQUIRED` until Owner admits client_id/secret/redirect
- Deadboard `GMAIL_CLIENT_*` must not be reused
- Source path alone does **not** mark CONNECTED

Missing one scope does **not** authorize another. Parent may become `PARTIALLY_AUTHORIZED` when only a subset of services has required scopes.

## DNA OS MCP path (reuse — no Google logic in MCP)

```text
AI Client
  → DNA OS MCP (dna_os.list_remote_services / dna_os.get_remote_service_capabilities / dna_os.get_capability_binding_status)
  → DNA OS tool grant + local-resource-access gate
  → REMOTE_SERVICE_CAPABILITY_BINDING_V1 service://google/{gmail|calendar|drive|sheets}
  → connection.google.workspace.v1
  → credential://google/workspace/oauth (Keychain pointer)
  → approved Google adapter / APIs
```

MCP must not hold tokens, call Google directly, or embed provider business logic.

### Official Google Workspace MCP (DNA OS owned, not client-direct)

- If used: same OAuth identity + minimum readonly scopes.
- Clients do **not** receive Workspace MCP as a direct tool; DNA OS remains ingress authority.
- Posture: `client_direct_access=false`, `read_only=true`, `dna_os_is_authority=true`.

## Authority and security

- Tokens stay in DNA OS secret authority (Keychain). Source/docs/MCP/evidence receive only `credential_ref`, account identity, scope summary, and status.
- `WRITE_ENABLED = false` for V1. Send/create/update/delete/upload are Owner-disabled on the binding.
- Existing Gmail Edge path (`connections/email-alert-source` → provider-alert-email-read) remains a separate Supabase boundary; this family does not invent a second Gmail credential identity.

## Brand assets (presentation only)

Icons resolve through the existing connection-layer metadata — not a second branding registry:

```text
PROVIDER_ID → provider-metadata.ts → brand_asset_ref → brand-asset-resolver → UI
```

| Surface | Mark |
|---|---|
| DNA OS shell / header / nav | DNA OS D master mark (`dna-os`) |
| Provider connection cards | Official provider icon, or neutral generic if missing |
| Never | DNA OS D as substitute for Google / Gmail / Drive / Supabase / … |

| Identity | provider_id | Brand ref (canonical) |
|---|---|---|
| Google Workspace parent | `google` | distinct Workspace/Google mark (not DNA OS D) |
| Gmail | `google-gmail` | distinct Gmail product mark (not parent G, not DNA OS D) |
| Calendar | `google-calendar` | distinct Calendar product mark |
| Drive | `google-drive` | distinct Drive product mark |
| Sheets | `google-sheets` | distinct Sheets product mark |

Official sources (Owner import required — do not alter marks):

- https://about.google/brand-resource-center/
- https://knowledge.workspace.google.com/admin/getting-started/brand-your-internal-communications-with-google-workspace
- Drive: https://developers.google.com/workspace/drive/api/guides/branding

Until local official SVGs are imported, resolver returns `MISSING_OFFICIAL_ASSET` and the **neutral generic** integration icon — never the DNA OS D. Visual identity does **not** create separate OAuth/credential identities.

## Evidence boundary

Wiring + hermetic reuse tests prove family/shape/MCP authority. Live OAuth admission and per-service bounded reads are Owner-gated follow-on work — absence of a registry row is reported as `AUTH_REQUIRED`, not invented success.

# Google Workspace Production Readiness V1

Status authority for production readiness preparation of `connection.google.workspace.v1`.

## Current state

```text
CONNECTION          connection.google.workspace.v1
ACCOUNT             dnaos.tech@gmail.com
RUNTIME_STATE       CONNECTED
ACCESS_MODE         READ_ONLY
OAUTH_ENVIRONMENT   TESTING
PRODUCTION_READY    false
TASK                 GOOGLE_WORKSPACE_PRODUCTION_READINESS_V1
```

The existing OAuth bind is valid for testing. This document does not promote TESTING to production.

## Production gate

Production may be marked ready only when all of the following are evidenced:

- A separate production Google Cloud project/client is configured for the production environment.
- OAuth consent configuration accurately represents DNA OS and uses domains controlled by the Owner.
- Public HTTPS application/support/privacy/terms URLs required by the configured consent screen are live and consistent.
- Production redirect URI is HTTPS and exactly matches the runtime callback configured for the production OAuth client.
- The production consent screen declares exactly the scopes requested by runtime.
- Scope justification exists for every sensitive/restricted scope and demonstrates least privilege.
- Google brand verification is complete where required.
- Google sensitive/restricted-scope verification is complete where required.
- Any security assessment required by Google for restricted-scope data handling is complete and current.
- Production OAuth client identity has passed DNA OS Owner admission and is stored through the existing credential authority; no client secret is committed to source.
- A live production OAuth rebind to the expected account succeeds.
- Gmail, Calendar, Drive, and Sheets readonly capability probes succeed under the production credential.
- Runtime projection reports `environment=PRODUCTION` and `production_ready=true` only after the above evidence exists.

## Requested scopes in V1

```text
openid
email
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/calendar.calendarlist.readonly
https://www.googleapis.com/auth/calendar.events.readonly
https://www.googleapis.com/auth/drive.readonly
https://www.googleapis.com/auth/spreadsheets.readonly
```

Do not add broader scopes for future features. Write scopes remain out of scope for V1.

## Restricted-scope consequence

The current readonly family includes Google scopes that may trigger sensitive/restricted-scope verification. When restricted-scope data is stored or transmitted through third-party/server infrastructure, Google can require an annual security assessment. Production readiness therefore cannot be inferred from a successful testing OAuth bind alone.

## Architecture constraints

- Keep one canonical Workspace family: `connection.google.workspace.v1`.
- Keep one credential identity: `credential://google/workspace/oauth`.
- Do not create per-service Google logins or credentials.
- Do not expose Google credentials directly to AI clients.
- Preserve Owner admission for production OAuth client configuration.
- Preserve expected-account guarded binding.
- Preserve read-only capability policy for V1.

## External actions that cannot be truthfully completed from repository tooling alone

The Google Cloud Console remains the authority for publishing the OAuth app, domain/brand configuration, verification submission, review status, and any required security assessment. Until those provider-side states are verified, DNA OS must remain `PRODUCTION_READY=false`.

## Completion evidence

When provider-side work is complete, record only non-secret evidence:

```text
GOOGLE_CLOUD_PROJECT_ID=<non-secret id>
OAUTH_CLIENT_ID_SUFFIX=<non-secret identifying suffix only>
CONSENT_PUBLISHING_STATUS=IN_PRODUCTION
BRAND_VERIFICATION_STATUS=VERIFIED|NOT_REQUIRED
SCOPE_VERIFICATION_STATUS=VERIFIED|NOT_REQUIRED
SECURITY_ASSESSMENT_STATUS=VALID|NOT_REQUIRED
PRODUCTION_CALLBACK=<https url>
PRODUCTION_BIND_ACCOUNT=dnaos.tech@gmail.com
PRODUCTION_CAPABILITY_PROBES=PASS
```

Never record OAuth client secrets, access tokens, refresh tokens, authorization codes, PKCE verifiers, or session secrets in Git.

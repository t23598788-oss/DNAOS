# connections/provider-authorization/

One job: manage the authorization lifecycle of an external provider connection — never that provider's execution (GitHub source execution stays in `../github/` and `../../control/source-execution/`).

## State machine

`NOT_CONNECTED → AUTHORIZATION_REQUIRED → AUTHORIZATION_PENDING → CONNECTED`, with `AUTHORIZATION_FAILED` and `REVOKED` as terminal/recoverable side states.

## API (`./contract.ts`)

- `beginAuthorization({ provider, cwd })` — discovers the real local git remote, ensures a `ConnectionRegistration` exists, requests a GitHub Device Flow device/user code, returns `{ user_code, verification_uri, expires_in, interval }` for the UI to show the Owner.
- `getAuthorizationStatus(connection_id)` — read-only status lookup.
- `completeAuthorization(connection_id)` — blocks, polling GitHub at the Device Flow's own interval, until the Owner approves in their browser (or the code expires / is denied). On success: writes the token to macOS Keychain only, attaches the resulting `credential_ref` to the `ConnectionRegistration`, verifies the authenticated GitHub identity and the registered repository, and flips both records to `CONNECTED` / `connected`.
- `revokeAuthorization(connection_id)` — marks the credential `REVOKED` and the connection `disconnected`.
- `buildGithubPluginStatus(connection_id)` — the UI read model (`provider, display_name, logo_key, login_status, plugin_status, account, connection_status, authorization_status`) — never includes a token.
- `runGithubBootstrapCheck(cwd)` — startup check: is a GitHub remote discoverable, is it authorized. Never forces a fresh login when an existing credential is still valid.

## GitHub auth method

Official GitHub OAuth [Device Authorization Flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow) — the flow GitHub itself recommends for CLI/desktop apps with no way to receive a web redirect. No password is ever seen by DNA OS or an Agent; the Owner approves in their own browser.

Requires a real GitHub OAuth App with **Device Flow enabled**, created by the Owner at <https://github.com/settings/developers> (DNA OS cannot create this itself — that action requires the Owner's own GitHub login). Its `client_id` — a public identifier, not a secret — is read from `GITHUB_OAUTH_CLIENT_ID`.

## Credential storage

Raw token → macOS Keychain only (`credentials/macos-keychain/api-registration.ts`, reused unmodified). DNA OS keeps only `credential_ref, provider, account, connection_id, authorization_status, granted_scope, created_at/updated_at` — see `./types.ts`'s `ProviderAuthorizationRecord`.

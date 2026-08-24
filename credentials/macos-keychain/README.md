# macOS Keychain credential provider

This is a credential-resolution seam for already-authorized provider calls. It
does not autofill forms, type into applications, dismiss macOS security
prompts, grant Keychain ACL access, or bypass login/MFA.

The only supported operation is a bounded `security find-generic-password`
lookup by an allowlisted reference (`service` + `account`). macOS may show its
normal native authorization prompt. A denial, timeout, cancellation, missing
item, or non-macOS host is returned honestly and is never converted to a fake
credential.

Audit records contain only reference metadata and a redacted outcome. Secret
values are never written to disk, logs, evidence, or returned in an error.

Production callers should keep this provider behind their existing
`CredentialProvider`/connector boundary. Tests inject a fake command runner;
production code has no dummy credential or fallback store.

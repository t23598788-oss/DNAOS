# connections/email-alert-source/

**หน้าที่:** the EMAIL INPUT ADAPTER between the **existing** Gmail reader
and `control/alert-correlation/`. It reads no mail. It performs one
authenticated HTTP call and translates field names.

```
EXISTING GMAIL READER  (dna-os-deadboard/supabase/functions/_shared/gmail-client.ts, Deno)
        ↓  HTTP + shared secret
EMAIL INPUT ADAPTER    (this folder, Node)
        ↓  RawAlertEmail[]
control/alert-correlation/
        ↓
incident pipeline
```

## The existing reader this reuses

| | |
|---|---|
| Source path | `~/Desktop/dna-os-deadboard/supabase/functions/_shared/gmail-client.ts` (99 lines) |
| Exports | `getGmailAccessToken`, `searchGmailMessageIds`, `fetchGmailMessage`, `extractBodyText`, `getSubjectHeader` |
| Scope | `gmail.readonly` — never send/modify/delete |
| Runtime owner | Supabase Edge Functions (Deno), project `vibrant-hawking` |
| Credential boundary | `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` in the Edge Function's own env. **Never copied into DNA OS.** |
| Already used by | `bank-email-sync` (pg_cron **every 5 min**, production), `subscription-email-sync`, `supabase-billing-sync`, `system-health-check` |

`subscription-email-sync` already keeps a provider table of deterministic
`from:` fragments (Google, OpenAI, Anthropic, RunPod, Vercel, GitHub,
Apple, Hostinger) — the same closed, sender-scoped style this adapter
requires. The async worker pattern the Owner asked for already exists and
already runs.

## CREDENTIAL BOUNDARY — unchanged by this folder

DNA OS gains **no** Google credential. `credentials/registry/` still holds
only `github` and `railway`. The OAuth refresh token stays where it is,
inside the Edge Function environment, and this adapter authenticates to
the *function* with a per-function shared secret supplied by its caller —
the same `x-<function>-secret` header pattern the existing functions use.

## What is enforced, not just promised

`./tests/adapter.test.ts` scans the **code** of every file here (comments
stripped, because these files deliberately document what they do *not*
do) for `oauth2.googleapis`, `gmail.googleapis`, `users.messages`,
`refresh_token`, `GMAIL_CLIENT`, `nodemailer`, `imapflow`, `imap`.
Mutation-verified: adding a real `https://oauth2.googleapis.com/token`
constant makes A1 fail; removing it makes it pass.

Also enforced:
- an unscoped query (`""`, `is:unread`) is **refused** — a query must
  start with `from:` / `subject:` / `newer_than:` / `{`
- a missing endpoint or secret fails **NOT_CONFIGURED** with zero emails
- an unreachable reader fails **UNREACHABLE** — there is no
  read-Gmail-directly fallback, by design
- a message with no parseable date is **rejected**, never stamped `now`
  (that would corrupt alert-correlation's claim-vs-observation timing)

## NOT_YET_BUILT — the upstream endpoint

This adapter is complete and tested, but **nothing is deployed for it to
call yet**. The existing Edge Functions read mail for *bank*,
*subscription* and *billing* purposes and return their own domain records
— none returns raw provider-alert messages, and Railway is not in
`subscription-email-sync`'s provider table.

Closing that needs a small sibling function in **dna-os-deadboard** that
imports the same `_shared/gmail-client.ts` and returns
`{ ok, messages: [{ id, threadId, internalDate, from, subject, bodyText }] }`.
That is an extension of the existing capability at its proper boundary —
**not** a new reader.

It was deliberately **not** written by this task: it means writing into a
production repo that handles real bank and payment data, and deploying to
a live Supabase project. That needs the Owner's explicit go-ahead, not an
inference from "connect email alerts".

Until it exists, `fetchAlertEmails` returns `NOT_CONFIGURED` honestly, and
`control/alert-correlation/` can still be driven from any other source of
`RawAlertEmail` records.

## Verification

```
npx tsc --noEmit                                                   # clean
npx tsx connections/email-alert-source/tests/adapter.test.ts       # 11 passed, 0 failed  (needs Node >=18)
```

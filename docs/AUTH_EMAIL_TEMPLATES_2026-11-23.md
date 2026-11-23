<p><img src="https://dnaos.dev/assets/brand/dna-os/v1/dna-os-horizontal-mono.svg" alt="DNA OS" width="148" height="60"></p>

# DNA OS Auth email templates

**Revision date:** 2026-11-23  
**Package:** [`supabase/templates/dna-os-auth-v1/`](../supabase/templates/dna-os-auth-v1/)  
**Source of truth for file names and event mapping:** [`template-index.json`](../supabase/templates/dna-os-auth-v1/template-index.json)

## Package contents

The package contains 13 HTML and subject pairs: 6 authentication messages and 7 security notifications. The JSON index maps each pair to its Supabase Auth event. The templates are static files; this package does not start a worker, schedule a job, or send mail by itself.

Supabase Auth renders and sends a template when its corresponding authentication event occurs. Security notification messages are sent only when that notification is enabled in project settings. This keeps the work event-triggered, one message for each applicable event, with no always-on template process.

## Delivery route

**Production route:** DNA OS login → Supabase Auth (project `xeytcavxejhyzxwevgto`) → Custom SMTP → Resend (`smtp.resend.com:465`) → recipient email.

- Supabase Auth owns the authentication event, template rendering, and send trigger.
- Resend is the outbound email delivery provider. The production sender is `DNA OS <no-reply@auth.dnaos.dev>`.
- Configure or inspect the SMTP connection in **Supabase Dashboard → Authentication → SMTP Settings**. Manage and verify the sending domain in **Resend Dashboard → Domains**.
- SMTP credentials stay in Supabase's protected project settings; they must not be copied into this repository, template files, or public documentation.
- Source-of-truth route record: [`template-index.json`](../supabase/templates/dna-os-auth-v1/template-index.json) under `delivery`. Template file names and event mapping are in the same index.
- This is the authentication email route only. The separate business email channel for invoices, quotations, and partner notifications remains disabled/unconfigured in [`email.registry.json`](../registry/communication/email.registry.json); do not treat it as a second active Resend connection.

The sign-in OTP card uses the monochrome horizontal DNA OS logo for email/document use, displays Supabase's `{{ .Token }}`, and links to the fixed sign-in page at `https://dnaos.dev/login`. The button opens sign-in; it does not authenticate the recipient. The recipient enters the code on that page.

## Release boundary

These files are the versioned source package; changing them does not automatically update Supabase Production. Some templates were saved manually in the Production dashboard, but the full set of 13 has not been verified as applied. Hosted templates are configured in the Supabase Dashboard or through its Management API.

The package scope is template source and its event index. It does not include a mail-sending worker, cron schedule, SMTP credential, or a claim that every template has been exercised through a live send.

## References

- [Supabase Auth Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates) — template categories, events, variables, dashboard/API management, and OTP usage.
- [Supabase Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) — configure the Auth email delivery provider.
- [Resend Domains](https://resend.com/domains) — manage and verify the sending domain.
- [Supabase signInWithOtp](https://supabase.com/docs/reference/javascript/auth-signinwithotp) — behavior selected by using `{{ .Token }}` versus `{{ .ConfirmationURL }}`.

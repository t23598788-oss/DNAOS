# DNA OS Auth email templates

**Revision date:** 2026-11-23  
**Package:** [`supabase/templates/dna-os-auth-v1/`](../supabase/templates/dna-os-auth-v1/)  
**Source of truth for file names and event mapping:** [`template-index.json`](../supabase/templates/dna-os-auth-v1/template-index.json)

## Package contents

The package contains 13 HTML and subject pairs: 6 authentication messages and 7 security notifications. The JSON index maps each pair to its Supabase Auth event. The templates are static files; this package does not start a worker, schedule a job, or send mail by itself.

Supabase Auth renders and sends a template when its corresponding authentication event occurs. Security notification messages are sent only when that notification is enabled in project settings. This keeps the work event-triggered, one message for each applicable event, with no always-on template process.

The sign-in OTP card uses the monochrome horizontal DNA OS logo for email/document use, displays Supabase's `{{ .Token }}`, and links to the fixed sign-in page at `https://dnaos.dev/login`. The button opens sign-in; it does not authenticate the recipient. The recipient enters the code on that page.

## Release boundary

These files are prepared source. They have not been applied to Supabase Production. Updating a repository copy does not change the hosted project's Auth templates; hosted templates are configured in the Supabase Dashboard or through its Management API. Production stays unchanged until a separate approved release action.

The package scope is template source and its event index. It does not include a mail-sending worker, cron schedule, SMTP credential, or a claim that every template has been exercised through a live send.

## References

- [Supabase Auth Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates) — template categories, events, variables, dashboard/API management, and OTP usage.
- [Supabase signInWithOtp](https://supabase.com/docs/reference/javascript/auth-signinwithotp) — behavior selected by using `{{ .Token }}` versus `{{ .ConfirmationURL }}`.

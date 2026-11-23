<p><img src="https://dnaos.dev/assets/brand/dna-os/v1/dna-os-horizontal-mono.svg" alt="DNA OS" width="148" height="60"></p>

# DNA OS Auth email template package

These files are static source templates. They do not run as a worker, scheduled job, or always-on process.

Supabase Auth selects the matching template when an authentication event occurs, renders the event values, then delivers the message through the configured Resend SMTP connection. No custom webhook or mail worker is needed for these Auth messages.

- [`template-index.json`](template-index.json) maps each Auth/security event to its subject and HTML files and records the delivery route.
- [`../../../docs/AUTH_EMAIL_TEMPLATES_2026-11-23.md`](../../../docs/AUTH_EMAIL_TEMPLATES_2026-11-23.md) explains the production route and configuration locations.
- The SMTP credential remains in Supabase's protected project settings and is never stored in this package.

## Files

Each template has a `.subject.txt` subject and `.html` body. The index lists all 13 pairs and their event IDs. Security notification messages are emitted only when enabled in Supabase Auth project settings.

-- Attachments Storage bucket — for document/reference file uploads (invoices, POs, delivery orders, etc.)
--
-- Private bucket, service-role only. The Next.js API route (/api/admin/upload) is the
-- single door: it authenticates the admin session, then uploads/reads via the Supabase
-- service role key server-side. No public bucket policy needed — the client never talks
-- to Supabase Storage directly, same pattern as every other write in this app (Gateway).

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

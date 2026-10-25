-- app_configs was completely empty — core/config-loader.ts's getStr/getNum
-- throw on any missing key by design ("ห้าม hardcode...ไม่มี fallback"),
-- meaning core/config/company-settings.ts's loadCompanySettings() would
-- have thrown the moment anything actually called it. Seeds real, safe
-- defaults only — company identity fields seed empty (never fabricate a
-- fake company name/tax id — เฮีย fills these in at /admin/settings), vat
-- rate seeds 0.07 (Thailand's standard rate, already relied on identically
-- as a hardcoded literal in gateway/actions.ts and cognitive/executor/index.ts
-- before this — not new fabricated data), and the debt-reminder auto-send
-- defaults OFF until explicitly turned on.

insert into public.app_configs (title, data) values
  ('company-name', ''),
  ('company-tax-id', ''),
  ('payment-bank-name', ''),
  ('payment-account-number', ''),
  ('payment-account-name', ''),
  ('vat-rate', '0.07'),
  ('document-terms', ''),
  ('document-footer-note', ''),
  ('debt-reminder-auto-enabled', 'false'),
  ('debt-reminder-hour', '9')
on conflict (title) do nothing;

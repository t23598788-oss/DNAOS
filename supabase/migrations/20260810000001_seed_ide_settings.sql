-- Seeds the 3 real IDE editor-preference keys core/config/ide-settings.ts's
-- loadIdeSettings() requires (TASK-068, capability #61 Phase 1). Same real
-- reason as 20260711000002_seed_app_configs.sql: core/config-loader.ts's
-- getStr() throws "[CONFIG MISSING]" on any absent key, by design (ห้าม
-- hardcode ข้อมูล...ไม่มี fallback) — a missing seed here is a real,
-- immediate bug the moment /admin/ide's Settings tab calls GET on the new
-- app/api/admin/ide/settings/route.ts, not a soft failure.
--
-- All 3 default 'false' — none of these 3 checkboxes has a real runtime
-- consumer yet (TASK-067's exhaustive grep confirmed this), so they must
-- start OFF/UNAVAILABLE, never a fabricated "on" default for a setting
-- that controls nothing real yet.

insert into public.app_configs (title, data) values
  ('ide-auto-save-enabled', 'false'),
  ('ide-format-on-save-enabled', 'false'),
  ('ide-telemetry-enabled', 'false')
on conflict (title) do nothing;

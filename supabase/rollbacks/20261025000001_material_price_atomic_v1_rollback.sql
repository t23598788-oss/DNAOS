-- Rollback for 20261025000001_material_price_atomic_v1.sql
--
-- Run manually only, after the application has been rolled back to a build that
-- does not call these functions (the WAVE 3 writer fails closed without them, so
-- dropping first would only turn price writes into explicit errors, never into a
-- silent non-atomic fallback — still, roll back the app first).
--
-- Safe by construction: this migration was purely additive (two functions + their
-- grants). No table, column or row was created or modified, so there is no data to
-- restore. Dropping the functions removes the atomic commit boundary; the existing
-- TypeScript command list and the audit vocabulary stay unchanged.
--
-- Order:
--   1. roll back the application build (stop calling the two functions)
--   2. run this file
--   3. verify: select proname from pg_proc
--               where proname in ('record_seller_offer_atomic',
--                                 'apply_material_price_atomic');  -- 0 rows
--
-- Do NOT re-create the pre-WAVE-3 compensation path as a "temporary" fallback:
-- it was removed on purpose (compensation cannot guarantee audit ↔ business
-- atomicity). If the functions must be removed, price writes should fail closed
-- until a replacement transactional path exists.

drop function if exists public.record_seller_offer_atomic(uuid, numeric, text, text, timestamptz, jsonb);
drop function if exists public.apply_material_price_atomic(uuid, uuid, numeric, text, uuid, jsonb, jsonb);

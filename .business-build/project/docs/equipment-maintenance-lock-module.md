# Equipment GPS / Engine-Hours / Maintenance-Lock Module

Owner spec, 2026-07-24. Business domain: heavy-equipment security + maintenance
enforcement via a GPS/relay immobilizer box wired into each machine's ignition
circuit (Y-socket splice, normally-closed relay). This document is the system
record for that module — per Rule 111 (Extend Capability, Never Duplicate
Pipeline) and Rule 103 (Reuse Before Build), everything below either extends
the existing Contact Settings / LINE permission backbone or is explicitly
marked as not yet built. **This file must stay honest about what is real code
vs. what is still design** — see `registry/business-coverage.json`'s
`maintenance` entry, which this document supersedes (that entry referenced a
`kis-webhook` capability that does not exist as real code; fixed alongside
this doc).

## Why this exists

One GPS/relay box can be shared by many drivers (a driver may be permitted on
several machines; a machine may be permitted to many drivers) — company
policy is that a physical ignition key must never be sufficient to start
company equipment. Authority to run a machine is a system permission, revoked
independently of who is holding a key. This is the same shape as the existing
Contact Settings rights (อนุมัติเอกสาร / อนุมัติการเงิน / etc.) — extended here
into a new "เครื่องจักร (GPS Relay)" category rather than a parallel system.

## Business event chain (intended, end to end)

```
Hardware layer          →  DNA OS ingestion  →  Rules engine        →  Action
─────────────────         ─────────────────    ─────────────────      ─────────────────
GPS/relay box (NC relay   Telemetry stream      Engine-hours          Auto-create
on ignition circuit,      every 10-30s while    accumulator per       maintenance ticket
12-40V), SMS-command       VCC ≥ 13.5V           equipment_assets      at 250h intervals
controlled                (engine running)       .total_engine_hours

                                                 250h reached, no      Auto-lock (+50h
                                                 maintenance closed    grace, still
                                                                       overdue)

                                                 17:00 shift end, OR   Auto-lock (RELAY
                                                 permission revoked    lock command via
                                                 in Contact Settings   SMS gateway)

                                                 Mechanic closes                Reset hour
                                                 maintenance ticket             counter, send
                                                                                RELAY unlock
```

## Current implementation status

| Layer | Status | Real files |
|---|---|---|
| Equipment registry (assets, sim/IMEI/box password, status) | **COVERED** | `supabase/migrations/20260724000004_equipment_gps_permissions.sql` (`equipment_assets`) |
| Per-driver permission (many-to-many, LINE-identity linked) | **COVERED** | same migration (`driver_equipment_permissions`, FK → `line_profiles.line_user_id`) |
| Admin control room (create equipment, list, toggle permission) | **COVERED** | `app/admin/equipment/page.tsx`, `app/api/admin/equipment/route.ts`, `app/api/admin/equipment/toggle-permission/route.ts` |
| Contact Settings checklist ("เครื่องจักร (GPS Relay)" category) | **COVERED** | `registry/contact-settings-categories.ts`, `components/line/ContactSettingsModal.tsx` (`EquipmentPermissionList`) |
| LINE Rich Menu reflects current permission (start button shown/hidden) | **PARTIAL** | `registry/line-richmenu.ts` — real code, gated cleanly: needs a real `LINE_RICHMENU_START_ID` (a Rich Menu image + tap-area must still be created in the LINE console — not automatable from here) |
| Unlock command (admin-confirmed "start" trigger → SMS relay) | **PARTIAL** | `app/api/admin/equipment/trigger-start/route.ts`, `engines/equipment/relay-command.ts` — real code, gated cleanly on `SMS_GATEWAY_API_URL`/`SMS_GATEWAY_API_KEY` (no provider chosen yet) and on `buildRelayCommandText()`'s command string, which is an **unverified placeholder** (`RELAY,<password>,<0\|1>#`) pending the real GPSDD GDD070 command manual |
| Telemetry ingestion (engine-running signal, VCC ≥ 13.5V stream) | **COVERED (code), PENDING (hardware)** | `app/api/internal/equipment/telemetry/route.ts` — real inbound endpoint, bearer-secret auth (`EQUIPMENT_TELEMETRY_SECRET`), generic `{imei, vccVoltage, recordedAt}` body since no hardware/SMS-gateway provider is chosen yet (provider-specific payload parsing left as a clearly-marked TODO, per Rule 108 — never fabricated) |
| Engine-hours accumulation from telemetry | **COVERED** | `engines/equipment/engine-hours.ts` — real time-delta accumulation between consecutive engine-running pings, capped at `MAX_GAP_HOURS=0.5h` (documented reasoning in-file: pings expected every 10-30s, so a gap over 30 min is a dropped connection, not real running time) — writes to `equipment_assets.total_engine_hours` |
| Maintenance ticket generation at 250h intervals | **COVERED (code), PENDING (deploy)** | `supabase/migrations/20260804000008_equipment_maintenance_telemetry.sql` (`maintenance_tickets` table), `supabase/functions/equipment-maintenance-cron/index.ts` opens a ticket per 250h boundary crossed; `app/api/admin/equipment/maintenance-tickets/route.ts` (list) + `.../[id]/close/route.ts` (admin-confirmed close, resets hour counter, sends real unlock if overdue-locked) — surfaced in `/admin/equipment`. Cron not yet deployed/scheduled live (same pending-owner-go-ahead state as `receipt-reconcile-sweep`, see migration 20260804000009) |
| Auto-lock safety at +50h overdue | **COVERED (code), PENDING (deploy)** | same cron — fires a real lock command via `app/api/internal/equipment/lock-command/route.ts` (bridges to the real `relay-command.ts`) once an open ticket is ≥50h past its 250h trigger point. System-initiated safety lock, deliberately NOT admin-gated (Rule 72 applies to the system taking a risky action; defaulting to the safe/locked state is the opposite case — see Constitution Alignment below) |
| 17:00 shift-end auto-lock | **COVERED (code), PENDING (deploy)** | same cron function, checked at Bangkok UTC+7 (same fixed-offset convention as `debt-reminder-cron`). **Flagged, not resolved**: `driver_equipment_permissions` has no "always allowed"/override column today, so this is genuinely lock-everyone-at-17:00 with no exception path — implemented per the doc's literal intent, but worth the owner confirming this is truly wanted with no exceptions |
| Permission-revocation → actual hardware lock command | **COVERED (code), PENDING (hardware)** | `app/api/admin/equipment/toggle-permission/route.ts` now sends a real lock command when a permission is revoked AND zero other active permissions remain for that equipment (assumed reading of a many-to-many model — see in-file comment; flagged for owner confirmation, since the original chain diagram doesn't disambiguate "a driver's permission revoked" vs "the last driver's permission revoked") |

## What is NOT this session's/AI's task

Selecting and contracting with the GPS/relay hardware manufacturer, and
confirming the real SMS command protocol against their documentation, is the
owner's own task, handled outside this codebase. The code above is
deliberately structured (gated env vars, isolated `relay-command.ts` engine)
so that once those two real-world inputs exist, wiring them in is a config
change, not a rewrite.

## Constitution alignment

- Rule 103 (Reuse Before Build) — driver↔equipment permission reuses the
  existing LINE-identity backbone (`line_profiles`) rather than inventing a
  parallel user model; the Contact Settings entry point reuses the same
  `driver_equipment_permissions` API `/admin/equipment` already calls.
- Rule 72 (human confirmation before writes) — `trigger-start` is
  admin-confirmed on purpose, more conservatively than this session's
  payment-auto-confirm precedent: starting heavy machinery is a different
  risk class than confirming a financial state.
- Rule 108 (no silent config override) — every unbuilt piece above gates
  cleanly on a named missing env var / manual, never a guessed default.

## 2026-08-04 implementation pass

All rows previously marked PLANNED/NOT WIRED YET now have real code:
`supabase/migrations/20260804000008_equipment_maintenance_telemetry.sql`
(`equipment_telemetry_pings`, `maintenance_tickets`,
`equipment_assets.last_ticket_trigger_hours`),
`engines/equipment/engine-hours.ts`,
`app/api/internal/equipment/telemetry/route.ts`,
`app/api/internal/equipment/lock-command/route.ts`,
`supabase/functions/equipment-maintenance-cron/index.ts` (+ migration
`20260804000009_equipment_maintenance_cron.sql`),
`app/api/admin/equipment/maintenance-tickets/route.ts` +
`.../[id]/close/route.ts`, and an extension to
`app/api/admin/equipment/toggle-permission/route.ts`. What is still
genuinely NOT real, honestly:

- No SMS gateway provider chosen — `SMS_GATEWAY_API_URL`/`SMS_GATEWAY_API_KEY`
  still unset, same gate as before.
- No real GPSDD GDD070 command manual confirmed — `buildRelayCommandText()`
  is still an unverified placeholder, unchanged.
- No hardware/telemetry provider chosen — the ingestion endpoint's wire
  format (`{imei, vccVoltage, recordedAt}`) is a reasonable generic shape,
  not a confirmed vendor protocol; provider-specific parsing is a stated
  TODO in the route file.
- The cron function is written but not deployed/scheduled against the live
  Supabase project (`supabase functions deploy` + real secrets +
  uncommenting the `cron.schedule` call in the migration file are still
  owner actions, same posture as `receipt-reconcile-sweep`).
- Two business rules were assumed rather than found explicitly in the
  schema, both flagged in their respective files for owner confirmation:
  (1) closing a maintenance ticket resets `total_engine_hours` to 0 (read
  literally from "Mechanic closes maintenance ticket -> Reset hour
  counter"); (2) permission-revocation only auto-locks when it leaves zero
  active permissions for that equipment unit (chosen because
  `driver_equipment_permissions` is many-to-many by design — locking on
  every single revoke would strand a different, still-authorized driver).
- The 17:00 shift-end lock has no override/exception mechanism in the
  schema — implemented as literal lock-everyone, flagged above as
  something worth the owner confirming is truly intended.

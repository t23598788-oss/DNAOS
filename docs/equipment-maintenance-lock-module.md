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
| Telemetry ingestion (engine-running signal, VCC ≥ 13.5V stream) | **PLANNED — no code yet** | nothing implemented; needs an inbound endpoint once the hardware/SMS-gateway path is chosen |
| Engine-hours accumulation from telemetry | **PLANNED — no code yet** | `equipment_assets.total_engine_hours` column exists (defaults to 0) but nothing currently writes to it |
| Maintenance ticket generation at 250h intervals | **PLANNED — no code yet** | no `maintenance_tickets` table or engine exists |
| Auto-lock safety at +50h overdue | **PLANNED — no code yet** | depends on the two rows above |
| 17:00 shift-end auto-lock | **PLANNED — no code yet** | no scheduled job exists for this |
| Permission-revocation → actual hardware lock command | **NOT WIRED YET** | today, toggling a driver's permission off in Contact Settings only updates the LINE Rich Menu (`setDriverStartButtonRichMenu`) — it does **not** send a lock command to the box. Closing this gap requires the same SMS gateway/command-manual inputs listed above |

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

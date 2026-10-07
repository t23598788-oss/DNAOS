# control/runtime-control/

**หน้าที่:** a bounded Runtime Control Adapter for the four local
dev-runtime services DNA OS currently owns: Deadboard (`:3000`), the Lab /
Engineering Research Monitor UI (`:5177`), its research API (`:8787`), and
its compute API (`:8788`). Implements the Owner's explicit architecture:

```
DNA OS Control -> Runtime Control Adapter -> launchd -> Process -> Health/Evidence -> DNA OS
```

launchd remains the only real process supervisor/executor. This capability
never spawns, forks, daemonizes, or polls in the background — `cli.ts` is a
one-shot command that issues at most one `launchctl` mutation, waits
(bounded, max 10s) for it to settle, then reads back real facts:
`launchctl list` (launchd's own claim), `lsof` (the real listening PID —
independent of launchd's claim), and one HTTP probe (real runtime health).
launchd state and runtime health are recorded as two separate facts,
never collapsed into one — a service already loaded/running per launchd is
never reported healthy without a real, passing HTTP response.

**Duplicate Gate result before this capability was created:** searched
`software/registry-database/data/canonical/capabilities.jsonl` for
`runtime-control`/`process-control`/`service-control`/`supervisor`/
`process-manager`/`launchctl` by canonical_name and purpose text — zero
matches. No existing capability in this repo (`control/runtime-verification`
— post-COMPLETE evidence verification; `execution/deploy` — PLAN/GATE only,
never live-deploys; `execution/process-lock` — cross-process mutex
primitive; `control/command-router` — only `command.run_build` exists, no
service/restart/health concept) does this job.

**Input:** `ServiceId` (`deadboard | lab-ui | research-api | compute-api`)
+ `Action` (`start | stop | restart | health | status`)

**Output:** `OperationEvidence` — `service_id`, `launchd_label`,
`requested_action`, `port`, `pid_before`/`pid_after` (launchd's own claim),
`launchd_loaded_before`/`launchd_loaded_after`, `health_before`/
`health_after` (real HTTP probe, independent fact), `duplicate_check`
(real `lsof` listening PIDs on the port — more than one is always a
FAILED result), `timestamp_started`/`timestamp_completed`, `result`
(`SUCCESS | FAILED`), `failure_reason` (populated whenever `result` is
`FAILED`, never left null on failure).

Every operation call is appended as one line to
`control/runtime-control/data/operations.jsonl` — a real, durable,
append-only evidence log, never overwritten.

**Dependency ที่อนุญาต:** `./types.ts`, `./host-runtime.ts` (resolver.ts);
`./contract.ts`, `./types.ts` (cli.ts and any external caller).

**สิ่งที่ห้ามแตะ:**
- ห้ามเปลี่ยน `start`/`restart` ให้ report `SUCCESS` โดยไม่มีทั้ง PID จริงจาก
  launchd หลัง action **และ** HTTP health check ที่ผ่านจริง — ขาดอย่างใด
  อย่างหนึ่งคือ `FAILED` พร้อม `failure_reason` เสมอ
- ห้ามเพิ่ม service ที่ 5 โดยไม่ใช่คำสั่งชัดเจนจาก Owner — ขอบเขตของ
  capability นี้คือ 4 services ที่ Discovery ยืนยันแล้วเท่านั้น
- ห้ามให้ `duplicate_detected = true` ผ่านเป็น `SUCCESS`
- ห้ามแก้ business logic, Supabase configuration/data, หรือ Vercel
  production configuration จากไฟล์ใดในโฟลเดอร์นี้
- ห้ามสร้าง daemon/poll loop ที่รันค้างอยู่เบื้องหลัง — `cli.ts` ต้อง exit
  เสมอหลัง operation เสร็จ

**Usage:**
```bash
npx tsx control/runtime-control/cli.ts health all
npx tsx control/runtime-control/cli.ts restart lab-ui
npx tsx control/runtime-control/cli.ts start compute-api
```

**New LaunchAgent added as part of this capability (config only, no new
supervisor):** `~/Library/LaunchAgents/com.dnaos.dna-os-compute-api.plist`
— mirrors `com.dnaos.research-api.plist` exactly (same `KeepAlive`/
`RunAtLoad` pattern, same owning repository), for the `dna_os` compute API
on `:8788`, which Discovery confirmed had no launchd service at all before
this change.

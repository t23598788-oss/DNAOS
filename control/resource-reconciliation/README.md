# control/resource-reconciliation/

**หน้าที่:** system-wide resource reconciliation and safe-reset lifecycle. It
answers, for any artifact this machine holds: what it is, why it exists, who
made it, what replaced it, who still uses it, whether the runtime still uses it,
whether data or contracts still reference it, whether removal is reversible, and
whether cleanup is safe.

**นี่ไม่ใช่ระบบลบไฟล์.** ไม่มี `unlinkSync`, `rmSync`, `renameSync`,
`writeFileSync` หรือ `appendFileSync` ในโฟลเดอร์นี้แม้แต่จุดเดียว — asserted by
`tests/reconciliation-proof.ts`. It reads, it reconciles, it produces verdicts
and plans. Execution belongs to:

- `~/Desktop/dna-os-deadboard` `engines/storage/adapters/trashAdapter.ts` — the
  one mutation boundary for files
- `../service-reload/` → `../runtime-control/` — the one service-lifecycle
  authority

**Read paths it reuses (all pre-existing, none re-implemented):**

| question | read path |
|---|---|
| capability, consumers, dependencies, runtime, registry matches | `software/live-census#observeCensus` |
| resource_id / capability_id for a path | `control/realtime-change#resolvePath` |
| architecture claims | `control/system-read-paths#readBlueprintReferences` |
| registry rows | `software/registry-database#listResourceRows` |
| who created it | `git log --diff-filter=A --follow` |
| what replaced it | `git log -M --diff-filter=R`, `git ls-files -s` |
| who holds it open now | `control/machine-observation#findProcessesUnderPath` |
| is a service running replaced code | `control/service-reload#reloadRequiredFor` |

**Input:** a path, a commit, a database object name, or nothing (whole system).

**Output:** `contract.ts` — `buildLineage`, `detectSupersessions`,
`reconcileSystem`, `impactOfChange`, `decideVerdict`, `assessDatabaseObject`,
`planReset`, `verifyAfterMutation`, `machineWorkspaceState`.

**สิ่งที่ห้ามแตะ:**

- ห้าม export ฟังก์ชันที่ลบ/ย้าย/รีสตาร์ทอะไรก็ตาม
- ห้ามให้ `UNKNOWN` กลายเป็น `AUTO_TRASH` — unanswered condition แม้ข้อเดียว
  บังคับให้เป็น `UNRESOLVED`
- ห้ามให้ AI/LLM ตัดสิน — ทุกเงื่อนไขมาจากข้อเท็จจริงที่อ่านได้จริง
- ห้ามเพิ่มหลักฐาน supersession ที่อาศัยชื่อคล้ายกัน เวลาใกล้กัน หรือ
  directory เดียวกัน

## The database boundary, stated plainly

`database-safety.ts` never connects to Supabase, because
`connections/supabase/README.md` and the root boundary rule forbid a direct
database dependency between Infrastructure and Operational. It reads what the
operational repository declares in git — migrations, Edge Functions, cron
schedules, webhook handlers — and reports live reader/writer activity as
**UNPROVEN**. The gate can therefore refuse, and can never approve on its own.
Financial, payment, invoice, tax and document objects are BLOCK by default.

## Two false positives this design already caught

Both were real, both were found by running the rules against the live machine,
and both are now regression-checked:

1. **521 phantom stale blueprint references.** Blueprint targets are written as
   `path/file.ts:239`, sometimes `file.ts:17,:19,:39` or with a trailing comma.
   The first path cleaner stripped only `#symbol`, so every line-numbered
   reference failed `existsSync` and the whole architecture record read as
   stale. Real count: 2, both deliberate `imaginary.ts` fixtures.

2. **`AUTO_TRASH` on a file a security test drives by name.**
   `control/circuit-breaker/tests/__sandbox__/violation-enforced.ts` has zero
   importers — `kill-on-violation-proof.test.ts` passes `"violation-dryrun.ts"`
   as an argv string. The census answers "who imports this", which is the wrong
   question for anything invoked by name. `decide.ts` now searches for literal
   references and RETAINs on any hit.

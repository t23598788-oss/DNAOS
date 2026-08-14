# audit/ — NOT_YET_BUILT

Durable evidence for every Command and Event, scoped per Account —
generalizes the pattern already proven in `dna-os-deadboard`'s
`github_sync_log` table (one row per attempt, written before the caller is
told the result, success or failure).

**Responsibility:** once `../execution/command-lifecycle.ts`'s `evidenced`
stage is real, this module is where that evidence actually gets written.
Also the landing point for `../permissions/boundary.ts`'s
`BreakGlassRequest.audit_event_id` — every break-glass access must produce
a real, findable audit record here, not just a log line.

No storage exists yet. No command has ever reached the `evidenced` stage,
because no controller exists yet to produce one.

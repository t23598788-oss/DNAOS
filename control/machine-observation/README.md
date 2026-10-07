# control/machine-observation/ — what this Mac can be observed doing

**หน้าที่:** read real macOS evidence about live processes and real filesystem
changes, and turn only the evidenced parts into relationships.

**This layer decides nothing.** No interrupt, no pause, no command, no policy —
its contract exports none of those, and a test asserts that. It emits
observations, relationships, correlations and meaning records; a controller
elsewhere decides what to do with them.

**Input:** `ps -axo pid,ppid,user,lstart,args` (identity + lineage) and
`lsof -p <pid> -Fpftn` (mapped binary, cwd, open files, sockets), run per pid —
never a machine-wide sweep. Filesystem events come from
`../realtime-change/`'s observer.

**Output:** `ProcessObservation`, `ObservedRelationship` (directed, evidenced),
`CorrelationCandidate` (PROVEN / POSSIBLY_RELATED / UNKNOWN), `MeaningRecord`,
and a circuit graph.

**Dependency ที่อนุญาต:** `../realtime-change/`, `../system-read-paths/`,
`../../software/registry-database/` — public contracts only.

**สิ่งที่ห้ามแตะ:**
- ห้ามสรุปเจ้าของ application จากชื่อ process — membership คือ path fact จาก
  binary ที่ `lsof ftxt` รายงาน. Measured: two processes whose command line
  contained `Claude.app` were REJECTED because their mapped binary was
  `/bin/zsh`.
- ห้าม promote `POSSIBLY_RELATED` เป็น `PROVEN` โดยไม่มีหลักฐาน OS ใหม่ (a real
  descriptor on that path).
- ห้ามสร้าง `resource_id` ใหม่ — identity เดิมถูกนำมาใช้ตามเดิม แล้วเติมหลักฐานให้.
- ห้าม export อะไรที่สั่ง/หยุด process หรือ agent.
- ห้ามวาด edge บน UI ที่ไม่มี evidence — สิ่งที่พิสูจน์ไม่ได้ต้องปรากฏเป็น
  `UNRESOLVED` node ไม่ใช่หายไปเฉยๆ.

## The three verdicts

| verdict | requires |
|---|---|
| `PROVEN` | the process holds that exact path open (`lsof` fd) |
| `POSSIBLY_RELATED` | the path is under the process's observed cwd, no descriptor |
| `UNKNOWN` | nothing observed connects them |

`fs.watch` gives no writer identity and `lsof` is a snapshot: a process that
opened, wrote and closed a file before the snapshot leaves nothing to find.
That case is `UNKNOWN`, and naming a writer there would be inventing one.

## วิธีรัน

```
npx tsx control/machine-observation/tests/machine-observation-proof.test.ts
```

## Known limits

- No writer identity from the OS through these APIs. Attributing a write to a
  specific application needs EndpointSecurity/`fs_usage`-class evidence and the
  privileges that come with it.
- `lsof` is point-in-time. Short-lived descriptors are missed by definition.
- macOS resolves `/tmp` and `/var` through symlinks and `lsof` reports the
  resolved path; correlation resolves both sides before comparing (a literal
  comparison made a process that provably held a file look unrelated).

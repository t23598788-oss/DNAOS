# control/realtime-change/ — real filesystem changes, resolved and delivered

**หน้าที่:** observe real writes on this Mac, resolve what they touched against
registries that already exist, and tell the one execution that is provably
working there — no matter who did the writing (DNA OS agent, Claude Code,
Codex, a terminal, an editor, git, the Owner bypassing DNA OS entirely).

```
FILESYSTEM --OBSERVATION--> CHANGE_EVENT --REQUEST--> SYSTEM RESOLUTION
SYSTEM RESOLUTION --RESPONSE--> CHANGE_IMPACT_CONTEXT
CHANGE_IMPACT_CONTEXT --INTERRUPT + CONTEXT--> ACTIVE AGENT
ACTIVE AGENT --ACK--> DNA OS
```

**Input:** kernel filesystem events (`fs.watch`, FSEvents-backed on macOS) over
scopes derived from `control/work-coordination`'s held write locks and
`control/agent-host`'s active launches.
**Output:** `ChangeEvent` (raw OS facts), `ChangeImpactContext` (what was
proven), `InterruptSignal`, and whatever `AgentAck` the execution really wrote.

**Dependency ที่อนุญาต:** `../work-coordination/`, `../agent-host/`,
`../agent-gateway/`, `../system-read-paths/`, `../command-router/`,
`../../software/registry-database/` — all through their public contracts.

**สิ่งที่ห้ามแตะ:**
- ห้าม poll และห้าม walk ทั้ง repository.
- ห้ามใช้โมเดลตรวจจับการเปลี่ยนแปลง หรือเดาว่า process ไหนเขียนไฟล์.
- ห้าม hard-code รายชื่อโฟลเดอร์ถาวร — scope มาจาก runtime registry.
- ห้ามสร้าง identity ใหม่ให้ resource ที่มีอยู่แล้ว.
- ห้าม interrupt โดยไม่มีหลักฐาน `scopesOverlap` และห้ามให้ interrupt อนุญาต
  write/execution/policy อะไรทั้งสิ้น.
- ห้ามสมมติว่า agent หยุดแล้ว — ack ต้องอ่านจากสิ่งที่ agent เขียนจริง.
- ห้ามสร้าง event ปลอมเมื่อ observer ใช้งานไม่ได้ (`OBSERVATION_UNAVAILABLE`).

## Interrupt vs context — two channels, not one

| | means | file |
|---|---|---|
| INTERRUPT | "stop advancing the affected work until this is reconciled" | `<workspace>/.dna-os/interrupt.json` |
| CONTEXT | "this resource changed; here is what is proven about it" | `<workspace>/.dna-os/change-context.json` |
| ACK | what the execution says it did | `<workspace>/.dna-os/ack.json` |

A signal (SIGSTOP) would freeze a process wherever it happened to be — mid-write,
holding a lock. The inbox lets the execution notice at ITS OWN next safe
boundary and report the state it stopped in.

## Files

| ไฟล์ | หน้าที่ |
|---|---|
| `types.ts` | `ChangeEvent` (raw OS facts only), `ChangeImpactContext`, `InterruptSignal`, `AgentAck` |
| `observer.ts` | the scoped producer; scope from write locks + active launches |
| `path-resolution.ts` | path → capability (router registry) · path → resource (registry-database `source_location`) |
| `impact.ts` | impact context + the `scopesOverlap` proof that decides who may be interrupted |
| `interrupt.ts` | the two delivery channels and the ack reader |
| `circuit-view.ts` | five directed edges for the UI |
| `tests/realtime-change-proof.test.ts` | external write, resolution, no-overlap-no-interrupt, unavailable observer |

## Known limits

- `fs.watch` reports a path and a coarse `rename`/`change`. macOS gives no
  writer identity through this API, so `ChangeEvent.source` names the OBSERVER,
  never a guessed author.
- Watch scopes are captured when the observer starts. New write locks taken
  afterwards are not watched until it is restarted.
- `findResourceBySourceLocation` is OPTIONAL on `RegistryStore` and implemented
  only in `persistent-file-store`. Other adapters report the lookup as
  unavailable rather than inventing an identity.

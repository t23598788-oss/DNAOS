# ai/sensor-analysis-sandbox/ — the first DNA OS AI sandbox

**หน้าที่:** run the local `mlx-community/Qwen3-4B-Instruct-2507-4bit` over
`dna_os_sensor` telemetry, one way only:

```
dna_os_sensor_reader → FIXED INPUT CONTRACT → QWEN SANDBOX → STRUCTURED OUTPUT CONTRACT
```

Every arrow points forward. There is no return arrow, and adding one is the
thing this folder exists to prevent.

**Input:** `public.dna_os_sensor_events` / `public.dna_os_sensor_pattern`
through the **read-only** role `dna_os_sensor_reader`, projected down to the
allow-list in `./input-contract.ts`.

**Output:** `SandboxOutput` (`./output-contract.ts`) — machine-readable, or a
refusal listing exactly why.

**Dependency ที่อนุญาต:** none outside this folder. It reads the sensor over
HTTP with a read-only role and imports no other capability.

**สิ่งที่ห้ามแตะ:**
- ห้ามให้โมเดลได้ credential ใดๆ — `./run-sandbox.sh` launches with `env -i`.
- ห้ามให้โมเดลเข้าถึง repo/network — `./sandbox-profile.sb` denies both at the
  kernel, on every run.
- ห้าม eval/exec ผลลัพธ์ของโมเดล ที่ไหนก็ตาม.
- ห้ามส่ง writer JWT หรือ service_role มาที่โฟลเดอร์นี้.
- ห้ามผ่อน validator เพื่อให้ผลลัพธ์ผ่าน — a rejected analysis is a real result.

## How the boundary is actually enforced

| Claim | Enforced by | Measured by |
|---|---|---|
| No credentials | `env -i` in `run-sandbox.sh` | `--print-environment` + `tests/sandbox-proof.test.ts` |
| No network | `(deny network*)` + `HF_HUB_OFFLINE=1` | the model still runs with both in force |
| No repo access | `(deny file-read*/file-write* (subpath <repo>))` | same run |
| Sees only its input | fresh sandbox dir holding one file, cwd set to it | test asserts the dir holds exactly one file |
| Cannot write to DNA OS | no writer credential, no ingest call, no network | sensor row count unchanged across every run |
| Cannot invent facts | `validateSandboxOutput` cross-checks every id and count against the input | forged-output case in the test |

The prompt asks the model not to fabricate. The **validator** is what makes
fabrication fail. Those are not the same kind of guarantee, and only the second
one is relied on.

## ไฟล์ในโฟลเดอร์นี้

| ไฟล์ | ประเภท | หน้าที่ |
|---|---|---|
| `input-contract.ts` | contract | the allow-list of fields the model may see |
| `output-contract.ts` | contract + guard | the output shape, and the validator that rejects fabrication |
| `analyze.ts` | source | the one-way pipeline: read → project → run → validate |
| `sandbox-runner.py` | source | the only file that loads the model |
| `run-sandbox.sh` | source | the launch boundary (`env -i` + `sandbox-exec`) |
| `sandbox-profile.sb` | policy | kernel denials applied to every run |
| `contract.ts` | contract | the only file a caller outside this folder may import |
| `tests/sandbox-proof.test.ts` | test | re-takes all five proofs offline |
| `tests/fixtures/*.json` | fixture | real sensor rows; `adversarial-injection.json` is synthetic and labelled |

## วิธีรัน

```
# live, against the read-only sensor role
DNA_OS_SENSOR_URL=... DNA_OS_SENSOR_ANON_KEY=... DNA_OS_SENSOR_READER_JWT=... \
  npx tsx ai/sensor-analysis-sandbox/analyze.ts ALL /tmp/dna-os-sandbox

# offline proofs (no network, no credentials needed)
npx tsx ai/sensor-analysis-sandbox/tests/sandbox-proof.test.ts
```

## NOT_YET_BUILT

- No second model, no owner AI, no conversation surface — out of scope this
  round, deliberately.
- The sandbox is invoked by hand. Nothing schedules it, and nothing consumes
  its output automatically; wiring an automatic consumer would be the first
  place a return path could appear, so it is left out until that is designed.
- `sandbox-profile.sb` hard-codes the repository path. It is correct on this
  machine and would need a generated profile to be correct anywhere else.

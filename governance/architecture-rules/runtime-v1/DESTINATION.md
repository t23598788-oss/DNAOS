# DNA OS Runtime V1 — Destination architecture

**role:** DESTINATION — end-state mechanisms. Not a mandate to recreate the example Go tree.
**not executable:** this file is documentation. TypeScript contracts and tests remain CURRENT law.
**Go / folder examples:** illustrative unless a CURRENT contract requires them.

Source DOCX is retained under `./source/`.


## หลักสถาปัตยกรรมที่ควรล็อกตั้งแต่ต้น

แนวคิดที่เฮียวางมา ทำได้จริงและควรเดินต่อ แต่ต้องแยกคำว่า “เราเป็นเจ้าของระบบ” ออกจาก “เราเขียนทุก primitive ของโลกขึ้นมาใหม่” ให้ชัด

DNA OS ควรเป็นเจ้าของ Control Plane, Runtime Contract, Permission, Routing, Registry, Scheduler, Worker Lifecycle, Artifact Registry, Deployment และ Observability เอง ส่วน primitive ด้านล่างใช้มาตรฐานที่พิสูจน์มาแล้ว เช่น Linux, PostgreSQL, Git, TLS และ cryptographic algorithms มาตรฐาน ไม่ควรเขียน database engine, TLS หรือ Git protocol ใหม่ เพราะนั่นไม่ได้เพิ่มอำนาจควบคุม architecture แต่เพิ่ม failure surface

Linux cgroup v2 ถูกออกแบบมาโดยตรงสำหรับการจัด process เป็น hierarchy และควบคุมการใช้ CPU, memory, I/O และทรัพยากรอื่นจากระดับ kernel ดังนั้น DNA OS สามารถควบคุม worker โดยตรงโดยไม่ต้องมี Kubernetes หรือ container platform เป็นตัวกลางได้. [1]


## ภาพที่ผมแนะนำให้ล็อกเป็น DNA_OS_RUNTIME_V1 คือ:


```
┌──────────────────────┐                         │   Client / App / UI  │                         │ Browser / External   │                         └──────────┬───────────┘                                    │ HTTPS                                    ▼┌─────────────────────────────────────────────────────────┐│                     DNA OS CORE                         ││                                                         ││  Ingress                                                ││     ↓                                                   ││  Identity / Session                                     ││     ↓                                                   ││  Permission Engine                                      ││     ↓                                                   ││  Command Router                                         ││     ├───────────────┬────────────────┬────────────────┐  ││     │               │                │                │  ││  Core Handler    Event Queue       Scheduler       Registry││     │               │                │                │  ││     └───────────────┴────────┬───────┴────────────────┘  ││                              │                           ││                         Event / State                    │└──────────────────────────────┼───────────────────────────┘                               │              ┌────────────────┼────────────────┐              │                │                │              ▼                ▼                ▼       ┌────────────┐    ┌────────────┐   ┌─────────────┐       │ Server Node│    │ Mac Agent  │   │ Other Agent │       │   Agent    │    │            │   │ / Device    │       └─────┬──────┘    └──────┬─────┘   └──────┬──────┘             │                  │                │      start/stop worker     Chrome/files      capability             │              local apps        executor             ▼    ┌─────────────────┐    │ Ephemeral Worker│    │ AI / build/test │    │ files / reports │    └─────────────────┘Persistent Plane────────────────────────────────────PostgreSQL      = authority/state/jobsDNA Blob Store  = artifacts/files/log chunksGit Server      = source/versionBackup Nodes    = replicated durable copy
```

จุดสำคัญที่สุดคือ Core ไม่ควรแตกเป็น microservice สิบกว่าตัวตั้งแต่วันแรก ให้เป็น “modular monolith” หนึ่ง process ก่อน: Identity, Policy, Registry, Router, Scheduler, Queue, Webhook และ Health อยู่ใน binary เดียวกัน แต่แยก package/interface ภายในชัดเจน ส่วนสิ่งที่กิน CPU/RAM หรือเกี่ยวข้องกับเครื่องปลายทางค่อยแยกเป็น worker/agent

ดังนั้นเส้นทางปกติจะเหลือ:

request  ↓DNA Core  ↓authenticate  ↓authorize  ↓resolve command  ↓select executor  ↓execute  ↓persist result  ↓response

ไม่ควรมี service mesh ระหว่างโมดูล Core เพราะมันเพิ่ม network hop โดยไม่จำเป็น

มีข้อแก้ไขสำคัญจากภาพเดิมหนึ่งเรื่อง: process scale-to-zero กับ VM cost scale-to-zero ไม่ใช่เรื่องเดียวกัน

ถ้าเฮียเช่า VM อยู่แล้ว:

Worker process = OFF

จะทำให้ CPU idle แต่ไม่ได้แปลว่า provider หยุดคิดค่า VM เสมอไป

ถ้าต้องการ:

ไม่มีงาน→ ไม่มีเครื่อง worker→ ไม่จ่าย compute worker

DNA OS จำเป็นต้องมีชั้นเล็กมากชื่อประมาณ:

Infrastructure Driver

เช่น:


```
type InfrastructureDriver interface {    StartNode(ctx context.Context, pool string) error    StopNode(ctx context.Context, nodeID string) error    NodeState(ctx context.Context, nodeID string) (NodeState, error)}
```

แล้ว provider-specific code จำกัดอยู่ตรงนี้เท่านั้น:

drivers/├── baremetal/├── provider_a/├── provider_b/└── local/

Business Logic ไม่เคยเห็นชื่อ provider

Scheduler   ↓EnsureCapacity("ai-large")   ↓Infrastructure Driver   ↓start machine

จึงยังรักษาหลัก:

ผู้ให้บริการเป็นเครื่องรัน ไม่ใช่เจ้าของ architecture

ได้ครบ


## โครงสร้างโปรแกรม ไฟล์ และ runtime

ผมแนะนำให้ Core/Node substrate เขียนด้วย Go และเปิดให้ business workload ใช้ภาษาอะไรก็ได้ผ่าน Runtime Contract เดียวกัน เช่น Node.js/TypeScript, Python หรือ binary อื่น เหตุผลคือชั้น Core/Agent ต้องทำ network, TLS, process lifecycle, signal, filesystem และ Linux resource control โดยตรง ขณะที่ workload เดิมไม่จำเป็นต้อง rewrite ทั้งหมด Go standard library มี TLS implementation และ X.509 primitives อยู่แล้ว รวมถึง TLS 1.3 ตามมาตรฐานที่ใช้เป็น transport layer ได้โดยไม่ต้องสร้าง cryptography protocol เอง. [2]

โครง repo ควรประมาณนี้:


```
dna-os/│├── cmd/│   ├── dna-core/│   │   └── main.go│   ││   ├── dna-node/│   │   └── main.go│   ││   ├── dna-blobd/│   │   └── main.go│   ││   ├── dna-git-gateway/│   │   └── main.go│   ││   └── dnactl/│       └── main.go│├── internal/│   ├── ingress/│   ├── identity/│   ├── session/│   ├── policy/│   ├── registry/│   ├── router/│   ├── scheduler/│   ├── queue/│   ├── events/│   ├── webhook/│   ├── runtime/│   ├── nodecontrol/│   ├── artifact/│   ├── release/│   ├── deploy/│   ├── secrets/│   ├── health/│   ├── telemetry/│   ├── database/│   └── infra/│├── contracts/│   └── v1/│       ├── command.schema.json│       ├── result.schema.json│       ├── event.schema.json│       ├── work-order.schema.json│       ├── node.schema.json│       ├── capability.schema.json│       ├── artifact.schema.json│       └── release.schema.json│├── sdk/│   ├── go/│   ├── typescript/│   └── python/│├── drivers/│   ├── local/│   ├── baremetal/│   └── cloud/│├── db/│   ├── migrations/│   ├── schema/│   └── seeds/│├── runtime/│   ├── sandbox/│   ├── executor/│   ├── cgroup/│   └── process/│├── deploy/│   ├── systemd/│   ├── bootstrap/│   └── configs/│├── scripts/├── tests/│   ├── integration/│   ├── failover/│   ├── security/│   └── load/│└── docs/    ├── runtime-v1.md    ├── protocol-v1.md    ├── permission-v1.md    ├── failover.md    └── disaster-recovery.md
```

บนเครื่องจริงไม่ควรเอา source code ปะปนกับ runtime:

/etc/dna/├── core.toml├── node.toml├── trust/│   ├── node-ca.pem│   └── release-public-key.pem└── secrets/    └── .../opt/dna/├── releases/│   ├── rel_01ABC.../│   ├── rel_01ABD.../│   └── ...└── current -> releases/rel_01ABD.../var/lib/dna/├── blobs/├── cache/├── work/├── git/├── spool/└── state//run/dna/├── core.sock├── node.sock└── core.pid


## Release แต่ละตัวต้อง immutable:

rel_01ABD/├── manifest.json├── manifest.sig├── bin/│   ├── dna-core│   ├── dna-node│   └── dna-blobd├── contracts/└── migrations/

manifest.json:

{  "runtime": "DNA_OS_RUNTIME_V1",  "release_id": "rel_01ABD",  "commit": "d90c...",  "created_at": "2026-09-11T00:00:00Z",  "platform": "linux-amd64",  "files": {    "bin/dna-core": "sha256:...",    "bin/dna-node": "sha256:..."  }}

Node ดาวน์โหลด release ไป staging ก่อน ตรวจ hash และ signature แล้วค่อย:

/opt/dna/currentold:→ releases/rel_Anew:→ releases/rel_B

จากนั้น restart และ health check ถ้าไม่ผ่านก็ชี้กลับ rel_A

ส่วน database migration ห้ามคิดแบบ “binary rollback = database rollback” เพราะ destructive migration ย้อนกลับอัตโนมัติอาจไม่ปลอดภัย ควรใช้รูปแบบ:

expand schema→ deploy compatible code→ migrate data→ verify→ contract old schema


## Process model ที่ควรใช้จริง

24/7────────────────────────dna-coredna-nodepostgresdna-blobdoptional / event-driven────────────────────────ai workerfile workerbuild workertest workerreport workerautomation workerbrowser/local agent action

dna-node คือหัวใจของ execution plane ไม่ใช่ worker แต่เป็น supervisor ของเครื่อง

DNA Core   │   │ WorkOrder   ▼dna-node   │   ├── verify command   ├── fetch artifact   ├── create work directory   ├── apply resource limits   ├── inject scoped secrets   ├── start process   ├── monitor   ├── collect stdout/stderr/result   └── destroy runtime

Linux cgroup v2 รองรับ hierarchy และ resource limits โดยตรง และ kernel ระบุว่าควรจัด workload เข้า cgroup ตามโครงสร้างตั้งแต่เริ่ม process แทนการย้ายไปมาบ่อย ๆ. [1]

โครง cgroup:

/dna.slice├── core/├── system/└── jobs/    ├── job_01ABC/    ├── job_01ABD/    └── job_01ABE/

แต่ต้องจำว่า cgroup คือ resource control ไม่ใช่ sandbox security ทั้งหมด ถ้า build หรือ worker สามารถรัน code ได้ ต้องเพิ่ม user isolation, filesystem restrictions และ network restrictions ด้วย Linux Landlock ถูกออกแบบมาให้ process ลดสิทธิ์ filesystem/network ของตัวเองและลูกของมัน และ kernel documentation อธิบายโดยตรงว่าใช้สร้าง security sandbox เพื่อจำกัดผลกระทบจาก bug หรือ malicious behavior ได้. [3]

ดังนั้น build worker ควรเป็น:

cgroup+ dedicated uid+ no_new_privs+ Landlock+ restricted filesystem+ restricted outbound network+ temporary workdir

ไม่ใช่แค่:

exec("npm build")

บน Core โดยตรง


## Protocol, API, Registry, Auth และ Permission

หัวใจของ DNA OS ไม่ควรเป็น URL แต่เป็น Command Contract

ทุกสิ่งที่เข้าระบบถูกแปลงเป็น envelope แบบเดียว:

{  "protocol": "dna.v1",  "command_id": "cmd_01J...",  "request_id": "req_01J...",  "actor": {    "type": "user",    "id": "usr_..."  },  "action": "document.generate",  "resource": "tenant/acme/report/2026-09",  "target": {    "mode": "auto"  },  "input": {},  "idempotency_key": "client-value",  "deadline": "2026-09-11T10:30:00Z"}

Router ไม่ควรรู้ว่า function อยู่ Railway, VM, Mac หรือ Python

มันรู้แค่:

actionrequired capabilitypermissionavailable executorsexecution policy

ตัวอย่าง Registry:

node_id: mac_001region: th-bkkstatus: READYcapabilities:- browser.chrome- filesystem.local- app.excel- input.mouse- input.keyboard

อีกเครื่อง:

node_id: compute_004region: sgcapabilities:- ai.gpu- build.node- build.go- file.pdf

แล้ว command:

action = browser.navigaterequires = browser.chrome

Router ก็เลือก mac_001

ส่วน:

action = build.releaserequires = build.go

ก็เลือก compute node

เส้นทาง decision:

Authenticate     ↓Resolve actor     ↓Authorize(action, resource)     ↓Resolve command contract     ↓Resolve capability     ↓Find READY executor     ↓Dispatch / Queue

API ภายนอกไม่จำเป็นต้องมี route เป็นร้อย endpoint ตั้งแต่ต้น:

Route

หน้าที่

POST /v1/auth/session

login/session

DELETE /v1/auth/session

logout/revoke

POST /v1/commands

ส่งคำสั่งกลาง

GET /v1/commands/{id}

ดูสถานะ

GET /v1/commands/{id}/result

รับผล

POST /v1/webhooks/{source}/{id}

webhook ingress

GET /v1/events/stream

realtime client stream

POST /v1/nodes/enroll

enroll agent/node

POST /v1/jobs/{id}/complete

result จาก worker

POST /v1/artifacts

artifact ingest

POST /v1/releases

register release

POST /v1/deployments

deploy release

GET /health/live

process alive

GET /health/ready

dependency ready

Core สามารถเปิด public listener กับ node-control listener แยกกัน:

PUBLIC443HTTPSNODE CONTROL9443mTLSLOCAL IPC/run/dna/*.sockUnix Domain Socket


## สำหรับ auth ผมไม่แนะนำสร้าง cryptography algorithm เอง

User password:

password  ↓Argon2id  ↓password_hash

RFC 9106 ระบุ Argon2 สำหรับ password hashing และกำหนด Argon2id เป็น variant หลักที่ implementation ต้องรองรับ พร้อม salt เฉพาะต่อ password. [4]

Session ใช้ opaque random token:

client sees:dna_sess_xxxxxxxxxxxxxxxxxdatabase stores:SHA256(token)user_idexpires_atrevoked_atdevice_id

อย่าเอา raw session token ลง database

Agent/node ใช้ identity อีกชนิด:

bootstrap enrollment token        ↓ one timegenerate node identity        ↓node certificate / key        ↓future connection = mTLS

TLS 1.3 เป็น protocol มาตรฐานสำหรับ encrypted transport และ Ed25519/EdDSA มี RFC specification โดยตรง จึงควรใช้ library implementation ตามมาตรฐาน แทนการคิด signature algorithm เอง. [5]

Permission model ผมแนะนำเริ่มจาก:

Subject   ↓Role   ↓Permission   ↓Resource Scope

เช่น:

subject:usr_001role:finance_managerpermissions:invoice.readinvoice.approvereport.generatescope:tenant/dna/*


## สำหรับ Local Agent:

permission:agent.executescope:device/mac_hear/*

และ command browser:

browser.navigatebrowser.readbrowser.download

ควรแยกสิทธิ์ออกจาก:

input.keyboardfilesystem.writeshell.execute

อย่างเด็ดขาด

Policy API ภายในมี interface เดียว:


```
type PolicyEngine interface {    Authorize(        ctx context.Context,        subject Subject,        action string,        resource string,        attrs map[string]any,    ) (Decision, error)}
```

แล้ว default deny

ไม่มี rule= DENYexplicit allow= ALLOWexplicit deny= DENY

อย่าเริ่มด้วย policy scripting language ของตัวเอง เพราะจะกลายเป็นภาษาโปรแกรมอีกภาษา ให้เริ่มจาก permission rows + resource pattern + built-in conditions ก่อน

ตัว Router สามารถเรียบง่ายประมาณนี้:


```
type Router struct {    policy   PolicyEngine    registry Registry    queue    JobQueue    handlers map[string]Handler}func (r *Router) Dispatch(ctx context.Context, cmd Command) (Result, error) {    decision, err := r.policy.Authorize(        ctx,        cmd.Actor,        cmd.Action,        cmd.Resource,        cmd.Attributes,    )    if err != nil {        return Result{}, err    }    if !decision.Allowed {        return Result{}, ErrForbidden    }    contract, ok := LookupContract(cmd.Action)    if !ok {        return Result{}, ErrUnknownCommand    }    switch contract.Execution {    case ExecutionCore:        h, ok := r.handlers[cmd.Action]        if !ok {            return Result{}, ErrNoHandler        }        return h.Execute(ctx, cmd)    case ExecutionWorker, ExecutionAgent:        job, err := r.queue.Enqueue(ctx, JobFromCommand(cmd, contract))        if err != nil {            return Result{}, err        }        return Result{            CommandID: cmd.ID,            Status:    "accepted",            JobID:     job.ID,        }, nil    default:        return Result{}, ErrInvalidExecutionMode    }}
```

นี่คือจุดที่ architecture กลายเป็นของ DNA OS จริง ๆ เพราะ external app ทุกตัวไม่ต้องรู้ topology

Client:"ทำ X"DNA OS:X ต้อง capability YY อยู่ node Zpermission ผ่าน→ ส่ง


## Event Queue, Worker, Data, Artifact และ Git ภายใน

ฐานข้อมูลกลางผมแนะนำ PostgreSQL 18.x; ณ วันที่ 11 กันยายน 2026 รุ่น stable patch ที่ประกาศล่าสุดคือ PostgreSQL 18.6 เมื่อ 13 สิงหาคม 2026. [6]

ในช่วงแรก ไม่ต้องติดตั้ง RabbitMQ/Kafka/NATS ก็ได้ เพราะ volume ของ DNA OS ระยะแรกสามารถใช้ PostgreSQL เป็นทั้ง durable state และ durable job queue แล้วใช้ LISTEN/NOTIFY เป็นเพียงสัญญาณปลุก worker

PostgreSQL ระบุเองว่า FOR UPDATE ... SKIP LOCKED เหมาะกับกรณี multiple consumers ของ queue-like table เพราะช่วยหลีกเลี่ยง lock contention ระหว่าง consumer. [7]


## Job state:

QUEUED   ↓LEASED   ↓RUNNING   ├── SUCCEEDED   ├── RETRY_WAIT   ├── FAILED   └── DEAD


## ตารางหลัก:


```
CREATE TABLE jobs (    id              uuid PRIMARY KEY,    command_id      uuid NOT NULL,    capability      text NOT NULL,    payload         jsonb NOT NULL,    status          text NOT NULL,    priority        integer NOT NULL DEFAULT 0,    run_at          timestamptz NOT NULL DEFAULT now(),    lease_owner     text,    lease_until     timestamptz,    attempt         integer NOT NULL DEFAULT 0,    max_attempts    integer NOT NULL DEFAULT 3,    idempotency_key text,    created_at      timestamptz NOT NULL DEFAULT now(),    updated_at      timestamptz NOT NULL DEFAULT now());CREATE INDEX jobs_ready_idxON jobs (priority DESC, run_at)WHERE status IN ('QUEUED', 'RETRY_WAIT');
```


## Worker lease:


```
WITH candidate AS (    SELECT id    FROM jobs    WHERE status IN ('QUEUED', 'RETRY_WAIT')      AND run_at <= now()      AND (          lease_until IS NULL          OR lease_until < now()      )    ORDER BY priority DESC, run_at ASC    FOR UPDATE SKIP LOCKED    LIMIT 1)UPDATE jobs jSET    status      = 'LEASED',    lease_owner = $1,    lease_until = now() + interval '60 seconds',    attempt     = attempt + 1,    updated_at  = now()FROM candidateWHERE j.id = candidate.idRETURNING j.*;
```

60 seconds ตรงนี้เป็น tunable runtime policy ไม่ใช่ contract ถาวร


## หลักที่ต้องล็อกคือ:

Job execution semantics= at-least-once

ไม่ควรประกาศว่า exactly-once

ถ้า worker ตายหลังทำงานเสร็จแต่ก่อนบันทึก success:

lease expires→ another worker may execute again

ดังนั้น operation ที่มี side effect ต้องมี:

idempotency_key

เช่น:

invoice.issue:INV-2026-001

ถ้า key เดิมถูก commit แล้ว:

do not execute again→ return existing result

LISTEN/NOTIFY ใช้เพื่อ:

new job committed→ NOTIFY dna_jobs→ sleeping dispatcher wakes immediately

แต่ห้ามใช้ notification เป็น source of truth เพราะ PostgreSQL documentation ระบุทั้ง semantics ของ LISTEN/NOTIFY และ race ที่ต้องจัดการเมื่อตั้ง listener ใหม่ ดังนั้น durable truth ต้องอยู่ใน table; notification เป็นเพียง wake-up signal. [8]

Flow ที่ถูกต้อง:

INSERT jobCOMMITNOTIFY   ↓worker wakes   ↓SELECT durable table

ไม่ใช่:

notification หาย= job หาย

Scheduler

Scheduled job:

schedules├── schedule_id├── command_template├── next_run_at├── timezone├── enabled└── revision

Core A และ Core B อาจเปิดพร้อมกัน แต่ให้มี scheduler leader ตัวเดียวโดยใช้ PostgreSQL advisory lock:

SELECT pg_try_advisory_lock(987654321);

PostgreSQL advisory locks ถูกออกแบบให้ application กำหนดความหมายของ lock เอง และ session-level advisory lock จะถูกปล่อยเมื่อ session จบ ซึ่งเหมาะกับ scheduler leadership แบบไม่ต้องมี Redis lock อีกชั้น. [9]

CORE_Aholds scheduler lock→ creates due jobsCORE_A dies→ DB connection disappears→ lock disappears→ CORE_B acquires

Artifact และ file storage ของเราเอง

ไม่ต้องใช้ S3 ตั้งแต่วันแรก

สร้าง dna-blobd เป็น content-addressable immutable store:

PUT blob   ↓calculate SHA-256   ↓store temp   ↓fsync   ↓atomic rename   ↓register metadata

Disk layout:

/var/lib/dna/blobs/└── sha256/    ├── ab/    │   └── cd/    │       └── abcdef012345...    └── ef/

API:

POST /v1/blobsGET  /v1/blobs/{sha256}HEAD /v1/blobs/{sha256}

metadata:

artifacts──────────────artifact_idsha256sizemedia_typecreated_atcreated_byretention_classblob_locations──────────────sha256node_idstateverified_at

ข้อมูล mutable อย่าแก้ blob เดิม

ใช้ version manifest:

file_idversion 1 → blob AAAversion 2 → blob BBBversion 3 → blob CCC

ทำให้ replication, rollback และ deduplication ง่ายมาก

ระดับ durability:

Build cache→ 1 copy ได้Runtime release→ ≥ 2 copiesBusiness document→ ≥ 2 copies + backupCritical database backup→ separate failure domain

Git ภายใน

ไม่ต้องเขียน Git object protocol ใหม่

ติดตั้ง Git เองและใช้ bare repository:

/var/lib/dna/git/├── dna-core.git├── business-app.git└── agents.git

Git receive-pack รองรับการรับ push ไปยัง remote repository และมี pre-receive / post-receive hooks โดยตรง ซึ่งเหมาะมากสำหรับต่อ push event เข้า DNA Core. [10]

Flow:

Developer   ↓ git pushDNA Git Server   ↓ post-receiveDNA Core   ↓EVENT git.push   ↓Build Job   ↓Build Worker   ↓test   ↓artifact   ↓DNA Blob Store   ↓Release Registry   ↓Deployment

post-receive:

#!/bin/shwhile read oldrev newrev refnamedo  /opt/dna/current/bin/dnactl event emit git.push \    --repo "$PWD" \    --old "$oldrev" \    --new "$newrev" \    --ref "$refname"done

Git documentation ระบุว่า post-receive ถูกเรียกหลัง ref update สำเร็จและส่งค่า old/new/ref มาให้ hook โดยตรง. [11]

ดังนั้น GitHub เหลือเป็น optional mirror ได้จริง:

Primary:DNA GitOptional:GitHub mirror / offsite copy

และ source กับ runtime artifact แยกชัด:

Git= source historyBlob Store= build outputsRelease Registry= deployable versionsPostgres= metadata/state


## Failover, Deployment และ Multi-Region

จุดที่ควรออกแบบให้ Core “ตายแล้วเกิดใหม่ได้ทันที” คือ Core ต้องแทบไม่มี durable state อยู่ local disk

CORE NODElocal:- binary- config- cert- temporary cacheauthoritative:- PostgreSQL- Blob Store

ดังนั้น:

CORE_A diesClient / Agent    ↓ reconnectCORE_B    ↓same databasesame registrysame releasesame contracts

Core A และ Core B สามารถรับ HTTP พร้อมกันได้ ไม่จำเป็นต้อง active/passive ทั้งระบบ

Core A ─┐        ├── PostgreSQLCore B ─┘

งาน queue ก็ไม่ชนกันเพราะ lease ผ่าน database

Scheduler leadership ใช้ advisory lock

จึงไม่จำเป็นต้องเขียน distributed consensus protocol สำหรับ Core V1

แต่ database เป็นอีกเรื่องหนึ่ง

ถ้า PostgreSQL primary ตาย ต้องมี standby และ fencing ที่ถูกต้อง PostgreSQL documentation เตือนโดยตรงว่าเมื่อ standby ถูก promote แล้ว ต้องมีกลไกป้องกันไม่ให้ primary เก่ากลับขึ้นมาแล้วคิดว่าตัวเองยังเป็น primary เพราะสถานการณ์สอง primary สามารถนำไปสู่ data loss ได้; เอกสารเรียกกลไกนี้ว่า STONITH/fencing. [12]

ภาพ database:


```
┌──────────────┐             │ PG PRIMARY A │             └──────┬───────┘                    │ WAL                    ▼             ┌──────────────┐             │ PG STANDBY B │             └──────────────┘                  +             backup/WAL archive
```

PostgreSQL รองรับ streaming replication โดย standby รับ WAL จาก primary อย่างต่อเนื่อง และ standby สามารถ promote เป็น primary ได้. [13]

ผมไม่แนะนำให้ DNA OS รุ่นแรกเขียน “auto DB failover” แบบง่าย ๆ ว่า:

ping primary ไม่ได้→ promote standby

เพราะ network partition:

A sees B downB sees A downA thinks PRIMARYB promotes itself= split brain

ที่ถูกต้องคือ:

detect→ establish quorum/witness→ fence old primary→ promote standby→ redirect writers→ rebuild standby

PostgreSQL เองระบุว่าระบบ software สำหรับตรวจ failure และสั่ง failover ต้องจัดการภายนอก PostgreSQL และแนะนำให้มีขั้นตอนบริหารที่ทดสอบจริง. [12]

ดังนั้น roadmap ที่ปลอดภัยคือ:

V1Core failover = automaticDB failover   = controlled/manualV2DB detection  = automaticDB promotion  = guardedV3fencing + witness/quorum= fully automatic

ดีกว่าเขียน failover อัตโนมัติที่ผิด

Region

อนาคต:

Thailand├── Core TH-1├── Core TH-2├── Worker pool└── Blob replicaSingapore├── Core SG-1├── Worker pool├── Blob replica└── DB disaster standbyEurope├── Core EU└── Worker poolUS├── Core US└── Worker pool

ทั้งหมดรัน:

DNA_OS_RUNTIME_V1DNA_PROTOCOL_V1

ไม่ใช่:

Thai backendSingapore backendEU backendUS backend

Registry แค่มี:

{  "node_id": "node_sg_004",  "region": "sg",  "capabilities": [    "ai.large",    "pdf.process"  ]}

Router จึงสามารถตัดสินจาก:

capabilityregionlatencypermissiondata residencycurrent loadcost policy

โดยไม่เปลี่ยน business code

สำหรับฐานข้อมูลข้าม region ต้องระวัง synchronous replication เพราะ PostgreSQL ระบุชัดว่าการรอ synchronous standby เพิ่ม transaction response time อย่างน้อยตาม network round-trip time. [13]

ดังนั้น topology ระยะแรกที่สมเหตุผลกว่าคือ:

ThailandPRIMARY   │   ├── nearby synchronous standby   │   └──── asynchronous DR                ↓            Singapore

แทน:

Thailand PRIMARY   ↕ synchronous every commitSingapore

ถ้าระยะทางทำให้ latency สูง


## Deployment failover


## Release ไม่ผูกกับ node:

Release:rel_xyzNodes:TH_CORE_ATH_CORE_BSG_CORE_A

deployment:

rel_xyz   ↓stage CORE_B   ↓verify signature   ↓start   ↓/health/ready   ↓READY   ↓shift traffic

ถ้า fail:

current → previous releaserestart

ตัว Node Agent ต้องรายงาน:

{  "node_id": "core_th_b",  "release": "rel_xyz",  "process": "running",  "live": true,  "ready": true,  "db": "reachable",  "disk_free": 81234567890}

Health ต้องแยก:

LIVE= process ยังอยู่READY= พร้อมรับงานจริง

เพราะ process อาจยังอยู่แต่ database ขาด, migration ไม่ครบ หรือ artifact store ใช้งานไม่ได้


## ระบบเต็มเมื่อประกอบทุกชิ้นเข้าด้วยกัน

สุดท้าย DNA OS จะไม่ได้เป็น “server ที่มี API อยู่ชุดหนึ่ง” แต่เป็น control plane ของ resources

เส้นทาง request ปกติ:

CLIENT  │  │ POST /v1/commands  ▼DNA CORE  │  ├─ Identity  ├─ Permission  ├─ Contract validation  └─ Router       │       ├──────── Core operation       │       ├──────── Durable job       │       └──────── Local agent

งาน event:

Webhook / Schedule / Git Push / User                  │                  ▼              DNA Core                  │              Event Store                  │               Job Queue                  │            capability lookup                  │           ┌──────┴──────┐           │             │     node available   no node           │             │           │        Infra Driver           │             │           │         start node           │             │           └──────┬──────┘                  ▼               dna-node                  │            start worker                  │              execute                  │              result                  │                  ▼               DNA Core                  │              persist                  │                  ▼               Client

งาน Mac/local:

DNA Core   │   │ signed WorkOrder   ▼Mac Agent   │   ├── Chrome   ├── Files   ├── Excel   ├── local application   └── Mouse/Keyboard        │        ▼     result        │        ▼DNA Core

server ไม่ render desktop

AI:

Command   ↓Router   ↓requires ai.model.xxx   ↓AI worker   ↓result

build:

Git Push   ↓Git hook   ↓Core Event   ↓Build Worker   ↓Artifact   ↓Release   ↓Deploy

file:

Upload   ↓Blob Store   ↓file.process event   ↓Worker   ↓new immutable blob   ↓version pointer updated

และ observability ไม่ต้องพึ่ง SaaS:

Core├── structured event├── structured log├── metrics└── auditNode├── heartbeat├── process state├── CPU/RAM/IO└── worker stateDatabase├── queue depth├── replication lag└── connection health

PostgreSQL มีตัวชี้วัด WAL position และ replication views สำหรับวัด replication lag โดยตรง จึงสามารถเอาข้อมูลเข้าหน้า DNA Monitor ของเราเองได้โดยไม่ต้องพึ่ง dashboard provider. [13]

Data model ขั้นต่ำที่ผมจะให้มีใน V1 คือ:

identity────────────userssessionsapi_keysrolesrole_permissionssubject_rolesruntime────────────nodesnode_capabilitiesnode_heartbeatsexecution────────────commandsjobsjob_attemptsscheduleseventsoutboxstorage────────────artifactsblob_locationsfilesfile_versionsdeployment────────────releasesdeploymentsdeployment_nodessecurity────────────secretsaudit_events

แล้ว Core มี authority chain เดียว:

WHO↓MAY DO WHAT↓TO WHICH RESOURCE↓WHERE SHOULD IT RUN↓WHAT STATE DID IT CREATE

นี่คือ logic ที่ DNA OS ควรเป็นเจ้าของ

ไม่ใช่:

provider routingprovider buildprovider functionprovider cronprovider queueprovider logsprovider deployment


## ลำดับสร้างที่ผมแนะนำและขอบเขตที่ไม่ควรข้าม

สร้างระบบตาม dependency จากล่างขึ้นบน ไม่ใช่สร้าง feature กระจัดกระจาย

FoundationLinuxPostgreSQLGitTLSfilesystem        ↓DNA Protocol V1        ↓DNA CoreIdentityPermissionRegistryRouterEventsQueueScheduler        ↓DNA NodeProcess lifecyclecgroupsandboxheartbeat        ↓DNA Blob        ↓Git → Build → Artifact        ↓Release → Deploy → Rollback        ↓Mac / Local Agent        ↓HA / Region / Infrastructure Drivers

Milestone แรกควรถือว่าสำเร็จเมื่อ flow นี้ทำงานโดยไม่มี Railway/Vercel/GitHub Actions/managed queue:

git push   ↓DNA Git   ↓DNA Core   ↓job   ↓DNA worker   ↓test   ↓DNA Blob   ↓release   ↓deploy CORE_B   ↓health check   ↓switch release

Milestone ถัดไป:

POST /v1/commands   ↓permission   ↓router   ↓Mac Agent   ↓Chrome / local file   ↓result

จากนั้นค่อยทำ:

worker capacity = 0     ↓ event arrivesInfrastructure Driver     ↓start compute     ↓node registers READY     ↓job executes     ↓idle     ↓drain     ↓stop compute

สิ่งที่ ไม่ควรเขียนเอง แม้ architecture จะเป็นของ DNA OS คือ cryptographic primitive, TLS algorithm, password hash algorithm, Git object format และ database engine ใช้มาตรฐานและ implementation ที่ผ่านการใช้งานจริง แล้วเขียน control logic รอบมันเอง แทน TLS 1.3, Ed25519 และ Argon2 มี specification มาตรฐานโดยตรง; PostgreSQL มี locking, WAL replication และ recovery primitives; Git มี receive protocol และ hooks อยู่แล้ว. [14]


## แก่นสุดท้ายของ architecture จึงเป็น:

DNA OS                  │       ┌──────────┼──────────┐       │          │          │    Authority   Protocol   Runtime       │          │          │       └──────────┼──────────┘                  │              Resource                  │     ┌────────────┼─────────────┐     │            │             │   Compute       Data         Device     │            │             │ CPU/RAM       DB/Blob       Mac/User


## และ boundary ที่ควรล็อกถาวรคือ:

Provider= supplies machine lifecycleLinux= supplies kernel primitivesPostgreSQL= supplies durable transactional stateGit= supplies source version modelDNA OS= owns identity  owns permission  owns command  owns routing  owns scheduling  owns registry  owns worker lifecycle  owns event model  owns artifact model  owns release model  owns deployment  owns monitoring  owns failover policy

ดังนั้นสิ่งที่เฮียกำลังสร้างไม่ควรนิยามว่าเป็น “self-hosted backend” แต่เป็น self-hosted operational control plane ที่ abstraction ของ provider ถูกผลักออกไปจนเหลือเพียง adapter สำหรับเครื่อง, network และ lifecycle ส่วนเส้นทางการตัดสินใจทั้งหมดอยู่ใน DNA_OS_RUNTIME_V1 ของเราเอง.

[1] Control Group v2 — The Linux Kernel documentation

https://docs.kernel.org/admin-guide/cgroup-v2.html

[2] crypto/tls - Go Packages

https://pkg.go.dev/crypto/tls?utm_source=chatgpt.com

[3] Landlock: unprivileged access control — The Linux Kernel documentation

https://docs.kernel.org/userspace-api/landlock.html

[4] [14] RFC 9106: Argon2 Memory-Hard Function for Password Hashing and Proof-of-Work Applications | RFC Editor

https://www.rfc-editor.org/rfc/rfc9106

[5] RFC 8446: The Transport Layer Security (TLS) Protocol Version 1.3 | RFC Editor

https://www.rfc-editor.org/rfc/rfc8446

[6] Software Catalogue - Administration/development tools

https://www.postgresql.org/?utm_source=chatgpt.com

[7] PostgreSQL: Documentation: 18: SELECT

https://www.postgresql.org/docs/18/sql-select.html

[8] PostgreSQL: Documentation: 18: LISTEN

https://www.postgresql.org/docs/18/sql-listen.html

[9] PostgreSQL: Documentation: 18: 13.3. Explicit Locking

https://www.postgresql.org/docs/18/explicit-locking.html

[10] [11] Git - git-receive-pack Documentation

https://git-scm.com/docs/git-receive-pack

[12] PostgreSQL: Documentation: 18: 26.3. Failover

https://www.postgresql.org/docs/18/warm-standby-failover.html

[13] PostgreSQL: Documentation: 18: 26.2. Log-Shipping Standby Servers

https://www.postgresql.org/docs/18/warm-standby.html

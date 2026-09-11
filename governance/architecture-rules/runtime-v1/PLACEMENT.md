# DNA OS Runtime V1 — Placement / migration authority

**role:** PLACEMENT — reconcile CURRENT implementation with DESTINATION. Preserve the current authority graph. Do not invent duplicate subsystems.
**not executable:** this file is documentation. TypeScript contracts and tests remain CURRENT law.
**Go / folder examples:** illustrative unless a CURRENT contract requires them.

Source DOCX is retained under `./source/`.


## คำตัดสินจากโค้ดจริงที่มีอยู่ตอนนี้

จากการตรวจ t23598788-oss/-DNA-OS-INFRASTRUCTURE- บน main ปัจจุบัน ภาพที่เฮียสรุปมา ถูกในระดับสถาปัตยกรรม แต่มีบางจุดที่เอกสารเปรียบเทียบเขียนล้ำหน้าโค้ดจริงบน main ไปแล้ว โดยเฉพาะเรื่อง Linux supervisor, ชื่อ node kind และลำดับ permission/routing

แก่นที่สำคัญที่สุดนั้นยืนยันจากโค้ดจริงได้ชัดเจน: DNA OS กำลังสร้าง authority layer ของตัวเอง ไม่ได้ยกอำนาจการตัดสินใจให้ Railway, GitHub, AI หรือ external service ตัวใด ใน control/machine-model/execution-authority.ts มีหลักชัดว่า Owner คือรากของอำนาจ และ resource/software/AI/service/test/external system เป็นเพียงสิ่งที่ถูกเรียก ตัวลงมือ หรือตัวกระตุ้น ไม่สามารถสร้างอำนาจย้อนกลับมาสั่ง DNA OS ได้

ดังนั้นแนวคิด

Provider = machine / network / process substrateDNA OS = authority / decision / permission / routing

ไม่ได้เป็นแค่ destination vision แล้ว แต่มีรากอยู่ใน executable architecture จริง


## ตารางด้านล่างคือสถานะที่ผมตรวจจาก repo จริง:

ประเด็น

สถานะจาก main


## คำตัดสิน

DNA OS เป็น execution authority

ยืนยันได้จาก machine-model/execution-authority.ts

จริง

Owner command เป็น canonical ingress

submitOwnerCommand() เป็น public contract และสร้าง CommandEnvelope

จริง

Router เป็นจุดกลาง

command-router รับ envelope, classify, permission gate แล้ว route capability

จริง

Permission แยกเป็น deterministic boundary

execution-policy และ write-gate แยกชัดและ fail-closed

จริง

Repository registry เป็น durable registry

append-only JSONL, restart-safe

จริง

GitHub ยังเป็น SOURCE_AUTHORITY

connection type จริงปัจจุบันคือ SOURCE_AUTHORITY และ GitHub เป็น implementation ที่ใช้อยู่

จริง

Repository path rebinding

มี rebindRepositoryCheckout() สำหรับ replacement environment แล้ว

จริง

PostgreSQL เป็น runtime authority แล้ว

มี schema/adapter แต่ production adapter ยังไม่ถูก invoke

ยังไม่จริง

Railway หลุดออกจาก runtime path แล้ว

ยังมี .railway.app hard-code หลายแห่ง

ยังไม่จริง


## Linux portable supervisor เสร็จแล้ว

current runtime-control ระบุชัดว่า launchd ยังเป็น process supervisor จริงเพียงตัวเดียว

ขัดกับ comparison

CORE_NODE / MAC_LOCAL_AGENT เป็น type ที่ frozen ใน main

ไม่พบ exact symbols นี้ใน main ที่เชื่อมอยู่

ยังยืนยันไม่ได้

providerIsExecutionAuthority === false มีอยู่จริง

ไม่พบ exact symbol แต่ semantics มีชัดกว่าใน execution-authority


## หลักการจริง แต่ชื่อ symbol ยังไม่ยืนยัน


## จุดที่ต้องแก้ในตารางเดิมก่อนเลยคือ ลำดับ runtime จริง

ไม่ใช่:

Envelope→ execution-policy→ router→ capability

แต่ architecture ปัจจุบันเป็น:

Ingress→ owner-command→ CommandEnvelope→ command-router     ↓     permission / execution-policy     ↓     capability→ CapabilityResult→ CommandLifecycleState→ result / evidence

control/owner-command ระบุโดยตรงว่า Owner path สร้าง CommandEnvelope แล้วส่งเข้า command-router เพียงทางเดียว และห้ามสร้างทางลัดไป capability; ส่วนตัว router เองเป็นผู้เรียก permission gate ก่อน execution

นี่สำคัญมาก เพราะ destination V1 ไม่ควรย้าย execution-policy ออกมาไว้หน้าตัว router จนเกิด authority path สองชุด ควรรักษาหลัก:

Ingress authenticates identityRouter authorizes requested executionCapability executesWrite Gate governs mutation

อีกจุดที่ comparison ต้องแก้ค่อนข้างแรงคือ supervisor ปัจจุบัน control/runtime-control ประกาศว่า

DNA OS Control→ Runtime Control Adapter→ launchd→ Process→ Health/Evidence→ DNA OS

และระบุชัดว่า capability นี้ ไม่ spawn, fork, daemonize หรือทำ background polling; launchd เป็น process supervisor/executor จริงในขอบเขตนี้ ขณะที่ agent-gateway/supervisor.ts เป็น supervisor สำหรับ task-controller/recovery ของ Agent Gateway ไม่ใช่ generic Linux host supervisor

ดังนั้นข้อความว่า

Step 5 Process supervisor not launchd-only = DonePortableProcessSupervisor spawn on Linux Core

ยังไม่ควรถูกถือเป็น current law ของ main ณ ตอนนี้

สิ่งที่ยืนยันได้กลับชัดมากคือ Step 6 เรื่อง portability: repository registry มี operation สำหรับ rebind machine-local checkout โดยตรง และ comment ระบุด้วยว่า cloned repository_root ของเครื่องอื่นห้ามถูกถือเป็น authority

ส่วน Step 7 ก็ยืนยันได้ว่า ยังเป็น blocker จริง เพราะ runtime ปัจจุบันยังมี Railway URL ฝังอยู่ เช่น dna-dev-app-host/config.ts กำหนด canonical target เป็น dna-os-circuit-production.up.railway.app และกำหนด runtime kind เป็น RAILWAY_DEPLOYMENT; production checkpoint และ joint monitor ก็ยังอ้าง Railway URL โดยตรง


## สรุปสถานะจริง ณ จุดนี้จึงเป็น:

Authority architecture     = มาแล้วPermission architecture    = มาแล้วCommand routing            = มาแล้วCapability isolation       = มาแล้วRepository portability     = เริ่มจริงแล้วProvider independence      = ยังไม่จบDurable runtime state      = ยังไม่จบDurable distributed queue  = ยังไม่จบRelease/runtime separation = ยังไม่จบLinux workload isolation   = ยังไม่จบMachine failover           = ยังไม่จบRegional runtime           = ยังไม่เริ่ม


## โครงสร้าง DNA OS Runtime ที่ควรล็อกเป็นปลายทาง

ผมไม่แนะนำให้เปลี่ยนจาก TypeScript เป็น Go ก่อน และไม่แนะนำให้สร้าง cmd/dna-core, cmd/dna-node, cmd/dna-blobd ตอนนี้

เหตุผลคือ สิ่งที่มีมูลค่าที่สุดใน repo ไม่ใช่ภาษา แต่คือ authority graph และ contracts ที่สร้างมาแล้ว เช่น owner-command, command-router, execution-policy, write-gate, repository registry และ execution evidence พวกนี้ควรกลายเป็น protocol law ก่อน แล้วภาษาเป็น implementation detail ภายหลัง

สถาปัตยกรรมปลายทางควรเป็น:

INTERNET / CLIENT / APP                              │                              ▼                     ┌─────────────────┐                     │ DNA OS INGRESS  │                     │ TLS / AuthN     │                     │ Session         │                     │ Rate / Limits   │                     └────────┬────────┘                              │                              ▼                    ┌───────────────────┐                    │ COMMAND AUTHORITY │                    │ Envelope          │                    │ Identity          │                    │ Idempotency       │                    └────────┬──────────┘                             │                             ▼                     ┌────────────────┐                     │ COMMAND ROUTER │                     │ Resolve Intent │                     │ Permission     │                     │ Resolve Target │                     └───────┬────────┘                             │              ┌──────────────┼────────────────┐              │              │                │              ▼              ▼                ▼         CORE LOCAL       JOB QUEUE       MAC AGENT         CAPABILITY          │             / CLIENT                             ▼                     EVENT WORKER                             │                             ▼                  AI / BUILD / FILE / REPORT                             │              ┌──────────────┴─────────────┐              ▼                            ▼          PostgreSQL                 Artifact Store      authority / state            immutable blobs              │                            │              └──────────────┬─────────────┘                             ▼                     RESULT / EVIDENCE

Core ที่ต้อง 24/7 จริงควรมีแค่:

dna-core├── HTTP ingress├── session/auth validation├── permission├── command router├── node registry├── scheduler├── durable job coordinator├── webhook ingress├── release registry├── health/readiness└── evidence/event writer

ส่วนนี้:

AI executioncoding/buildtestfile processingPDF/report generationbrowser automationlarge ETLbulk importbackground repair

ไม่ควรอยู่ใน Core process เลย

ควรกลายเป็น:

JOB↓worker claim↓spawn workload↓isolate resources↓execute↓persist result/evidence↓terminate

จุดนี้ตรงกับบทเรียนจาก repo จริงอย่างมาก เพราะ agent-gateway/supervisor.ts บันทึกเหตุการณ์ว่าการ sweep tasks.jsonl ขนาดประมาณ 14.5 MB / 16,611 rows ทุก 30 วินาทีเกิดรอบซ้อนจน main thread ใช้ CPU 100% และ Core HTTP ไม่ตอบเป็นเวลาหลายชั่วโมง จนต้องถอด voice sweep ออกจาก Core path

นี่เป็นหลักฐานจากระบบของเฮียเองว่า:

Core ≠ background workerCore ≠ scan-everything loopCore ≠ heavy processor

Core ต้องเป็น control plane ที่ latency ต่ำและ workload คาดเดาได้

และไม่ควรเพิ่ม node kind ใหม่เพียงเพราะมี worker

ให้แยก concept:

NODE_KIND- CORE_NODE- MAC_LOCAL_AGENTPROCESS_CLASS- CORE_SERVICE- EVENT_WORKER- AI_WORKER- BUILD_WORKER- FILE_WORKER- AUTOMATION_WORKER

worker คือ process/capability class ไม่ใช่ machine identity ใหม่

ดังนั้นแม้ destination doc มีรูป “Other Agent” อยู่ ก็ยังไม่ควรสร้าง:

OTHER_AGENTGENERIC_AGENTWORKER_NODE

จนกว่าจะมี physical execution boundary ที่ต่างจริง


## สำหรับ public protocol ผมแนะนำให้มี canonical surface เล็กแบบนี้:

POST /v1/commandsGET  /v1/commands/:command_idPOST /v1/agents/enrollPOST /v1/agents/:agent_id/heartbeatGET  /v1/releases/:release_idGET  /v1/artifacts/:digestGET  /v1/health/liveGET  /v1/health/ready

แต่ ไม่ต้องลบ route เดิมทันที

route อย่าง:

/owner/language/owner/submit-command/registry/candidates...

ควรอยู่ต่อในช่วง migration แล้วทำหน้าที่เป็น adapter:

Legacy HTTP Route      ↓normalize      ↓DNA_OS_RUNTIME_V1 CommandEnvelope      ↓same canonical command path

ปัจจุบัน owner-command-http/server.ts มีทั้ง Owner language และ read/control surface หลายอย่างอยู่ใน process เดียวจริง และ Owner application surface ก็ถือ owner-command-http บน 127.0.0.1:8791 เป็น Core ingress/read-model surface

เพราะฉะนั้น อย่า rewrite server.ts ก่อน ให้สร้าง canonical transport contract แล้วค่อยย้าย route ทีละชุด

Command V1 ผมจะล็อกให้ประมาณนี้:


```
export interface RuntimeCommandV1 {  protocol: "DNA_OS_RUNTIME_V1";  command_id: string;  idempotency_key: string;  issued_at: string;  deadline_at: string | null;  actor: {    kind: "OWNER" | "CLIENT" | "SYSTEM";    subject_id: string;    session_id: string | null;  };  intent: {    capability: string;    operation: string;  };  target: {    execution_class:      | "CORE"      | "MAC_LOCAL_AGENT"      | "EVENT_WORKER";    target_ref: string | null;  };  input: {    inline: unknown | null;    artifact_ref: string | null;  };  context: {    repository_id: string | null;    work_id: string | null;    trace_id: string;  };}
```


## สิ่งที่ ไม่ควรใส่ในนี้ คือ:

Railway environment idVercel deployment idGitHub Actions job idprovider URLMac filesystem pathrepository_root ของเครื่องอื่นsecret value

เพราะสิ่งเหล่านั้นเป็น placement/configuration fact ไม่ใช่ command contract

และผมเห็นด้วยอย่างมากกับข้อห้ามเดิมของเฮียว่า อย่าเพิ่ม node_id เข้า RepositoryRegistration

repository identity กับ runtime node identity เป็นคนละเรื่อง

RepositoryRegistration= source identityNodeRegistration= machine/runtime identityReleaseRegistration= executable artifact identity

ห้ามรวมสามอย่างนี้เป็น record เดียวเด็ดขาด

repo ปัจจุบันเก็บ repository_root เป็น machine-local filesystem evidence อยู่แล้ว และมี rebind เพื่อแก้ replacement machine โดยไม่เปลี่ยน repository identity นี่เป็น seam ที่ถูกทางมาก


## โครงสร้างไฟล์ที่ควรสร้างต่อจาก repo เดิม

แทนที่จะสร้างต้นไม้ Go ชุดใหม่ ผมจะวาง DNA_OS_RUNTIME_V1 ทับลงบน vocabulary ปัจจุบัน แบบนี้:

DNA-OS-INFRASTRUCTURE/│├── docs/│   └── runtime-v1.md│├── contracts/│   └── runtime/│       └── v1/│           ├── command.ts│           ├── command-result.ts│           ├── node.ts│           ├── job.ts│           ├── release.ts│           ├── artifact.ts│           ├── health.ts│           └── error.ts│├── control/│   ├── owner-command/                # KEEP│   ├── command-router/               # KEEP│   ├── command-status/               # KEEP│   ├── target-resolution/            # KEEP│   ├── machine-model/                # KEEP│   ├── runtime-endpoint-registry/│   │   ├── contract.ts│   │   ├── registry.ts│   │   ├── types.ts│   │   └── tests/│   ││   ├── node-registry/│   │   ├── contract.ts│   │   ├── registry.ts│   │   ├── heartbeat.ts│   │   └── tests/│   ││   ├── release-control/│   │   ├── contract.ts│   │   ├── stage.ts│   │   ├── activate.ts│   │   ├── rollback.ts│   │   ├── verify.ts│   │   └── tests/│   ││   └── scheduler/│       ├── contract.ts│       ├── scheduler.ts│       └── tests/│├── permissions/│   ├── execution-policy/             # KEEP│   ├── write-gate/                   # KEEP│   └── network-auth-gate/            # KEEP│├── execution/│   ├── run/                          # KEEP│   └── workload-runtime/│       ├── contract.ts│       ├── process.ts│       ├── limits.ts│       ├── result.ts│       ├── adapters/│       │   ├── linux-cgroup-v2.ts│       │   └── local-process.ts│       └── tests/│├── software/│   ├── repository-registry/          # KEEP│   └── registry-database/            # KEEP + wire PostgreSQL│├── storage/│   ├── runtime-state/│   │   ├── migrations/│   │   ├── postgres.ts│   │   └── transaction.ts│   ││   └── artifact-store/│       ├── contract.ts│       ├── filesystem-store.ts│       └── verifier.ts│├── transport/│   ├── owner-command-http/           # KEEP during migration│   └── runtime-v1-http/│       ├── server.ts│       ├── command-routes.ts│       ├── agent-routes.ts│       ├── release-routes.ts│       └── health-routes.ts│└── observability/    └── runtime-health/        ├── live.ts        ├── ready.ts        └── metrics.ts

มีข้อสำคัญคือผม ไม่สร้าง execution/job-queue/ ใหม่ทันที จนกว่าจะ audit control/work-coordination และ Agent Gateway ทั้งชุดก่อน เพราะ repo ปัจจุบันมี ownership ของ work-item queue state อยู่แล้วบางส่วน และกฎของระบบเฮียชัดว่าไม่สร้าง subsystem ซ้ำถ้ามี canonical owner อยู่แล้ว


## แนวทางที่ถูกต้องคือ:

CURRENT QUEUE OWNER      ↓define store port      ↓JSONL implementationPostgres implementation      ↓cut authority explicitly

ไม่ใช่:

old queue+new queue+new router+new scheduler

เพราะสุดท้ายจะกลับไปเป็นปัญหา “ส่งไปส่งกลับ” แบบที่เฮียต้องการกำจัด

ส่วน control/runtime-control ก็ไม่ควรถูกเปลี่ยนความหมายเงียบ ๆ เพราะ contract ปัจจุบันระบุชัดว่ามันเป็น adapter ของ fixed local services 4 ตัวและ launchd เท่านั้น

จึงควรแยก:

control/runtime-control= fixed long-lived local servicesexecution/workload-runtime= temporary/event-driven workload process

คนละ capability จริง ไม่ใช่ duplicate

ด้าน PostgreSQL ปัจจุบัน repo มี seam พร้อมกว่าที่ comparison บอกเสียอีก software/registry-database มี store port, schema/migrations และ adapters/postgres-store.ts แล้ว แต่ README ระบุชัดว่า production ยังไม่ instantiate pg.Pool, ยังไม่มี live credential และยังไม่ execute migration จริง

ดังนั้นนี่ไม่ใช่ “สร้าง DB architecture ใหม่”

มันคือ:

existing RegistryStore contract             ↓activate real PostgreSQL implementation             ↓migrate authority

ซึ่งสะอาดกว่า rewrite มาก


## Durable State, Queue, Release และ Failover

จุดเปลี่ยนใหญ่ที่สุดของ Runtime V1 ควรเป็นการแยก evidence log ออกจาก operational authority

JSONL ไม่ผิด และควรอยู่ต่อ แต่ไม่ควรเป็น runtime coordination authority เมื่อมีหลาย Core/Worker

ปลายทางควรเป็น:

PostgreSQL= current authoritative stateJSONL= evidence export= audit stream= offline recovery artifact= human-readable historical proof

ไม่ใช่:

JSONL= queue= scheduler= registry= current state= locking= coordination

ฐานข้อมูลขั้นต่ำที่ผมจะสร้างมีแค่นี้:

runtime_commandsruntime_jobsruntime_job_attemptsruntime_nodesruntime_schedulesruntime_releasesruntime_artifactsruntime_eventsruntime_effects

ความสัมพันธ์:

runtime_commands      │      ├── 0..N runtime_jobs      │          │      │          └── N runtime_job_attempts      │      └── N runtime_eventsruntime_nodes      └── claims jobsruntime_releases      └── N runtime_artifactsruntime_schedules      └── creates commands/jobsruntime_effects      └── guards external mutation


## Job state:

READY  ↓ claimRUNNING  ↓COMPLETEDRUNNING  ↓ crash / lease expiredREADYRUNNING  ↓ max attemptsFAILED

claim ไม่ต้องสร้าง Redis, RabbitMQ, Kafka หรือ managed queue

PostgreSQL ทำ queue V1 ได้ตรงกับ architecture นี้ โดยใช้:

FOR UPDATE SKIP LOCKED

PostgreSQL ระบุเองว่า SKIP LOCKED จะข้าม row ที่ถูก lock อยู่ และเหมาะกับกรณีหลาย consumer เข้าถึงตารางลักษณะ queue เพื่อลด lock contention [1]

ตัว claim ควรเป็น transaction เดียว:


```
WITH picked AS (    SELECT job_id    FROM runtime_jobs    WHERE status = 'READY'      AND available_at <= now()    ORDER BY priority DESC, created_at ASC    FOR UPDATE SKIP LOCKED    LIMIT 1)UPDATE runtime_jobs AS jSET    status       = 'RUNNING',    claimed_by   = $1,    lease_token  = $2,    lease_until  = now() + interval '60 seconds',    attempt      = attempt + 1,    started_at   = COALESCE(started_at, now())FROM pickedWHERE j.job_id = picked.job_idRETURNING j.*;
```

จากนั้น:

transaction commit↓worker executes↓worker returns result↓UPDATE ... WHERE lease_token = ?↓COMPLETED

LISTEN/NOTIFY ใช้ได้ แต่ให้เป็น bell ไม่ใช่ storage

INSERT job into table↓COMMIT↓NOTIFY dna_jobs, job_id↓sleeping worker wakes↓SELECT/claim from runtime_jobs

PostgreSQL เองอธิบาย NOTIFY ว่าเป็น IPC mechanism และแนะนำให้ structured/large data อยู่ใน table แล้ว notification ส่งเพียง key; notifications ก็ถูกส่งหลัง transaction commit เท่านั้น [2] นอกจากนี้ LISTEN ยังมี startup race ที่ documentation แนะนำให้ commit LISTEN ก่อน อ่าน authoritative database state แล้วจึงใช้ notifications สำหรับการเปลี่ยนแปลงถัดไป [3]

เพราะฉะนั้น:

runtime_jobs = truthNOTIFY       = wake-up optimization

อย่ากลับด้านเด็ดขาด


## ส่วน job execution ต้องถือว่า at-least-once

เพราะ sequence นี้เกิดได้:

worker↓ทำ external side effect สำเร็จ↓process crash↓ยังไม่ ACK job↓lease expires↓job ถูก run ใหม่

ดังนั้น mutation เช่น:

send emailcreate invoicetransfer paymentpublish sourcedelete filedeploy

ต้องผ่าน runtime_effects / existing Write Gate พร้อม effect_key

เช่น:

effect_key =command_id+ capability+ operation+ target_identity

ถ้า effect เดิม COMPLETED แล้ว:

retry job→ DO NOT execute effect again→ return existing evidence

นี่จะต่อเข้ากับ philosophy ของ permissions/write-gate ที่ปัจจุบันเป็น deterministic, fully-evidenced และ fail-closed อยู่แล้วได้ตรงที่สุด


## Release ต้องแยกออกจาก source checkout

นี่คือ cut ที่สำคัญกว่าการย้าย TypeScript → Go

Production ห้ามเป็น:

git checkout↓npm install↓tsx server.ts

ปลายทาง:

SOURCE/srv/dna/source/<repository>/<revision>/          ↓ buildARTIFACT/var/lib/dna/artifacts/sha256/<digest>          ↓ stageRELEASE/opt/dna/releases/<release_id>/          ↓ verify/opt/dna/current    → /opt/dna/releases/<release_id>

release manifest:

{  "schema": "DNA_OS_RELEASE_V1",  "release_id": "rel_...",  "runtime_contract": "DNA_OS_RUNTIME_V1",  "source": {    "repository_id": "repo_...",    "commit_sha": "..."  },  "artifact": {    "sha256": "...",    "size_bytes": 0  },  "entrypoint": "dist/runtime/server.js",  "built_at": "...",  "required_node_major": 24,  "database_schema_min": 1,  "database_schema_max": 1,  "signer": {    "key_id": "dna-release-key-01"  }}

activation:

download/stage↓verify digest↓verify signature↓verify release manifest↓check DB schema compatibility↓preflight↓atomic current symlink swap↓restart↓/health/live↓/health/ready↓ACTIVE

ถ้า readiness fail:

current → previous releaserestartverifyrecord rollback evidence

และ DNA OS ไม่ควรเขียน cryptography engine เอง การเซ็น blob/release สามารถใช้ primitive ที่มีอยู่แล้ว เช่น Cosign ซึ่งรองรับการ sign/verify file/blob และ self-managed signing keys ได้ [4]

ตรงนี้ทำให้ failover ที่เฮียพูดไว้กลายเป็นของจริง:

CORE_A dies    ↓CORE_B boots    ↓read desired release_id    ↓fetch immutable artifact    ↓verify    ↓activate exact same release    ↓connect same PostgreSQL authority    ↓resume expired leases


## สิ่งที่ย้ายระหว่างเครื่องจึงเหลือ:

node identityrelease identitysecret referencesdatabase connectivitynetwork identity

ไม่ใช่การ copy working directory ไปอีกเครื่อง


## Linux Worker isolation

ใน Linux Core งานหนักควรอยู่ cgroup แยกต่อ job:

/sys/fs/cgroup/dna/└── jobs/    └── <job_id>/

เขียน policy เช่น:

cpu.maxmemory.maxpids.max

Linux kernel ระบุว่า cpu.max ใช้กำหนด maximum CPU bandwidth, memory.max เป็น hard memory limit และ pids.max เป็น hard limit ของจำนวน process ใน cgroup [5]

DNA OS จึงสามารถกำหนด:

AI_WORKERcpu.max    = 200000 100000memory.max = 8Gpids.max   = 128FILE_WORKERcpu.max    = 100000 100000memory.max = 2Gpids.max   = 32

โดยไม่ต้องซื้อ “serverless worker abstraction” จาก provider

สำหรับ filesystem/network confinement ระยะต่อไปใช้ Landlock ได้ โดย kernel interface รองรับการจำกัดสิทธิ์ filesystem และ network บางประเภท และทำ ruleset ตาม ABI ที่ kernel รองรับ [6]

แต่ผมจะ ไม่ประกาศ Landlock ว่า done ใน Runtime V1 milestone แรก

ลำดับที่ถูกคือ:

V1Aprocess ownership + timeout + cgroupV1Buid separation + filesystem workspace boundaryV1CLandlock/native launcherV1Dnetwork egress policy

อย่าเอา sandbox ห้าชั้นลงพร้อมกันแล้วทำให้ Core migration ติดอยู่ตรงนั้น

DNA Git

GitHub ควรยังเป็น SOURCE_AUTHORITY ไปก่อน เพราะนั่นคือ current law ใน repo จริง ConnectionType ปัจจุบันยังมี "SOURCE_AUTHORITY" เป็น real connection type ที่ใช้อยู่ และ GitHub adapter ถูกผูกกับบทบาทนี้

หลัง Runtime V1 เสถียรจึงค่อยทำ:

/srv/dna/git/├── infrastructure.git├── financial-documents.git├── blueprint.git└── ...

ไม่ต้องเขียน Git protocol เอง Git มี git-http-backend สำหรับ serve repository ผ่าน HTTP/HTTPS รองรับ smart fetch, authenticated push และ protocol v2 อยู่แล้ว [7]

เป้าหมายในภายหลัง:

DNA Git= SOURCE_AUTHORITYGitHub= MIRROR= BACKUP= collaboration/publication endpoint

แต่การเปลี่ยนนี้ต้องเป็น explicit migration event ไม่ใช่แก้ enum หรือ remote URL เฉย ๆ


## เส้นทางย้ายจาก repo วันนี้ไป Runtime V1

ลำดับที่ปลอดภัยที่สุดไม่ใช่ Go rewrite แต่เป็นการถอด provider และ local-machine assumptions ออกจากทีละ layer

ระยะ


## สิ่งที่ทำ

Exit Gate

Architecture freeze

เพิ่ม docs/runtime-v1.md เป็น DESTINATION

current vs destination ไม่ปนกัน

Endpoint portability

เอา hard-coded Railway domains ออกจาก runtime decision

Core ไม่มี .railway.app assumption

Own-machine Core

รัน Node Core ปัจจุบันบน VM/Linux ของเรา

Railway หายจาก critical path

Runtime state

เปิด self-controlled PostgreSQL authority

restart แล้ว state ไม่ขึ้นกับ JSONL


## Durable jobs

ย้าย task claim/recovery เข้า Postgres

worker หลายตัว claim ไม่ชน


## Release split

build artifact แยกจาก source checkout

production ไม่ execute checkout

Worker runtime

cgroup/lease/timeout/process isolation

heavy work ไม่อยู่ Core

Source independence


## DNA Git primary

GitHub กลายเป็น mirror แบบ explicit

HA

Core B ใช้ release/state เดียวกับ Core A

machine loss ไม่ใช่ architecture loss

Region

เพิ่ม Core region ด้วย protocol เดิม

ไม่ rewrite business logic

สิ่งแรกที่ควรทำจริงคือ Step 7 ไม่ใช่ PostgreSQL

เพราะ repo ยังมี provider identity ฝังใน runtime location เช่น canonical Railway target และ production checkpoint อยู่จริง

สร้าง contract กลาง:


```
export interface RuntimeEndpointRegistration {  endpoint_id: string;  capability_id: string;  scope:    | "CORE_LOCAL"    | "MAC_LOCAL"    | "PUBLIC";  transport: "HTTP" | "HTTPS" | "STDIO";  address: string;  health_path: string | null;  source: "NODE_LOCAL" | "REGISTERED_REMOTE";  status: "ACTIVE" | "DRAINING" | "DISABLED";}
```

จากนั้น code ห้ามทำ:

const url =  "https://dna-os-circuit-production.up.railway.app";

เปลี่ยนเป็น:

const endpoint =  resolveRuntimeEndpoint("dna-os-circuit");await invoke(endpoint, request);

เมื่อทำจุดนี้เสร็จ:

Railway machineHetzner VMHostinger VPSAWS EC2bare metalMac

จะกลายเป็น deployment placement เท่านั้น

business code ไม่รู้จักอีกแล้วว่า process อยู่ที่ไหน

ขั้นต่อมาคือย้าย Core ปัจจุบันขึ้น VM ของเรา โดยยังใช้ TypeScript/Node เหมือนเดิมทั้งหมด

Current source↓same tests↓same command contracts↓same router↓same permission logic↓Linux VM

ถ้ามันรันได้โดย:

HOST=...PORT=...DATABASE_URL=...ARTIFACT_ROOT=...DNA_NODE_ID=...

โดยไม่มี:

RAILWAY_*VERCEL_*GITHUB_ACTIONS_*

อยู่ใน runtime decision path

นั่นคือ milestone ที่มีค่ามากกว่าเปลี่ยนภาษาแล้ว

หลังจากนั้นค่อย cut persistence

ผมจะทำ cutover แบบ:

JSONL AUTHORITY    ↓Postgres SHADOW WRITE    ↓reconciliation    ↓checksum/count/state validation    ↓POSTGRES AUTHORITY    ↓JSONL AUDIT EXPORT

ไม่ควร switch ทุก table วันเดียว

เริ่มจาก:

node staterelease statejob state

ก่อน แล้วค่อย registry/evidence ที่เหลือ

ส่วน software_registry สามารถใช้ store abstraction ที่มีอยู่แล้ว ไม่จำเป็นต้องสร้าง database subsystem ใหม่

เมื่อ Postgres เป็น authority แล้วจึง build release split เพราะตอนนั้น Core B จะสามารถ boot จาก:

database+release artifact+secret references

โดยไม่จำเป็นต้องมี state ซ่อนอยู่ใน checkout ของ Core A

และเมื่อ release split เสร็จแล้ว จึงเหมาะที่จะสร้าง Linux worker runtime เพราะ worker จะรับ:

JobSpec+ArtifactRef+ExecutionPolicy

แทนการรับ:

go to this repo folderrun whatever is there

นี่คือจุดที่ DNA OS เปลี่ยนจาก repo-centric runtime ไปเป็น protocol-centric runtime


## Architecture law ที่ควร freeze ตั้งแต่ตอนนี้

ปลายทางที่ผมมองว่าเหมาะกับของจริงใน repo ไม่ใช่ “เขียน DNA OS ใหม่” แต่เป็นการยกระบบปัจจุบันขึ้นเป็น operating substrate ของตัวเอง

ให้ docs/runtime-v1.md ระบุ law ไว้ชัดประมาณนี้:

DNA_OS_RUNTIME_V1AUTHORITYOwner  ↓DNA OS  ↓Capability / Agent / Worker / ProviderNo provider, AI, worker, repository,deployment platform or external servicemay become execution authority.

ตรงกับ execution-authority ที่มีอยู่จริงแล้ว

ต่อด้วย:

COMMAND LAWAll executable intentmust become a canonical command.Ingress→ Identity→ CommandEnvelope→ Router→ Permission→ Target Resolution→ Execution→ Evidence→ Result

โดยรักษา router เป็น authority boundary ตาม implementation ปัจจุบัน

ต่อด้วย:

PROCESS LAWCore accepts and coordinates work.Core does not perform heavy work.Heavy work:→ durable job→ worker→ bounded execution→ result→ terminate

ต่อด้วย:

STATE LAWPostgreSQL= current operational authorityJSONL= append-only evidence/exportArtifact store= immutable binary/blob authorityGit= source/version authority

ต่อด้วย:

SOURCE LAWsource checkout != releaseGit commit→ build→ artifact→ digest→ signature→ immutable release→ activation

ต่อด้วย:

NODE LAWRepository identity!= Node identity!= Release identity!= Job identity

และ:

PROVIDER LAWProvider may provide:CPURAMDiskNetworkVM lifecycleProvider must not define:command semanticspermissionroutingjob authorityrelease authoritysource authoritybusiness workflowevidence truth

สุดท้าย:

PORTABILITY LAWNo runtime decision may depend on:*.railway.app*.vercel.appprovider environment IDsprovider deployment IDsprovider build IDsunless that information exists onlyinside an optional provider adapter.

นี่คือเส้นแบ่งที่ชัดที่สุดของ Runtime V1

หลังทำตามลำดับนี้ สถาปัตยกรรมจริงจะเหลือเพียง:

DNA OSClient  │  ▼Ingress  │  ▼Authority  │  ▼Router  │  ├─────────────► Core capability  │  ├─────────────► Durable job ─► Worker  │  └─────────────► Mac Agent ─► Browser/App/File  │  ▼PostgreSQL / Artifact Store  │  ▼Evidence + Result


## ส่วน infrastructure ด้านล่างจะเป็นเพียง:


```
┌────────────────────────────────────┐│ Machine A                          ││ CPU RAM Disk Network Linux         ││ DNA_OS_RUNTIME_V1                  │└────────────────────────────────────┘┌────────────────────────────────────┐│ Machine B                          ││ CPU RAM Disk Network Linux         ││ DNA_OS_RUNTIME_V1                  │└────────────────────────────────────┘┌────────────────────────────────────┐│ Mac / User Machine                 ││ DNA OS Agent                       ││ Chrome / Screen / Files / Apps     │└────────────────────────────────────┘
```

ดังนั้น conclusion จาก audit ครั้งนี้คือ อย่า rewrite DNA OS และ อย่าเริ่มจากภาษา Go

สิ่งที่มีอยู่แล้วคือ control-plane DNA ของระบบ และมันเริ่มแข็งแรงพอสมควรแล้ว: repository registry มี durable identity, command-router มี permission boundary, owner-command มี canonical envelope, write-gate มี deterministic mutation gate, machine-model มี authority semantics และ replacement checkout rebinding ก็เกิดขึ้นจริงแล้ว


## สิ่งที่ขาดจริงคือ เปลี่ยน substrate ใต้ของเดิม

จากGit checkout+ JSONL+ launchd+ Railway URLs+ machine-local runtimeไปเป็นImmutable release+ PostgreSQL authority+ durable job leases+ Linux workload isolation+ runtime endpoint registry+ own-machine execution

โดยไม่เปลี่ยน authority semantics ข้างบน

และจุดที่ต้องแก้ใน comparison เดิมก่อนเอาไป freeze เป็น principal architecture มีสามข้อชัดที่สุด:

1. Router ต้องมาก่อน execution-policy ใน canonical flow   เพราะ router เป็นผู้ invoke permission gate ในโค้ดจริง2. Linux portable supervisor ยังห้ามระบุว่า Done   เพราะ current main ยังประกาศ launchd เป็น real supervisor3. CORE_NODE / MAC_LOCAL_AGENT /   providerIsExecutionAuthority   ห้ามอ้างว่าเป็น exact frozen symbols ใน main   จนกว่าจะมีไฟล์/commit ที่ประกาศจริง

แต่หลักใหญ่ที่เฮียตั้งไว้ — “เราเป็นเจ้าของ Architecture, Protocol, Runtime และ Routing; ผู้ให้บริการเป็นเพียงเครื่องรัน” — สอดคล้องกับทิศทางของ source code จริงอย่างชัดเจน และขั้นถัดไปที่ถูกต้องคือการทำให้ runtime location, persistence, job execution และ release lifecycle อยู่ภายใต้ authority เดียวกันนั้นให้ครบ ไม่ใช่สร้างระบบคนละชุดขึ้นมาใหม่.

[1] PostgreSQL: Documentation: 18: SELECT

https://www.postgresql.org/docs/current/sql-select.html

[2] PostgreSQL: Documentation: 18: NOTIFY

https://www.postgresql.org/docs/current/sql-notify.html

[3] PostgreSQL: Documentation: 18: LISTEN

https://www.postgresql.org/docs/current/sql-listen.html

[4] Signing Blobs - Sigstore

https://docs.sigstore.dev/cosign/signing/signing_with_blobs/

[5] Control Group v2 — The Linux Kernel documentation

https://docs.kernel.org/admin-guide/cgroup-v2.html

[6] Landlock: unprivileged access control — The Linux Kernel documentation

https://docs.kernel.org/userspace-api/landlock.html

[7] Git - git-http-backend Documentation

https://git-scm.com/docs/git-http-backend

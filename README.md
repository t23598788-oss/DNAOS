# DNA-OS-INFRASTRUCTURE

**Status: skeleton only, reorganized 2026-08-14 (third pass). Nothing in
this repo can command, read, or modify any external program, AI model,
server, or software yet. Every capability is explicitly NOT_YET_BUILT
unless a folder's README says otherwise.**

## What this repo is

**A Software Control / Software Factory Source Repository.** It controls
Source Code and Software — it is not, and never becomes, the owner of the
business data that those pieces of Software create.

Example (Owner's own): Infrastructure commands the accounting software to
run. Infrastructure keeps: the connector's source code, the Command,
Software ID, Execution Status, commit, test result, deployment result. The
real accounting data stays in that accounting system's own Business
Domain database — never here.

## What this repo holds

Source Code, Software Module, Connector, AI Model / Agent Definition,
Permission Rule, Command Contract, Event Contract, Execution Logic,
Test/Build/Deploy Logic, Software Registry, Repository Registry,
Configuration Reference, Source Validation, Software Audit, Software
Connection Definition.

## What this repo must never hold (no exceptions)

ข้อมูลธุรกิจ (business data), ชื่อลูกค้า (customer names), เอกสารธุรกิจ
(business documents), ใบแจ้งหนี้ (invoices), การเงิน (finance), ข้อมูล
ผู้ใช้ทางธุรกิจ (business user data), Operational Data, Business Database.
This data always stays in its own Business Domain's own database.

## Folder tree

```
control/            ศูนย์ควบคุมคำสั่งซอฟต์แวร์
  owner-command/       คำสั่งจาก Owner
  command-router/       กระจายคำสั่งไปซอฟต์แวร์/AI
  command-status/       สถานะคำสั่ง (state machine)
software/            ทะเบียนและการจัดการซอฟต์แวร์
  software-registry/    ทะเบียนซอฟต์แวร์
  repository-registry/  ทะเบียน Git Repository
  workspace-registry/   ทะเบียนพื้นที่ทำงาน
  module-registry/       ทะเบียนโมดูล
ai/                  ระบบ AI
  model-registry/        ทะเบียนโมเดล
  agent-registry/        ทะเบียน Agent
  model-router/           เลือกและส่งงานให้โมเดล
connections/         การเชื่อมระบบภายนอก
  github/ vercel/ vercel-webhooks/ vercel-drains/ supabase/ ai-providers/
  servers/ external-software/
    (vercel-webhooks/, vercel-drains/ = inbound ingress, แยกจาก vercel/'s
    outbound adapter — ดู governance/architecture-rules/VERCEL_BOUNDARY_PLAN.md)
permissions/         สิทธิ์การควบคุมซอฟต์แวร์
  access-control/        Identity, Membership, break-glass, platform capability
  software-scope/        Account, Tenant, resource grants, Business Domain reference
  execution-policy/      สิทธิ์การ Run/Test/Deploy
execution/           เครื่องยนต์ทำงาน (ของ Software เอง — ไม่ใช่ command lifecycle)
  run/ build/ test/ deploy/ rollback/ code-change/
governance/          กฎและตัวตรวจระบบ
  architecture-rules/ source-validation/ dependency-rules/ permission-rules/ release-gate/
contracts/           สัญญาการเชื่อม
  identity/ command/ event/ software/ connector/ operational-bridge/
    (identity/ is the zero-dependency base contract — see Dependency direction below)
audit/               หลักฐานการทำงานของซอฟต์แวร์
  command-audit/ code-change-audit/ ai-execution-audit/ deployment-audit/
config/              ค่าตั้งค่าระบบซอฟต์แวร์
  environment/ connection-settings/ feature-status/
```

## File organization rules (Owner, 2026-08-14)

1. 1 หน้างาน = 1 โฟลเดอร์
2. Source Code ของงานนั้นอยู่ในโฟลเดอร์ของงานนั้น
3. Test ของงานนั้นอยู่ใต้โฟลเดอร์งานนั้น (none exist yet — no real logic to test)
4. ห้ามรวมหลายหน้าที่ไว้ในไฟล์ใหญ่ไฟล์เดียว
5. ห้ามสร้าง `utils/`, `helpers/`, `services/` เป็นที่โยนโค้ดรวม
6. Shared Code ต้องมีผู้ใช้จริงมากกว่า 1 หน้างาน (e.g. `contracts/identity/envelope-identity.ts`, used by both `contracts/command/` and `contracts/event/`)
7. ทุกโฟลเดอร์มี README: หน้าที่ / Input / Output / Dependency ที่อนุญาต / สิ่งที่ห้ามแตะ
8. Capability ที่ยังไม่มีจริงระบุ `NOT_YET_BUILT`
9. ห้ามสร้างข้อมูลธุรกิจจำลองเพื่อเติมโครง
10. ห้ามเพิ่ม Database/Migration ของ Business Data ใน repo นี้

**กฎถาวรเพิ่มเติม (Owner, 2026-08-14, รอบ 2):** ทุก Capability/Function/
Module ใหม่ต้องมี Capability Folder ของตัวเองก่อนสร้าง source file ใดๆ
เสมอ — ห้ามสร้างไฟล์ก่อนแล้วค่อยจัดโฟลเดอร์ทีหลังไม่ว่ากรณีใด ต้องตรวจ
duplicate/overlapping capability ก่อนสร้างใหม่ทุกครั้ง และ capability หนึ่ง
ต้องแก้/ย้าย/test/assign/rollback/ตรวจ dependency/ลบ ได้ "เป็นโฟลเดอร์
เดียว" เสมอ ข้อความเต็มพร้อม Governance Gate อยู่ที่
[`governance/architecture-rules/CAPABILITY_FOLDER_LAW.md`](governance/architecture-rules/CAPABILITY_FOLDER_LAW.md)
— **LOCKED, บังคับกับคน/AI agent/เครื่องมือทุกตัวที่แตะ repo นี้**

## Boundary rule — Operational vs Infrastructure

`dna-os-deadboard` (Operational) and this repo (Infrastructure) connect
only through `contracts/operational-bridge/`. No direct database
dependency in either direction. The service that owns a database may
access its own database directly (Operational still queries its own
Supabase directly, that's its own data) — what's forbidden is any OTHER
domain, UI, AI, or external software reaching across that boundary.

DNA OS's own business is not one "Operational Account" — it is made of
multiple real Business Domains, each its own scope. Control/Infrastructure
(this repo) is not a peer to any Business Domain and is not counted as
one — it's the layer every domain (business or external) connects
through, never a member of the set it governs.

## Identity / Account / Tenant model — see `permissions/` and `contracts/identity/`

The wire-level identity shape (`EnvelopeIdentity`, `IdentityKind`) lives in
`contracts/identity/envelope-identity.ts` — a zero-dependency base
contract. `permissions/access-control/identity.ts`'s full `Identity`
record imports `IdentityKind` from there, never redefines it. Membership
(`permissions/access-control/membership.ts`) is the only mechanism
granting an Identity a role inside an Account, Tenant, or Workspace — one
Identity can hold many Memberships. Account
(`permissions/software-scope/account.ts`) is only an ownership boundary —
never assumed to equal a Business Domain or a piece of Software; those are
resources an Account can be granted
(`permissions/software-scope/resource-grant.ts`). Account<->Tenant is an
explicit relationship (`permissions/software-scope/account-tenant-assignment.ts`),
not a hardcoded 1:1 field. Every entity's registration/assignment record
is its own file, separate from the entity's own type definition —
`identity.ts`/`identity-registry.ts` is the template every other entity
(`account.ts`/`account-registration.ts`,
`tenant.ts`/`tenant-registration.ts`,
`software.ts`/`software-registration.ts`) follows the same way.

## Dependency direction (Owner, 2026-08-14, corrected)

`contracts/` has ZERO dependency on `permissions/` — it defines message
shapes only, and knows nothing about who's allowed to send them.
`permissions/` MAY depend on `contracts/` (e.g. `scope-check.ts` reads a
`CommandEnvelope`'s shape to check it). Never the reverse. This is why
`EnvelopeIdentity` lives in `contracts/identity/`, not in
`permissions/access-control/` — it's a message-shape concern `contracts/`
needs internally (both `contracts/command/` and `contracts/event/` use
it), not a permissions concern.

## TASK-172 (dna-os-deadboard)

Frozen legacy/pending-migration in that repo's own `registry/TASK_QUEUE.json`.
Not extended. Not moved here yet — moving real source code is a separate,
explicitly-scoped future step.

Status of every module: see each folder's own README — this file is an
index, not a duplicate source of truth.

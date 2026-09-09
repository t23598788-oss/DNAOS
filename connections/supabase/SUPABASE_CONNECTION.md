# DNA OS ↔ Supabase Project Connection

Canonical document ID: `connection.supabase.dna-os-project.v1`

This is the human/developer projection of [connection-document.json](./connection-document.json). The JSON record is authoritative; the Connection Index projects it and does not maintain an independent status registry.

## สถานะสรุป

สถานะรวมคือ `CONNECTED` ไม่ใช่ `VERIFIED` เพราะ DNA OS มี project identity, credential references และ implementation contracts จริง แต่หลักฐาน live ยังไม่ครบทุก boundary

| Boundary | Status | ความหมาย |
|---|---|---|
| Supabase project identity | `CONNECTED` | project ref ถูก pin และมี provider/declaration record |
| PostgreSQL software_registry target | `NOT_WIRED` | ไม่มี production database credential reference ที่ persist อยู่ใน registry |
| Management API schema-read | `CONNECTED` | credential reference ผ่าน Owner biometric verification และมี guard/read-only contract แต่ไม่มี live query result ที่บันทึกไว้ |
| PostgREST application data path | `NOT_VERIFIED` | มี callers จริง แต่ไม่มี authenticated success evidence ในชุดหลักฐานนี้ |
| provider-alert-email-read Edge Function | `VERIFIED` | มีหลักฐาน live authenticated call ผ่าน DNA OS caller |
| line-webhook-v2 Edge Function | `CONNECTED` | มี deployed/source/declaration evidence แต่ไม่มี end-to-end live evidence ในชุดนี้ |
| Supabase Auth | `NOT_VERIFIED` | มี SSR/session callers จริง แต่ไม่มี live Auth proof ในชุดนี้ |
| Edge secret provisioning | `NOT_VERIFIED` | source, allowlist และ active reference มีจริง แต่ไม่มี install/verify result record |
| DNA OS sensor PostgREST RPC sink | `NOT_VERIFIED` | source และ migration มีจริง แต่ sink เป็น optional และไม่มี live success evidence |

## ข้อมูลเดินทางอย่างไร

Supabase project `xeytcavxejhyzxwevgto` เป็น external software/data boundary ไม่ใช่ registry ใหม่ของ DNA OS

1. DNA OS resolves a named credential/reference through Keychain or the application environment.
2. The caller selects one bounded contract: Postgres provider, Management API metadata read, PostgREST client, Edge Function call, Auth session, secret provisioning, or sensor RPC sink.
3. The boundary applies its own gate: project pinning, Owner authorization, SQL guard, RLS, function signature/shared-secret check, Process Gate argv allowlist, or optional-sink fail-closed behavior.
4. The caller receives typed data/error output. No secret value is returned, logged, indexed, or included in evidence.

## Authority and security

- Project identity comes from the pinned `SUPABASE_PRODUCTION_PROJECT_REF` and existing provider/connection declarations.
- Supabase Auth establishes sessions; application identity/membership resolution and database RLS determine application authority.
- Browser clients use anon/Auth references and remain RLS-bound.
- Membership resolution is server-only and refuses to fall back from `SUPABASE_SERVICE_ROLE_KEY` to anon because that would turn “database unavailable” into “no memberships.”
- Edge Functions use platform environment references and function-specific gates. `line-webhook-v2` validates `x-line-signature`; `provider-alert-email-read` is called through a Keychain-resolved shared secret.
- Secret provisioning only accepts the allowlisted `PROVIDER_ALERT_EMAIL_READ_SECRET`; the generated plaintext is transient, never placed in argv, and the temporary 0600 env file is removed in `finally`.
- The DNA OS sensor sink never controls local operation: local JSONL evidence is written first, and missing sink configuration/outage does not break the collector.

## Evidence boundary

The strongest live evidence currently available is the authenticated `provider-alert-email-read` call referenced by the owner-backbone live probe and joint evidence. The remaining `CONNECTED`, `NOT_VERIFIED`, and `NOT_WIRED` labels are intentionally conservative. Source code, an active credential reference, a declaration, or a deployment reference alone does not promote a boundary to `VERIFIED`.

## DNA OS MCP path (reuse — no Supabase logic in MCP)

```text
AI Client
  → DNA OS MCP (dna_os.list_remote_services / dna_os.get_remote_service_capabilities / dna_os.get_capability_binding_status)
  → DNA OS tool grant + local-resource-access gate
  → REMOTE_SERVICE_CAPABILITY_BINDING_V1 service://database/schema-read
  → connection.supabase.dna-os-project.v1
  → credential://supabase/<project_ref>/schema-read (Keychain pointer)
  → connections/supabase-schema-read (read-only metadata)
```

MCP must not hold tokens, query the provider directly, or embed provider business logic.

### Official remote MCP (DNA OS owned, not client-direct)

- URL: `https://mcp.supabase.com/mcp`
- Default posture: `project_scoped=true`, `read_only=true`, features limited to `database,docs`
- Clients do **not** receive this remote as a direct tool; DNA OS remains ingress authority.

## Human-readable and machine-readable paths

- Human document: `connections/supabase/SUPABASE_CONNECTION.md`
- Machine semantic record: `connections/supabase/connection-document.json`
- Index projection: `connections/connection-index/INDEX.md`
- Machine index: `connections/connection-index/index.json`

# RUNTIME_RESOURCE_MAP.md

**Note:** Read-only audit - no load tests/metrics pulled live. Based on codebase patterns and deployment files.

| Component | Runtime Location (inferred) | Type (24/7 or on-demand) | Resources | Cost/Quota | Risk | Evidence |
|---|---|---|---|---|---|---|
| Next.js App (Web/API) | Vercel/Railway (per reports/config) | 24/7 or scaled | CPU/RAM/Network per platform limits | Variable (hosting) | Platform dependency | package.json, next config, deployment reports |
| Supabase (DB/Auth/Storage) | Supabase Cloud | 24/7 | DB connections, storage, RLS | Tiered/quota-based | DB is SPOF for data layer | supabase/*, services/supabase/* |
| Edge Functions | Supabase Edge Functions | On-demand | Invocation limits | Quota-based | Webhook/integration paths | supabase/functions/* |
| LINE OA Webhooks | External + Edge/Route handlers | On-demand | Rate limits from LINE | Provider limits | External dependency | supabase/functions/line-webhook-v2/* |
| AI Providers | Configured via env/registry | On-demand | API quotas/rate limits/cost | Variable per provider | Cost control needed | registry/*, core/runtime/* |
| Background Jobs/Queues | Inferred (scripts/workers) | Mixed | Varies | Varies | No load test data | scripts/*, local-runtime/* |

**Caveat:** No concrete metrics/capacity numbers available from source alone; requires live telemetry.

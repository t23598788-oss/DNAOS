# ENGINEERING_RISK_REGISTER.md

| Risk | Severity | Evidence | Impact | Proposed Resolution | Dependency | Owner |
|---|---|---|---|---|---|---|
| Backup restore not fully hash-verified across all sources | HIGH | 64 backup refs exist; full file hash diff not completed | Cannot guarantee byte-for-byte restore of every untracked set | Run full manifest with hashes against restored checkouts | Time/space for full diff | Eng Lead |
| Payment provider connectivity unverified for real transactions | HIGH | Reports state not fully verified | Revenue/collections flow may not be live end-to-end | Verify provider config, webhooks, test with safe sandbox/real path validation | Provider creds/access | Eng Lead/Finance Ops |
| Documents/Finance E2E incomplete | HIGH | CAPABILITY_MATRIX marks PARTIAL/UNVERIFIED | Invoices/payments/accounting not fully proven | Complete E2E trace with canonical writers + audit trail | DB access + test data | Eng Lead |
| Secrets exposure risk | CRITICAL | .env.local files exist locally (gitignored) | Credential leakage if mishandled | Never commit .env*; use secret manager; audit before sharing | Process discipline | Eng Lead/Sec |
| Single points of failure (Supabase/hosting) | HIGH | Central DB/hosting inferred | Outage impact | Review backups/DR, failover, monitoring | Infra access | Eng Lead/Infra |
| Large complex webhook/LINE paths | MEDIUM | supabase/functions/line-webhook-v2/* complex | Hard to debug/change safely | Add tests/traceability, avoid modifying without audit | Time | Eng Team |
| Unsafe invoice auto-create was possible (now rolled back) | HIGH (mitigated) | Historical memory + rollback confirmed | Must ensure no regression | Keep canonical writers enforced, add guards/tests | Discipline | Eng Lead |

No destructive changes made during audit.

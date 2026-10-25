# DNA OS CTO HANDOVER INDEX

## Archive Location
- Path: /Users/tam/Desktop/ระบบธุรกิจ/dna-os-work/cto-handover-archive/2026-10-25/
- Date: 2026-10-25
- Hash Manifest: HASH_MANIFEST.sha256

## Handover Documents (in order of reading)
1. NEW_CTO_HANDOVER.md - Start here (quick start, priorities, rules)
2. SOURCE_BACKUP_MANIFEST.md - All backup locations/refs/SHA
3. RESTORE_VERIFICATION.md - Restore test results & gaps
4. SYSTEM_ARCHITECTURE.md - Module map & boundaries
5. DATA_FLOW_AND_FINANCE.md - Data/finance flow & canonical paths
6. RUNTIME_RESOURCE_MAP.md - Runtime locations/resources (inferred)
7. CAPABILITY_MATRIX.md - Proven vs unverified capabilities
8. ENGINEERING_RISK_REGISTER.md - Risks, mitigations, owners

## GitHub Backup
- Repo: t23598788-oss/---------------DNA-OS (private)
- Backup refs: 64 (under refs/heads/backup/*)
- Baseline SHA (release-wt): d60f1b047b397a8cae9def1b15b20347cfdebcb4
- WIP snapshot: backup/release-wt/wip-uncommitted-d60f1b04-20261025 (b9ceb2bf)
- Untracked snapshots: backup/*/untracked-snapshot-*

## Critical Notes
- Canonical writers are authority for finance/documents/transactions - do not bypass
- Tenant isolation enforced via authority/scope
- Unsafe invoice auto-create was rolled back - must not reintroduce
- Payment provider connectivity for real transactions not fully verified
- Documents/payments/accounting E2E not fully verified
- Full hash verification of all untracked sets not completed in this audit

## Restore Quick Start
```bash
git clone https://github.com/t23598788-oss/---------------DNA-OS.git
git fetch origin 'refs/heads/backup/*:refs/remotes/origin/backup/*'
# Checkout needed backup ref
```

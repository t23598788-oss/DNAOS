-- One append-only record for source, migration, test, and deployment evidence.
-- Do not store credentials, customer data, or commercial amounts in this ledger.

CREATE TABLE public.development_work_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  event_type text NOT NULL
    CHECK (event_type IN (
      'source_committed',
      'test_completed',
      'migration_applied',
      'deployment_verified',
      'rollback_recorded'
    )),
  repository text NOT NULL,
  branch text,
  commit_sha text
    CHECK (commit_sha IS NULL OR commit_sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  migration_version text,
  migration_sha256 text
    CHECK (migration_sha256 IS NULL OR migration_sha256 ~ '^[0-9a-f]{64}$'),
  environment text NOT NULL
    CHECK (environment IN ('development', 'staging', 'production')),
  outcome text NOT NULL
    CHECK (outcome IN ('pass', 'fail', 'conflict', 'unverified', 'not_applicable')),
  actor_kind text NOT NULL CHECK (actor_kind IN ('human', 'automation')),
  actor_ref text NOT NULL,
  approver_ref text,
  approved_at timestamptz,
  evidence_refs text[] NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT development_work_ledger_migration_hash_pair
    CHECK ((migration_version IS NULL) = (migration_sha256 IS NULL)),
  CONSTRAINT development_work_ledger_production_approval
    CHECK (
      environment <> 'production'
      OR event_type NOT IN ('migration_applied', 'deployment_verified')
      OR (approver_ref IS NOT NULL AND approved_at IS NOT NULL)
    )
);

COMMENT ON TABLE public.development_work_ledger IS
  'Append-only provenance for code commits, verification, migrations, and deployments. Never store credentials, user data, or commercial amounts.';

CREATE INDEX development_work_ledger_repo_commit_idx
  ON public.development_work_ledger (repository, commit_sha, occurred_at DESC);
CREATE INDEX development_work_ledger_migration_idx
  ON public.development_work_ledger (migration_version, environment, occurred_at DESC)
  WHERE migration_version IS NOT NULL;

ALTER TABLE public.development_work_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.development_work_ledger FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.development_work_ledger FROM service_role;
GRANT SELECT ON public.development_work_ledger TO authenticated;
GRANT SELECT, INSERT ON public.development_work_ledger TO service_role;

CREATE POLICY development_work_ledger_admin_read
  ON public.development_work_ledger FOR SELECT TO authenticated
  USING ((SELECT public.is_platform_admin()));

CREATE FUNCTION public.reject_development_work_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'development_work_ledger is append-only';
END;
$$;

REVOKE ALL ON FUNCTION public.reject_development_work_ledger_mutation() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER development_work_ledger_no_update_delete
  BEFORE UPDATE OR DELETE ON public.development_work_ledger
  FOR EACH ROW EXECUTE FUNCTION public.reject_development_work_ledger_mutation();

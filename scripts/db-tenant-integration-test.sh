#!/usr/bin/env bash
# Local PostgreSQL integration test (2026-10-20). Isolated by construction:
#  - throwaway cluster in a mktemp dir, unix socket only, port 54399 (NOT Supabase 54322 / 54320 / 54329)
#  - refuses to run if any production/connection variable is set in this shell
#  - REAL migrations loaded verbatim: 20261018000001_tenant_core_v1.sql and
#    20261019000001_org_members_rls_recursion_fix.sql
#  - SHIMS (only what Supabase provides, nothing else): schema auth + auth.users + auth.uid(),
#    roles anon/authenticated/service_role (service_role has BYPASSRLS, as in Supabase),
#    replica tables companies and business_events (columns used by the RPC; see note below)
#  - DRAFTS loaded from supabase/drafts/ (not applied to any migration folder)
# Exit status is the real result of the run. Failures are counted and reported.
set -u

for v in DATABASE_URL SUPABASE_DB_URL SUPABASE_URL NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY; do
  if [ -n "${!v:-}" ]; then echo "REFUSED: $v is set; integration test must not touch a configured database"; exit 2; fi
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="$(dirname "$(command -v pg_ctl)")"
DATA="$(mktemp -d /tmp/dna-pg-tenant.XXXXXX)"
PORT=54399
DB=dna_os_isolated_tenant
FAILS=0; OKS=0
ok()   { echo "  ok   $1"; OKS=$((OKS+1)); }
bad()  { echo "  FAIL $1"; FAILS=$((FAILS+1)); }

cleanup() { "$PGBIN/pg_ctl" -D "$DATA/cluster" stop -m fast >/dev/null 2>&1; rm -rf "$DATA"; }
trap cleanup EXIT

"$PGBIN/initdb" -D "$DATA/cluster" -U dnatest -A trust >/dev/null 2>&1 || { echo "initdb failed"; exit 1; }
"$PGBIN/pg_ctl" -D "$DATA/cluster" -l "$DATA/server.log" -o "-p $PORT -k $DATA -c listen_addresses=''" start >/dev/null 2>&1 \
  || { echo "pg_ctl start failed"; cat "$DATA/server.log"; exit 1; }
PSQL=(psql -h "$DATA" -p "$PORT" -U dnatest -X -q -t -A -v ON_ERROR_STOP=1)
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $DB;" >/dev/null || { echo "createdb failed"; exit 1; }
SU() { "${PSQL[@]}" -d "$DB" -c "$1"; }
FILE() { "${PSQL[@]}" -d "$DB" -f "$1"; }

# ---- 1. Supabase-provided shims (auth schema, roles) ------------------------
SU "CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS \$\$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid \$\$;
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;" >/dev/null || { bad "shim setup"; exit 1; }
# Supabase default privileges: table grants are broad; RLS and the RPC checks are the real gates.
# This matches Supabase's default grants, so RLS (not a missing GRANT) is what gets tested.

# ---- 2. Replica tables that the real migrations reference -------------------
# companies: only columns the real tenant migrations touch. Not the production DDL.
SU "CREATE TABLE public.companies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);" >/dev/null
# company_line_links and partner_id: replica of the evidence columns the legacy inventory reads.
# Not the production DDL (partner_id in production references a different table; see inventory notes).
SU "CREATE TABLE public.company_line_links (line_user_id text PRIMARY KEY, company_id uuid REFERENCES public.companies(id));" >/dev/null
# business_events: the columns the tenant draft and RPC touch, with the REAL service-role-only
# policy from 20260710000001 (RLS on, policy 'service_role_only' using (false)). Not the production DDL.
SU "CREATE TABLE public.business_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_code text UNIQUE,
      status text NOT NULL DEFAULT 'new',
      title text, description text,
      context jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE public.business_events ENABLE ROW LEVEL SECURITY;
    CREATE POLICY service_role_only ON public.business_events FOR ALL USING (false);
    GRANT SELECT, INSERT, UPDATE ON public.business_events TO anon, authenticated, service_role;" >/dev/null

# ---- 3. REAL tenant migrations, verbatim ------------------------------------
FILE "$ROOT/supabase/migrations/20261018000001_tenant_core_v1.sql" >/tmp/dna-real-core.log 2>&1 \
  && ok "real 20261018000001_tenant_core_v1.sql loads" || { bad "real 20261018000001 failed to load (see /tmp/dna-real-core.log)"; tail -5 /tmp/dna-real-core.log; }
FILE "$ROOT/supabase/migrations/20261019000001_org_members_rls_recursion_fix.sql" >/tmp/dna-real-fix.log 2>&1 \
  && ok "real 20261019000001_org_members_rls_recursion_fix.sql loads" || { bad "real 20261019000001 failed to load (see /tmp/dna-real-fix.log)"; tail -5 /tmp/dna-real-fix.log; }

# ---- 4. Drafts (not applied to migrations) ----------------------------------
FILE "$ROOT/supabase/drafts/business_events_tenant_scope.DRAFT.sql" >/tmp/dna-draft-scope.log 2>&1 \
  && ok "draft tenant scope loads" || { bad "draft tenant scope failed"; tail -5 /tmp/dna-draft-scope.log; }
FILE "$ROOT/supabase/drafts/business_event_enrich_transition.DRAFT.sql" >/tmp/dna-draft-rpc.log 2>&1 \
  && ok "draft atomic RPC + trace lookup loads" || { bad "draft RPC failed"; tail -5 /tmp/dna-draft-rpc.log; }

# Failure injector for the rollback case (simulates a DB-side failure in the transition step).
SU "CREATE FUNCTION public.fail_on_boom() RETURNS trigger LANGUAGE plpgsql AS \$\$
    BEGIN IF NEW.status = 'boom' THEN RAISE EXCEPTION 'injected transition failure'; END IF; RETURN NEW; END \$\$;
    CREATE TRIGGER trg_fail BEFORE UPDATE ON public.business_events FOR EACH ROW EXECUTE FUNCTION public.fail_on_boom();" >/dev/null

# ---- 5. Fixtures (superuser) ------------------------------------------------
UA=00000000-0000-0000-0000-00000000000a   # owner of org A
UB=00000000-0000-0000-0000-00000000000b   # member of org B only
UX=00000000-0000-0000-0000-00000000000c   # no organization at all
OA=aaaaaaaa-0000-0000-0000-00000000000a
OB=bbbbbbbb-0000-0000-0000-00000000000b
EA=eeeeeeee-0000-0000-0000-00000000000a   # event in org A, trace trace-A
EB=eeeeeeee-0000-0000-0000-00000000000b   # event in org B, trace trace-B
EN=eeeeeeee-0000-0000-0000-0000000000cc   # event with NO organization, trace trace-N
EC=eeeeeeee-0000-0000-0000-0000000000dd   # event for concurrency, org A
SU "INSERT INTO auth.users (id) VALUES ('$UA'),('$UB'),('$UX');
INSERT INTO public.organizations (id, name, created_by) VALUES ('$OA','Org A','$UA'),('$OB','Org B','$UB');
INSERT INTO public.org_members (organization_id, user_id, role) VALUES ('$OA','$UA','owner'),('$OB','$UB','member');
INSERT INTO public.business_events (id, status, title, context, organization_id) VALUES
  ('$EA','awaiting_info','A old','{\"trace_id\":\"trace-A\"}','$OA'),
  ('$EB','awaiting_info','B old','{\"trace_id\":\"trace-B\"}','$OB'),
  ('$EN','awaiting_info','N old','{\"trace_id\":\"trace-N\"}',NULL),
  ('$EC','awaiting_info','C old','{\"trace_id\":\"trace-C0\"}','$OA');" >/dev/null 2>/tmp/dna-fixture.log \
  || { bad "fixtures"; cat /tmp/dna-fixture.log; }

ALLOWED="ARRAY['awaiting_info','quotation_pending','ready_to_quote','boom']"
# An empty actor is passed as SQL NULL, so the database (not bash) decides what an absent actor means.
SQLVAL() { if [ -z "$1" ]; then echo NULL; else echo "'$1'"; fi; }
RPC() { # actor_user_id event_id fields_json to_status trace
  echo "SELECT public.dna_enrich_and_transition_event($(SQLVAL "$1"),'$2','$3','$4',$ALLOWED,'$5');"
}
# Run as a role with a JWT subject. Set the role first, then the claim.
AS() { # role sub sql
  SU "SET ROLE $1; DO \$\$ BEGIN PERFORM set_config('request.jwt.claim.sub', '$2', false); END \$\$; $3"
}
TITLE_STATUS() { SU "SELECT status || '|' || COALESCE(title,'') FROM public.business_events WHERE id='$1';"; }

echo "Local tenant integration (cluster $DATA, port $PORT, db $DB)"

# ---- ATOMIC COMMIT ----------------------------------------------------------
OUT=$(AS service_role "$UA" "$(RPC $UA $EA '{"title":"A new"}' quotation_pending trace-A1)" 2>&1); st=$?
[ $st -eq 0 ] && [ "$(TITLE_STATUS $EA)" = "quotation_pending|A new" ] && ok "commit: owner of org A enriches and transitions atomically" || bad "commit: st=$st $(TITLE_STATUS $EA) $OUT"

# ---- ATOMIC ROLLBACK --------------------------------------------------------
SU "UPDATE public.business_events SET title='A old', status='awaiting_info' WHERE id='$EA';" >/dev/null
OUT=$(AS service_role "$UA" "$(RPC $UA $EA '{"title":"should vanish"}' boom trace-A2)" 2>&1); st=$?
if [ $st -ne 0 ] && [ "$(TITLE_STATUS $EA)" = "awaiting_info|A old" ]; then ok "rollback: transition failure undoes enrich ($(TITLE_STATUS $EA))"; else bad "rollback: st=$st state=$(TITLE_STATUS $EA)"; fi

# ---- DUPLICATE REQUEST ------------------------------------------------------
AS service_role "$UA" "$(RPC $UA $EA '{"title":"first"}' ready_to_quote trace-D1)" >/dev/null 2>&1
DUP=$(AS service_role "$UA" "$(RPC $UA $EA '{"title":"second, must not apply"}' quotation_pending trace-D1)" 2>&1)
[ "$(TITLE_STATUS $EA)" = "ready_to_quote|first" ] && echo "$DUP" | grep -q '"duplicate": *true' \
  && ok "duplicate: same trace applied once, second call is a no-op" || bad "duplicate: state=$(TITLE_STATUS $EA) out=$DUP"

# ---- TENANT ISOLATION / CROSS-TENANT DENIAL (inside the RPC) -----------------
BEFORE=$(TITLE_STATUS $EA)
OUT=$(AS service_role "$UB" "$(RPC $UB $EA '{"title":"cross"}' quotation_pending trace-X1)" 2>&1); st=$?
[ $st -ne 0 ] && echo "$OUT" | grep -q TENANT_DENIED && [ "$(TITLE_STATUS $EA)" = "$BEFORE" ] \
  && ok "cross-tenant: member of org B denied on org A event, row unchanged" || bad "cross-tenant: st=$st out=$OUT"

OUT=$(AS service_role "$UX" "$(RPC $UX $EA '{"title":"nomember"}' quotation_pending trace-X2)" 2>&1); st=$?
[ $st -ne 0 ] && echo "$OUT" | grep -q TENANT_DENIED && [ "$(TITLE_STATUS $EA)" = "$BEFORE" ] \
  && ok "non-member: user with no organization denied, row unchanged" || bad "non-member: st=$st out=$OUT"

OUT=$(AS service_role "$UA" "$(RPC $UA $EN '{"title":"unscoped"}' quotation_pending trace-X3)" 2>&1); st=$?
[ $st -ne 0 ] && echo "$OUT" | grep -q TENANT_UNSCOPED_EVENT && ok "unscoped event (organization_id NULL) denied: fail-closed" || bad "unscoped: st=$st out=$OUT"

OUT=$(AS service_role "" "$(RPC '' $EA '{"title":"x"}' quotation_pending trace-X4)" 2>&1); st=$?
[ $st -ne 0 ] && echo "$OUT" | grep -q ACTOR_REQUIRED && ok "missing actor refused" || bad "missing actor: st=$st out=$OUT"

OUT=$(AS service_role "$UA" "$(RPC $UA $EA '{"title":"x"}' paid-by-ai trace-X5)" 2>&1); st=$?
[ $st -ne 0 ] && echo "$OUT" | grep -q EVENT_UNKNOWN_STATE && ok "unknown state refused" || bad "unknown state: st=$st out=$OUT"

OUT=$(AS service_role "$UA" "$(RPC $UA $EA '{"title":"x"}' quotation_pending '  ')" 2>&1); st=$?
[ $st -ne 0 ] && echo "$OUT" | grep -q TRACE_ID_REQUIRED && ok "empty trace refused" || bad "empty trace: st=$st out=$OUT"

OUT=$(AS service_role "$UA" "$(RPC $UA 00000000-0000-0000-0000-0000000000ff '{"title":"x"}' quotation_pending trace-X6)" 2>&1); st=$?
[ $st -ne 0 ] && echo "$OUT" | grep -q EVENT_NOT_FOUND && ok "unknown event id refused" || bad "unknown event: st=$st out=$OUT"

# ---- UNAUTHORIZED DATABASE ROLE --------------------------------------------
for R in anon authenticated; do
  OUT=$(AS $R "$UA" "$(RPC $UA $EA '{"title":"role"}' quotation_pending trace-R-$R)" 2>&1); st=$?
  [ $st -ne 0 ] && echo "$OUT" | grep -qi "permission denied" && ok "unauthorized role $R cannot execute the RPC" || bad "role $R executed RPC: st=$st out=$OUT"
done

# ---- TRACE LOOKUP (membership-scoped) --------------------------------------
lookup() { SU "SELECT id FROM public.dna_find_events_by_trace($(SQLVAL "$1"),'$2');"; }
[ "$(lookup $UA trace-A)" = "$EA" ] && ok "trace lookup: owner finds own org's record" || bad "trace lookup owner: '$(lookup $UA trace-A)'"
[ -z "$(lookup $UB trace-A)" ] && ok "trace lookup: cross-tenant trace returns nothing" || bad "trace lookup leaks: '$(lookup $UB trace-A)'"
[ -z "$(lookup $UX trace-A)" ] && ok "trace lookup: non-member returns nothing" || bad "trace lookup non-member leak"
[ -z "$(lookup $UA trace-N)" ] && ok "trace lookup: unscoped event not returned" || bad "trace lookup unscoped leak"
[ -z "$(lookup '' trace-A)" ] && ok "trace lookup: no actor returns nothing" || bad "trace lookup no-actor leak"
[ -z "$(lookup $UA '   ')" ] && ok "trace lookup: empty trace returns nothing" || bad "trace lookup empty trace leak"
[ -z "$(lookup $UA trace-unknown)" ] && ok "trace lookup: unknown trace returns nothing" || bad "trace lookup unknown leak"
OUT=$(AS anon "$UA" "SELECT count(*) FROM public.dna_find_events_by_trace('$UA','trace-A');" 2>&1); st=$?
[ $st -ne 0 ] && echo "$OUT" | grep -qi "permission denied" && ok "trace lookup: anon denied at EXECUTE" || bad "trace lookup anon: st=$st out=$OUT"

# ---- RLS (read policy on business_events) -----------------------------------
[ "$(AS authenticated "$UA" "SELECT count(*) FROM public.business_events;")" = "2" ] \
  && ok "RLS: owner of org A sees exactly its 2 org-A events (EA, EC)" || bad "RLS owner count: $(AS authenticated "$UA" "SELECT count(*) FROM public.business_events;" 2>&1)"
[ "$(AS authenticated "$UB" "SELECT string_agg(id::text, ',') FROM public.business_events;")" = "$EB" ] \
  && ok "RLS: member of org B sees only its own event" || bad "RLS org B leak"
[ "$(AS authenticated "$UX" "SELECT count(*) FROM public.business_events;")" = "0" ] \
  && ok "RLS: user with no organization sees zero rows (fail-closed)" || bad "RLS non-member leak"
[ "$(AS anon "$UA" "SELECT count(*) FROM public.business_events;")" = "0" ] \
  && ok "RLS: anon sees zero rows" || bad "RLS anon leak"
[ "$(SU "SELECT count(*) FROM public.business_events;")" = "4" ] && ok "service_role/superuser bypass keeps all rows (Supabase semantics)" || bad "bypass count"

# RLS parity: the policies that must exist on business_events.
POL=$(SU "SELECT string_agg(policyname, ',' ORDER BY policyname) FROM pg_policies WHERE schemaname='public' AND tablename='business_events';")
[ "$POL" = "business_events_select_member,service_role_only" ] && ok "RLS policies on business_events: $POL" || bad "RLS policy set: $POL"

# ---- CONCURRENT REQUESTS (row lock serialises writers) ----------------------
S1_START=$(date +%s%N)
( "${PSQL[@]}" -d "$DB" -c "SET ROLE service_role; DO \$\$ BEGIN PERFORM set_config('request.jwt.claim.sub','$UA',false); END \$\$; BEGIN; $(RPC $UA $EC '{"title":"first writer"}' ready_to_quote trace-C1) SELECT pg_sleep(2); COMMIT;" >/tmp/dna-c1.log 2>&1; echo $? > /tmp/dna-c1.st ) &
sleep 0.5
S2_START=$(date +%s%N)
"${PSQL[@]}" -d "$DB" -c "SET ROLE service_role; DO \$\$ BEGIN PERFORM set_config('request.jwt.claim.sub','$UA',false); END \$\$; $(RPC $UA $EC '{"title":"second writer"}' quotation_pending trace-C2)" >/tmp/dna-c2.log 2>&1; S2_ST=$?
S2_END=$(date +%s%N)
wait
S1C=$(cat /tmp/dna-c1.st 2>/dev/null)
WAIT_MS=$(( (S2_END - S2_START) / 1000000 ))
FINAL=$(SU "SELECT status || '|' || title || '|' || (context->>'last_trace_id') FROM public.business_events WHERE id='$EC';")
if [ "$S1C" = "0" ] && [ $S2_ST -eq 0 ] && [ $WAIT_MS -ge 1000 ] && [ "$FINAL" = "quotation_pending|second writer|trace-C2" ]; then
  ok "concurrency: second writer waited ${WAIT_MS}ms for the row lock; final state consistent ($FINAL)"
else
  bad "concurrency: s1=$S1C s2=$S2_ST waited=${WAIT_MS}ms final=$FINAL"
fi

# ---- MULTI-ORGANIZATION USER (member of A and B) --------------------------
# UM is a member of both orgs. Each event is still checked against its OWN organization.
UM=00000000-0000-0000-0000-00000000000d
SU "INSERT INTO auth.users (id) VALUES ('$UM'); INSERT INTO public.org_members (organization_id, user_id, role) VALUES ('$OA','$UM','member'),('$OB','$UM','member');" >/dev/null
OUT=$(AS service_role "$UM" "$(RPC $UM $EB '{"title":"multi on B"}' ready_to_quote trace-M1)" 2>&1); st=$?
[ $st -eq 0 ] && [ "$(TITLE_STATUS $EB)" = "ready_to_quote|multi on B" ] && ok "multi-org: member of A and B can write B's event" || bad "multi-org B: st=$st out=$OUT"
OUT=$(AS service_role "$UM" "$(RPC $UM $EA '{"title":"multi on A"}' ready_to_quote trace-M2)" 2>&1); st=$?
[ $st -eq 0 ] && ok "multi-org: same user can write A's event (membership checked per event)" || bad "multi-org A: st=$st out=$OUT"

# ---- SERVICE_ROLE TENANT TAMPERING -----------------------------------------
# The RPC takes NO organization argument. A body that claims another tenant only changes
# fields in the allow-list (title, description). organization_id is never written.
BEFORE_ORG=$(SU "SELECT organization_id FROM public.business_events WHERE id='$EB';")
OUT=$(AS service_role "$UX" "$(RPC $UX $EB '{"title":"tamper","organization_id":"'$OA'"}' quotation_pending trace-T1)" 2>&1); st=$?
[ $st -ne 0 ] && echo "$OUT" | grep -q TENANT_DENIED && ok "tamper: non-member cannot reach org B's event by claiming org A in the body" || bad "tamper deny: st=$st out=$OUT"
OUT=$(AS service_role "$UM" "$(RPC $UM $EB '{"organization_id":"'$OA'","title":"tamper2"}' quotation_pending trace-T2)" 2>&1); st=$?
[ $st -eq 0 ] && [ "$(SU "SELECT organization_id FROM public.business_events WHERE id='$EB';")" = "$BEFORE_ORG" ] && ok "tamper: organization_id in the body is ignored; stored tenant unchanged" || bad "tamper write: st=$st out=$OUT"

# ---- LEGACY EVENTS (organization_id NULL) ----------------------------------
# Legacy rows must never be opened to tenants by the RPC or the trace lookup.
LEG_UNSCOPED=$(SU "SELECT count(*) FROM public.business_events WHERE organization_id IS NULL;")
[ "$LEG_UNSCOPED" -ge 1 ] && ok "legacy: unscoped rows exist in the fixture ($LEG_UNSCOPED)" || bad "legacy fixture missing"
OUT=$(AS service_role "$UM" "$(RPC $UM $EN '{"title":"legacy"}' quotation_pending trace-L1)" 2>&1); st=$?
[ $st -ne 0 ] && echo "$OUT" | grep -q TENANT_UNSCOPED_EVENT && ok "legacy: unscoped event refused even for a member of every org" || bad "legacy write: st=$st out=$OUT"
[ -z "$(lookup $UM trace-N)" ] && ok "legacy: trace lookup does not return unscoped events" || bad "legacy trace leak"

# Synthetic legacy evidence for the inventory. CO_A belongs to org A; CO_N belongs to no org.
#   L1: no organization, LINE user linked to CO_A         -> derivable_line_link
#   L2: no organization, partner CO_N (no org)            -> unidentified
#   L3: no organization, no link, no partner              -> unidentified
CO_A=cccccccc-0000-0000-0000-00000000000a
CO_N=cccccccc-0000-0000-0000-00000000000b
L1=eeeeeeee-0000-0000-0000-0000000000a1
L2=eeeeeeee-0000-0000-0000-0000000000a2
L3=eeeeeeee-0000-0000-0000-0000000000a3
SU "INSERT INTO public.companies (id, name, organization_id) VALUES ('$CO_A','Co A','$OA'),('$CO_N','Co N',NULL);
INSERT INTO public.company_line_links (line_user_id, company_id) VALUES ('U-linked-A','$CO_A');
ALTER TABLE public.business_events ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES public.companies(id);
INSERT INTO public.business_events (id, status, source_line_user_id, organization_id, partner_id) VALUES
  ('$L1','new','U-linked-A',NULL,NULL),
  ('$L2','new','U-nolink',NULL,'$CO_N'),
  ('$L3','new','U-nolink-2',NULL,NULL);" >/dev/null 2>/tmp/dna-legacy-fixture.log || { bad "legacy fixtures"; cat /tmp/dna-legacy-fixture.log; }

# Inventory (read-only) on the replica: categories and counts only.
INV=$(SU "$(cat "$ROOT/supabase/drafts/legacy_business_events_inventory.DRAFT.sql")" 2>&1); st=$?
INV_FLAT=$(echo "$INV" | tr '\n' ' ' | sed 's/ *$//')
if [ $st -eq 0 ] && [ "$INV_FLAT" = "derivable_line_link|1 scoped|4 unidentified|3" ]; then
  ok "legacy inventory: categories counted correctly on synthetic evidence ($INV_FLAT)"
else
  bad "legacy inventory: st=$st got='$INV_FLAT'"
fi

# ---- SUMMARY ----------------------------------------------------------------
echo "RESULT: ok=$OKS fail=$FAILS"
exit $FAILS

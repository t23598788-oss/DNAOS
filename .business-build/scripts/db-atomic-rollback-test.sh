#!/usr/bin/env bash
# Isolated DB rollback test (2026-10-20).
# - Throwaway cluster in a mktemp dir, unix socket only, port 54399 (NOT Supabase 54322).
# - Refuses to run if DATABASE_URL / SUPABASE_* production variables are set in this shell.
# - Loads a REPLICA of business_events (columns only) + the DRAFT RPC. It is not the
#   production schema and does not prove RLS. It proves the transaction semantics.
# Exit status is the real status of the test run (no pipes hide it).
set -u

for v in DATABASE_URL SUPABASE_DB_URL NEXT_PUBLIC_SUPABASE_URL; do
  if [ -n "${!v:-}" ]; then echo "REFUSED: $v is set; this test must not run against a configured database"; exit 2; fi
done

PGBIN="$(dirname "$(command -v pg_ctl)")"
DATA="$(mktemp -d /tmp/dna-pg-test.XXXXXX)"
PORT=54399
LOG="$DATA/server.log"
RESULTS=0
fail() { echo "  FAIL $1"; RESULTS=$((RESULTS+1)); }
pass() { echo "  ok   $1"; }

cleanup() { "$PGBIN/pg_ctl" -D "$DATA/cluster" stop -m fast >/dev/null 2>&1; rm -rf "$DATA"; }
trap cleanup EXIT

"$PGBIN/initdb" -D "$DATA/cluster" -U dnatest -A trust >/dev/null 2>&1 || { echo "initdb failed"; exit 1; }
"$PGBIN/pg_ctl" -D "$DATA/cluster" -l "$LOG" -o "-p $PORT -k $DATA -c listen_addresses=''" start >/dev/null 2>&1 || { echo "pg_ctl start failed"; cat "$LOG"; exit 1; }
P="psql -h $DATA -p $PORT -U dnatest -v ON_ERROR_STOP=1 -X -q -t -A"
$P -d postgres -c "CREATE DATABASE dna_os_isolated_test;" || { echo "createdb failed"; exit 1; }
Q() { $P -d dna_os_isolated_test -c "$1"; }

# Replica schema (columns the RPC touches + trace context). Not the production DDL.
Q "CREATE TABLE public.business_events (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     status text NOT NULL,
     title text,
     description text,
     context jsonb,
     updated_at timestamptz DEFAULT now()
   );"

# Failure injector: simulates a database-side failure during the transition step.
Q "CREATE FUNCTION public.fail_on_boom() RETURNS trigger LANGUAGE plpgsql AS \$\$
   BEGIN IF NEW.status = 'boom' THEN RAISE EXCEPTION 'injected transition failure'; END IF; RETURN NEW; END \$\$;
   CREATE TRIGGER trg_fail BEFORE UPDATE ON public.business_events FOR EACH ROW EXECUTE FUNCTION public.fail_on_boom();"

# The DRAFT RPC, loaded exactly as written in supabase/drafts/.
$P -d dna_os_isolated_test -v ON_ERROR_STOP=1 -q -f "$(cd "$(dirname "$0")/.." && pwd)/supabase/drafts/business_event_enrich_transition.DRAFT.sql" || { echo "draft load failed"; exit 1; }

ALLOWED="ARRAY['awaiting_info','quotation_pending','ready_to_quote','boom']"
ID=$(Q "INSERT INTO public.business_events (status, title, context) VALUES ('awaiting_info','old title','{\"trace_id\":\"trace-1\"}') RETURNING id;")

echo "Isolated DB rollback test (cluster in $DATA, port $PORT)"

# A. Commit path: both steps persist.
Q "SELECT public.dna_enrich_and_transition_event('$ID','{\"title\":\"new title\"}','quotation_pending',$ALLOWED,'trace-1');" >/dev/null
ROW=$(Q "SELECT status || '|' || title FROM public.business_events WHERE id='$ID';")
[ "$ROW" = "quotation_pending|new title" ] && pass "A commit: enrich and transition both persisted ($ROW)" || fail "A commit: got '$ROW'"

# B. Rollback path: step 1 (enrich) succeeds, step 2 (transition) fails -> step 1 must be rolled back.
Q "UPDATE public.business_events SET title='old title', status='awaiting_info' WHERE id='$ID';" >/dev/null
if Q "SELECT public.dna_enrich_and_transition_event('$ID','{\"title\":\"should vanish\"}','boom',$ALLOWED,'trace-1');" >/dev/null 2>&1; then
  fail "B rollback: injected failure did not raise"
else
  ROW=$(Q "SELECT status || '|' || title FROM public.business_events WHERE id='$ID';")
  [ "$ROW" = "awaiting_info|old title" ] && pass "B rollback: enrich undone after transition failure ($ROW)" || fail "B rollback: partial write left '$ROW'"
fi

# C. Empty trace is refused before any write.
if Q "SELECT public.dna_enrich_and_transition_event('$ID','{\"title\":\"x\"}','quotation_pending',$ALLOWED,'  ');" >/dev/null 2>&1; then
  fail "C empty trace: call was accepted"
else
  ROW=$(Q "SELECT status || '|' || title FROM public.business_events WHERE id='$ID';")
  [ "$ROW" = "awaiting_info|old title" ] && pass "C empty trace: refused, row unchanged" || fail "C empty trace: row changed to '$ROW'"
fi

# D. Unknown state refused before any write.
if Q "SELECT public.dna_enrich_and_transition_event('$ID','{\"title\":\"x\"}','paid-by-ai',$ALLOWED,'trace-1');" >/dev/null 2>&1; then
  fail "D unknown state: call was accepted"
else
  pass "D unknown state: refused"
fi

# E. Unknown row id -> not found, nothing written.
if Q "SELECT public.dna_enrich_and_transition_event(gen_random_uuid(),'{\"title\":\"x\"}','quotation_pending',$ALLOWED,'trace-1');" >/dev/null 2>&1; then
  fail "E unknown id: call was accepted"
else
  pass "E unknown id: raised EVENT_NOT_FOUND path"
fi

# F. Trace lookup: the same JSON path the TypeScript findBusinessEventsByTrace uses.
HIT=$(Q "SELECT id FROM public.business_events WHERE context->>'trace_id' = 'trace-1';")
[ "$HIT" = "$ID" ] && pass "F trace lookup: trace-1 resolves to the written record" || fail "F trace lookup: got '$HIT'"
MISS=$(Q "SELECT count(*) FROM public.business_events WHERE context->>'trace_id' = 'trace-unknown';")
[ "$MISS" = "0" ] && pass "F unknown trace: zero records" || fail "F unknown trace: got $MISS"

echo "RESULT: $RESULTS failure(s)"
exit $RESULTS

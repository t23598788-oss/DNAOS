// DNA-OS-OUTBOUND-ORCHESTRATION-PROOF -- node "Validate, Classify and Route".
//
// n8n is the ROUTER. It classifies an event, guards against loops, and names
// the route group. It does NOT resolve capabilities, does NOT check policy,
// does NOT dispatch, and never calls back into DNA OS -- there is no inbound
// control port and this file must never assume one. Capability/agent
// resolution and policy live in DNA OS, which owns the registries and the
// authority; the caller reads this decision and dispatches locally.
//
// CLASSIFICATION IS FROM STRUCTURED SIGNALS, NEVER FROM A NAME ALONE.
// error_code is checked before event_type because a code is an assertion the
// emitter made deliberately, while a type prefix is a naming convention that
// drifts. Nothing here does substring matching on `message`: free text is the
// least reliable signal in the event and would silently reclassify an event
// when someone rewords a log line.
//
// An event that matches nothing is UNCLASSIFIED with route_status
// UNRESOLVED_OWNER. It is never assigned to the nearest-looking group --
// guessing an owner is how work silently lands on the wrong capability.

const MAX_HOPS = 10;
const MAX_SAME_CAPABILITY_VISITS = 3;
const SEEN_EVENT_LIMIT = 5000;

const CENTRAL_FIELDS = [
  'event_id', 'work_id', 'trace_id', 'owner_id', 'source', 'event_type',
  'severity', 'status', 'message', 'capability_id', 'resource_id',
  'error_code', 'evidence_ref', 'occurred_at', 'payload',
];

// Priority order is the Owner's group order, with one deliberate exception:
// SECURITY_POLICY is evaluated first. A permission denial that also crashed a
// process is a security event, not a runtime event, and routing it to a
// restart path would treat a refusal as a fault.
const GROUPS = [
  {
    group: 'SECURITY_POLICY',
    codes: ['PERMISSION_DENIED', 'WRITE_GATE_BLOCKED', 'SANDBOX_VIOLATION', 'AUTH_REQUIRED',
            'CREDENTIAL_MISSING', 'CREDENTIAL_EXPIRED', 'POLICY_DENY', 'EXECUTION_GRANT_MISSING'],
    prefixes: ['permission.', 'security.', 'sandbox.', 'credential.', 'writegate.', 'policy.'],
  },
  {
    group: 'OWNER_COMMAND',
    codes: [],
    prefixes: ['owner.command', 'command.', 'owner.decision', 'owner.goal'],
    sources: ['OWNER_TEXT', 'OWNER_VOICE', 'OWNER_UI', 'LINE', 'LOCAL_APP', 'OWNER_AI'],
  },
  {
    group: 'RUNTIME_ERROR',
    codes: ['PROCESS_CRASH', 'SPAWN_FAILED', 'TIMEOUT', 'SERVICE_DOWN', 'EXIT_NONZERO',
            'RESTART_LOOP', 'SUPERVISOR_GAVE_UP'],
    prefixes: ['runtime.', 'process.', 'service.down', 'service.crash'],
  },
  {
    group: 'SOFTWARE_CODE',
    codes: ['BUILD_FAILED', 'TEST_FAILED', 'TYPECHECK_FAILED', 'DEPENDENCY_MISSING',
            'REGRESSION_DETECTED', 'DEPLOY_NOT_READY'],
    prefixes: ['build.', 'test.', 'source.', 'regression.', 'deploy.readiness', 'dependency.'],
  },
  {
    group: 'INFRASTRUCTURE',
    codes: ['DNS_FAILURE', 'TLS_EXPIRED', 'TLS_INVALID', 'PORT_CONFLICT', 'HOST_UNREACHABLE',
            'DISK_FULL', 'SERVICE_UNHEALTHY'],
    prefixes: ['infra.', 'server.', 'dns.', 'tls.', 'network.', 'port.', 'storage.', 'service.health'],
  },
  {
    group: 'DATABASE_DATA',
    codes: ['DB_UNAVAILABLE', 'SCHEMA_MISMATCH', 'TRANSACTION_FAILED', 'ROW_MISSING',
            'MIGRATION_FAILED', 'PERSISTENCE_FAILED'],
    prefixes: ['database.', 'schema.', 'transaction.', 'persistence.', 'migration.'],
  },
  {
    group: 'RESOURCE_COMPUTE',
    codes: ['CPU_SATURATED', 'MEMORY_EXHAUSTED', 'GPU_UNAVAILABLE', 'DISK_IO_SATURATED',
            'COMPUTE_ALLOCATION_FAILED', 'RESOURCE_NOT_MEASURED'],
    prefixes: ['resource.', 'compute.', 'measurement.'],
  },
  {
    group: 'COST_BILLING',
    codes: ['COST_ANOMALY', 'PAYMENT_FAILED', 'RATE_CARD_MISSING', 'BUDGET_EXCEEDED',
            'INVOICE_MISMATCH', 'RECONCILIATION_FAILED'],
    prefixes: ['cost.', 'billing.', 'invoice.', 'budget.', 'rate_card.'],
  },
  {
    group: 'EXTERNAL_INTEGRATION',
    codes: ['WEBHOOK_FAILED', 'PROVIDER_ERROR', 'API_RATE_LIMITED', 'OAUTH_FAILED',
            'EXTERNAL_TIMEOUT'],
    prefixes: ['integration.', 'webhook.', 'provider.', 'external.'],
  },
  {
    group: 'EVIDENCE_VERIFICATION',
    codes: ['EVIDENCE_MISSING', 'VERIFICATION_FAILED', 'EVIDENCE_CONFLICT', 'REGISTRY_MISMATCH',
            'DUPLICATE_UNRESOLVED', 'UNKNOWN'],
    prefixes: ['evidence.', 'verification.', 'registry.'],
  },
];

function classify(event) {
  const code = (event.error_code || '').toUpperCase();
  const type = (event.event_type || '').toLowerCase();
  const source = (event.source || '').toUpperCase();

  // 1. error_code is a deliberate assertion -- it wins.
  for (const g of GROUPS) {
    if (code && g.codes.indexOf(code) !== -1) {
      return { group: g.group, signal: 'error_code', matched: code };
    }
  }
  // 2. source identifies an Owner-originated event regardless of naming.
  for (const g of GROUPS) {
    if (g.sources && source && g.sources.indexOf(source) !== -1) {
      return { group: g.group, signal: 'source', matched: source };
    }
  }
  // 3. event_type prefix, longest prefix first so 'service.health' cannot be
  //    stolen by 'service.' in a different group.
  let best = null;
  for (const g of GROUPS) {
    for (const p of g.prefixes) {
      if (type.indexOf(p) === 0 && (!best || p.length > best.matched.length)) {
        best = { group: g.group, signal: 'event_type_prefix', matched: p };
      }
    }
  }
  if (best) return best;

  // 4. status UNKNOWN with no other signal is an evidence problem by
  //    definition: the system does not know what happened.
  if ((event.status || '').toUpperCase() === 'UNKNOWN') {
    return { group: 'EVIDENCE_VERIFICATION', signal: 'status_unknown', matched: 'UNKNOWN' };
  }
  return { group: 'UNCLASSIFIED', signal: 'none', matched: null };
}

function guard(event, staticData) {
  const hops = Number(event.hop_count == null ? 0 : event.hop_count);
  if (!Number.isFinite(hops) || hops < 0) {
    return { loop: true, reason: 'hop_count is not a non-negative number: ' + event.hop_count };
  }
  if (hops >= MAX_HOPS) {
    return { loop: true, reason: 'hop_count ' + hops + ' reached MAX_HOPS ' + MAX_HOPS };
  }
  const seen = staticData.seen_event_ids || {};
  if (event.event_id && seen[event.event_id]) {
    return { loop: true, reason: 'event_id already routed at ' + seen[event.event_id] + ' -- a re-sent event is a loop, not a retry (a retry carries a new event_id and the same trace_id)' };
  }
  const path = Array.isArray((event.payload || {}).trace_path) ? event.payload.trace_path : [];
  const counts = {};
  for (const step of path) {
    counts[step] = (counts[step] || 0) + 1;
    if (counts[step] > MAX_SAME_CAPABILITY_VISITS) {
      return { loop: true, reason: 'trace revisited capability ' + step + ' ' + counts[step] + ' times (limit ' + MAX_SAME_CAPABILITY_VISITS + ')' };
    }
  }
  return { loop: false, reason: null };
}

const receivedAt = new Date().toISOString();
const raw = $input.first().json;
const event = raw.body ? raw.body : raw;
const staticData = $getWorkflowStaticData('global');
if (!staticData.seen_event_ids) staticData.seen_event_ids = {};

const missing = CENTRAL_FIELDS.filter((f) => event[f] === undefined);

// Backwards compatibility with the original proof contract: every response
// still carries accepted/workflow_id/received_event_id/processed_at/result/
// evidence_ref. The routing block is additive, so the first proven caller
// keeps working unchanged.
function respond(extra) {
  return [{ json: Object.assign({
    accepted: extra.route_status === 'ROUTED' || extra.route_status === 'UNRESOLVED_OWNER',
    workflow_id: $workflow.id,
    received_event_id: event.event_id || null,
    processed_at: receivedAt,
    evidence_ref: event.evidence_ref || null,
  }, extra) }];
}

if (missing.length > 0) {
  return respond({
    route_status: 'REJECTED_MISSING_FIELDS',
    result: 'REJECTED_MISSING_FIELDS: ' + missing.join(','),
    route_group: null,
    missing_fields: missing,
    hop_count_in: event.hop_count == null ? null : event.hop_count,
    hop_count_out: null,
  });
}

const guarded = guard(event, staticData);
if (guarded.loop) {
  return respond({
    route_status: 'LOOP_DETECTED',
    result: 'LOOP_DETECTED',
    route_group: null,
    loop_reason: guarded.reason,
    hop_count_in: event.hop_count,
    hop_count_out: event.hop_count,
    trace_id: event.trace_id,
    origin: event.origin || null,
    // A detected loop is evidence, not a silent drop: the caller is told to
    // stop AND told to record it.
    next_action: 'STOP_AND_RECORD_EVIDENCE',
    owner_decision_required: true,
  });
}

// Only a non-loop event is remembered, so a rejected event can be legitimately
// resubmitted after correction with the same id.
staticData.seen_event_ids[event.event_id] = receivedAt;
const ids = Object.keys(staticData.seen_event_ids);
if (ids.length > SEEN_EVENT_LIMIT) {
  // Trim oldest-first. An unbounded map would grow until the workflow's static
  // data write fails, which would disable loop detection exactly when the
  // system is busiest.
  ids.sort((a, b) => (staticData.seen_event_ids[a] < staticData.seen_event_ids[b] ? -1 : 1));
  for (let i = 0; i < ids.length - SEEN_EVENT_LIMIT; i++) delete staticData.seen_event_ids[ids[i]];
}

const classified = classify(event);
const unresolved = classified.group === 'UNCLASSIFIED';

return respond({
  route_status: unresolved ? 'UNRESOLVED_OWNER' : 'ROUTED',
  result: unresolved ? 'UNRESOLVED_OWNER' : 'ROUTED_' + classified.group,
  route_group: unresolved ? null : classified.group,
  classification_signal: classified.signal,
  classification_matched: classified.matched,
  trace_id: event.trace_id,
  origin: event.origin || null,
  hop_count_in: event.hop_count,
  hop_count_out: Number(event.hop_count) + 1,
  max_hops: MAX_HOPS,
  // n8n names the GROUP. DNA OS resolves which capability and which agent owns
  // that group, from its own registries -- this workflow has no access to them
  // and must never pretend otherwise.
  resolution_required_by: 'DNA_OS',
  next_action: unresolved
    ? 'RETURN_TO_DNA_OS_FOR_OWNER_TRIAGE'
    : 'RESOLVE_CAPABILITY_AND_DISPATCH_IN_DNA_OS',
  owner_decision_required: unresolved,
});

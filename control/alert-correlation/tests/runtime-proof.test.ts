/**
 * หน้าที่: RUNTIME PROOF (Owner's step 9) using REAL alert emails that
 * really arrived in the Owner's mailbox, not invented fixtures. Every
 * message_id, thread_id, timestamp, sender and body below was read from
 * live Gmail on 2026-08-26 and is reproducible with:
 *   from:(notify.railway.app) subject:"Build failed for DNA-OS-INFRASTRUCTURE"
 *
 * Case C performs a REAL HTTP probe against the real Railway host, which
 * is the entire point: it proves the system reports RECOVERED rather than
 * repeating the email's stale failure claim. That means this suite needs
 * network. A probe failure flips case C to ACTIVE_INCIDENT, which the
 * test reports honestly rather than skipping.
 *
 * How to run: npx tsx control/alert-correlation/tests/runtime-proof.test.ts
 */

import { runAlertCorrelation, parseAlertEmail, resolveTarget, classifyAlert, identityKey, dedupIdentity, UNKNOWN, PROVIDER_UNRESOLVED, type RawAlertEmail } from "../contract";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.error(`FAIL  ${name}`);
    if (detail !== undefined) console.error("      " + JSON.stringify(detail).slice(0, 400));
  }
}

/** Real Railway body shape, verbatim structure from the live message. */
function railwayBody(service: string): string {
  return [
    "Railway Logo",
    "",
    "Build failed for project: DNA-OS-INFRASTRUCTURE",
    "",
    "*************",
    "Build failed!",
    "*************",
    "",
    "This is awkward. One of your builds failed to leave the wheelhouse. Details:",
    "",
    "* Project: DNA-OS-INFRASTRUCTURE",
    `* Service: ${service}`,
    "* Environment: production",
    "",
    "View build logs ( https://railway.com/project/ffe589bf-58fb-4e3e-8969-4a75915fda1a/service/4c04fb88-4711-4bd8-b42e-e25bb5ab909a?id=0025ec48-02aa-406b-ba0f-a16a40543ec4&environmentId=d28eafa-9735-4405-a585-55ea354bafab )",
    "",
    "Regards,",
    "The Railway Team",
  ].join("\n");
}

/** The four REAL messages of Gmail thread 1a03cb91688a2d24 — two services, four mails. */
const REAL_THREAD: readonly RawAlertEmail[] = [
  { message_id: "1a03cb91688a2d24", thread_id: "1a03cb91688a2d24", sender: "hello@notify.railway.app", received_at: "2026-08-26T06:19:17Z", subject: "Build failed for DNA-OS-INFRASTRUCTURE", body: railwayBody("dna-os-circuit") },
  { message_id: "1a03cb92f65a8198", thread_id: "1a03cb91688a2d24", sender: "hello@notify.railway.app", received_at: "2026-08-26T06:19:24Z", subject: "Build failed for DNA-OS-INFRASTRUCTURE", body: railwayBody("owner-command-http") },
  { message_id: "1a03cb9758fe3009", thread_id: "1a03cb91688a2d24", sender: "hello@notify.railway.app", received_at: "2026-08-26T06:19:41Z", subject: "Build failed for DNA-OS-INFRASTRUCTURE", body: railwayBody("dna-os-circuit") },
  { message_id: "1a03cb988b84c65e", thread_id: "1a03cb91688a2d24", sender: "hello@notify.railway.app", received_at: "2026-08-26T06:19:46Z", subject: "Build failed for DNA-OS-INFRASTRUCTURE", body: railwayBody("owner-command-http") },
];

/** A real Supabase security email — a provider DNA OS knows, a service it does not. */
const REAL_SUPABASE: RawAlertEmail = {
  message_id: "1a03a7e712d464e6",
  thread_id: "1a03a7e712d464e6",
  sender: "noreply@supabase.com",
  received_at: "2026-08-25T19:55:58Z",
  subject: "Action required: security vulnerabilities detected in your projects",
  body: "Security issues require your attention",
};

async function main(): Promise<void> {
  // ===== CASE A: an alert that resolves to a real service =====
  const alertA = parseAlertEmail(REAL_THREAD[0]);
  check("A1. provider proven from the sender DOMAIN, not a substring", alertA.provider === "railway", alertA.provider);
  check("A2. service extracted from the real body", alertA.service === "dna-os-circuit", alertA.service);
  check("A3. project + environment extracted", alertA.project === "DNA-OS-INFRASTRUCTURE" && alertA.environment === "production", alertA);
  check("A4. alert_type classified from the real subject", alertA.alert_type === "BUILD_FAILED", alertA.alert_type);

  const targetA = resolveTarget(alertA);
  check("A5. resolves to a real probe target and a real repo path", targetA.resolved && targetA.health_url !== UNKNOWN && targetA.repo_path === "dna-os-circuit", targetA);

  // ===== UNPROVEN FIELDS MUST BE UNKNOWN, NEVER GUESSED =====
  check("A6. fields the parser cannot prove are UNKNOWN", alertA.error_code === UNKNOWN && alertA.region === UNKNOWN && alertA.build_id === UNKNOWN, alertA);

  // ===== A spoofed sender must NOT resolve =====
  const spoof = parseAlertEmail({ ...REAL_THREAD[0], sender: "attacker@notify.railway.app.evil.com" });
  // PROVIDER_UNRESOLVED, not UNKNOWN: we looked the domain up and nothing
  // matched. Distinct from "field not found", and it must still flow on.
  check("A7. lookalike sender domain is refused (no substring matching)", spoof.provider === PROVIDER_UNRESOLVED, spoof.provider);

  // ===== CASE B: 4 real emails, 1 thread, 2 services -> 2 incidents =====
  const reports = await runAlertCorrelation(REAL_THREAD);
  const verdicts = reports.map((r) => r.dedup.verdict);
  const newCount = verdicts.filter((v) => v === "NEW_INCIDENT").length;
  const dupCount = verdicts.filter((v) => v === "DUPLICATE_ALERT").length;

  check("B1. four real emails produce exactly TWO incidents, not four", newCount === 2, verdicts);
  check("B2. the repeat mails are recorded as DUPLICATE_ALERT", dupCount === 2, verdicts);
  check(
    "B3. the two incidents are the two SERVICES, not the one thread",
    new Set(reports.filter((r) => r.dedup.verdict === "NEW_INCIDENT").map((r) => r.service)).size === 2,
    reports.map((r) => `${r.service}:${r.dedup.verdict}`),
  );
  // The defect this guards: keying on thread_id would give ONE incident.
  const threadKeyed = new Set(REAL_THREAD.map((email) => email.thread_id)).size;
  check("B4. thread-keyed dedup WOULD have collapsed them to 1 (the bug this avoids)", threadKeyed === 1, threadKeyed);
  check(
    "B5. dedup identity excludes thread_id and message_id by construction",
    !identityKey(dedupIdentity(alertA)).includes("1a03cb91688a2d24"),
    identityKey(dedupIdentity(alertA)),
  );

  // ===== CASE C: email says FAILED, live system says serving -> RECOVERED =====
  const circuit = reports.find((r) => r.service === "dna-os-circuit");
  if (!circuit) {
    check("C1. dna-os-circuit report exists", false);
  } else {
    const probed = circuit.assessment.observation;
    console.log(`      [live] ${probed?.probe_target} -> ${probed?.detail ?? "no observation"}`);
    check(
      "C1. a REAL live probe was performed by software (not supplied by a caller)",
      probed !== null && probed.observed_at.length > 0,
      probed,
    );
    check(
      "C2. email claimed BUILD_FAILED but the live system is serving -> RECOVERED, not an outage",
      circuit.assessment.incident_state === "ALERT_HISTORICAL_RECOVERED" && circuit.recovered_or_still_failing === "RECOVERED",
      { state: circuit.assessment.incident_state, probe: probed?.detail },
    );
    check(
      "C3. the verdict cites both the claim and the observation",
      circuit.assessment.evidence.some((e) => e.includes("claim")) && circuit.assessment.evidence.some((e) => e.includes("live probe")),
      circuit.assessment.evidence,
    );
    check(
      "C4. the recommended action is 'no remediation', matching the recovered state",
      circuit.recommended_next_software_action.includes("historical evidence only"),
      circuit.recommended_next_software_action,
    );
  }

  // ===== UNVERIFIABLE: resolved service with no observed URL =====
  const ownerCmd = reports.find((r) => r.service === "owner-command-http");
  check(
    "D1. a resolved service with no observed health URL is UNVERIFIABLE, never assumed healthy",
    ownerCmd?.assessment.incident_state === "UNVERIFIABLE" && ownerCmd.recovered_or_still_failing === "UNKNOWN",
    ownerCmd?.assessment.incident_state,
  );

  // ===== UNRESOLVED: known provider, unknown service =====
  const supabase = await runAlertCorrelation([REAL_SUPABASE]);
  check("E1. known provider + unprovable service -> UNRESOLVED_ALERT", supabase[0].assessment.incident_state === "UNRESOLVED_ALERT", supabase[0].assessment.incident_state);
  check("E3. an unmatched sender is PROVIDER_UNRESOLVED yet still produces a report", (await runAlertCorrelation([{ ...REAL_SUPABASE, message_id: "x1", sender: "ops@nobody-registered.example" }]))[0].assessment.alert.provider === PROVIDER_UNRESOLVED);
  check("E2. an unresolved alert is never probed", supabase[0].assessment.observation === null, supabase[0].assessment.observation);

  // ===== RECOVERY_NOTICE transition =====
  const recovery = classifyAlert(alertA, "ALERT_HISTORICAL_RECOVERED", [
    { key: identityKey(dedupIdentity(alertA)), first_seen_at: alertA.received_at, last_seen_at: alertA.received_at, message_ids: ["some-earlier-id"], incident_state: "ACTIVE_INCIDENT" },
  ]);
  check("F1. an ACTIVE incident observed serving again yields RECOVERY_NOTICE", recovery.verdict === "RECOVERY_NOTICE", recovery);

  // ===== AI is not in the path — a REAL source scan, not an assertion of intent =====
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const folder = join(dirname(fileURLToPath(import.meta.url)), "..");
  const decisionPath = ["parse.ts", "resolve.ts", "correlate.ts", "dedup.ts", "pipeline.ts", "host-runtime.ts"];
  const aiMarkers = /anthropic|openai|claude|gpt-|gemini|llm|completion|prompt|agent-host|agent-gateway|model-router|runPtySession|launchAgent/i;
  const offenders = decisionPath.filter((file) => aiMarkers.test(readFileSync(join(folder, file), "utf-8")));
  check("G1. no AI/model reference exists in any decision-path source file", offenders.length === 0, offenders);

  // ===== and nothing here reads a mailbox =====
  // Detect a real mail CLIENT — an import/require of a mail library, or a
  // request to a mail API host. Matching the bare words "gmail"/"inbox"
  // was wrong: it flagged a doc comment in dedup.ts explaining Gmail's
  // threading, and parse.ts's `gmail:message/<id>` provenance string.
  // Both are references TO the source, not code that talks to it.
  const mailMarkers = /(?:from|require)\s*\(?\s*["'][^"']*(?:imap|smtp|nodemailer|googleapis|mailparser)|https?:\/\/[^"'\s]*(?:googleapis|gmail)\.com/i;
  const mailOffenders = decisionPath.filter((file) => mailMarkers.test(readFileSync(join(folder, file), "utf-8")));
  check("G2. no mail-protocol client exists in this capability (ingestion stays a seam)", mailOffenders.length === 0, mailOffenders);
}

main()
  .catch((error) => {
    failed++;
    console.error("FAIL  harness: " + (error instanceof Error ? error.stack ?? error.message : String(error)));
  })
  .finally(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  });

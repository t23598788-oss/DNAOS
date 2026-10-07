/**
 * หน้าที่: PHASE 6 — END-TO-END PROOF BEFORE DEPLOY.
 *
 * Runs the whole chain over REAL HTTP against a local stand-in for the new
 * Edge Function, using that function's EXACT response shape:
 *
 *   [stand-in for provider-alert-email-read]
 *      -> connections/email-alert-source (real adapter, real fetch)
 *      -> RawAlertEmail
 *      -> control/alert-correlation (real parse/resolve/probe/dedup)
 *      -> OwnerIncidentReport
 *
 * The stand-in exists because the real function is NOT DEPLOYED — that is
 * the whole point of the deployment gate. It is deliberately dumb: it
 * checks the secret header and returns fixture messages. It contains no
 * Gmail logic, so it proves the wiring without pretending to prove that
 * Gmail itself works.
 *
 * Fixtures are REAL emails from the Owner's mailbox (message ids, thread
 * ids, senders, timestamps and body structure read live on 2026-08-26).
 *
 * How to run (needs Node >=18): npx tsx connections/email-alert-source/tests/end-to-end.test.ts
 */

import { createServer, type Server } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAlertEmails, type EmailSourceConfig } from "../contract";
import { runAlertCorrelation, PROVIDER_UNRESOLVED } from "../../../control/alert-correlation/contract";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.error(`FAIL  ${name}`); if (detail !== undefined) console.error("      " + JSON.stringify(detail).slice(0, 320)); }
}

const SECRET = "local-integration-secret";
const HEADER = "x-provider-alert-email-secret";

function railwayBody(service: string): string {
  return `Railway Logo\n\nBuild failed for project: DNA-OS-INFRASTRUCTURE\n\n* Project: DNA-OS-INFRASTRUCTURE\n* Service: ${service}\n* Environment: production\n\nView build logs ( https://railway.com/project/ffe589bf-58fb-4e3e-8969-4a75915fda1a/service/4c04fb88-4711-4bd8-b42e-e25bb5ab909a )\n`;
}

/** Exactly the shape provider-alert-email-read returns. */
const UPSTREAM_MESSAGES = [
  { id: "1a03cb91688a2d24", threadId: "1a03cb91688a2d24", internalDate: "1787725157000", from: "hello@notify.railway.app", subject: "Build failed for DNA-OS-INFRASTRUCTURE", bodyText: railwayBody("dna-os-circuit") },
  { id: "1a03cb92f65a8198", threadId: "1a03cb91688a2d24", internalDate: "1787725164000", from: "hello@notify.railway.app", subject: "Build failed for DNA-OS-INFRASTRUCTURE", bodyText: railwayBody("owner-command-http") },
  { id: "1a03cb9758fe3009", threadId: "1a03cb91688a2d24", internalDate: "1787725181000", from: "hello@notify.railway.app", subject: "Build failed for DNA-OS-INFRASTRUCTURE", bodyText: railwayBody("dna-os-circuit") },
  { id: "1a03cb988b84c65e", threadId: "1a03cb91688a2d24", internalDate: "1787725186000", from: "hello@notify.railway.app", subject: "Build failed for DNA-OS-INFRASTRUCTURE", bodyText: railwayBody("owner-command-http") },
  // REAL Vercel billing failure — the financial-escalation case.
  { id: "1a020cacb80cd47a", threadId: "1a020cacb80cd47a", internalDate: "1787256555000", from: "notifications@vercel.com", subject: "[Action Required] Payment Failed And Shutdown Coming Soon", bodyText: "We failed to charge your card ending with 4575 for the team t23598788-3511's projects." },
  // A sender no registered provider domain matches — must NOT be dropped.
  { id: "unknown-sender-0001", threadId: "unknown-sender-0001", internalDate: "1787725200000", from: "alerts@some-provider-we-never-registered.example", subject: "Service degraded in region eu-west-1", bodyText: "Your service is degraded." },
];

function startStandIn(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.headers[HEADER] !== SECRET) { res.writeHead(401); res.end("unauthorized"); return; }
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        let query = "";
        try { query = JSON.parse(raw).query ?? ""; } catch { /* handled below */ }
        if (!/^\s*(from:|subject:|newer_than:|\{)/i.test(query)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "unscoped query refused" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, query, count: UPSTREAM_MESSAGES.length, messages: UPSTREAM_MESSAGES, errors: [] }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

async function main(): Promise<void> {
  const { server, url } = await startStandIn();
  try {
    const config: EmailSourceConfig = { endpoint_url: url, secret_header_name: HEADER, secret_value: SECRET, timeout_ms: 5_000 };

    // ===== 1. EXISTING READER REUSED / DUPLICATE READER = 0 =====
    const deadboardFns = "/Users/tam/Desktop/dna-os-deadboard/supabase/functions";
    const newFn = readFileSync(join(deadboardFns, "provider-alert-email-read/index.ts"), "utf-8");
    check("1a. the new Edge Function IMPORTS the existing shared gmail-client", /from\s+["']\.\.\/_shared\/gmail-client\.ts["']/.test(newFn));
    check(
      "1b. it defines NO OAuth/token exchange of its own",
      !/oauth2\.googleapis|grant_type|client_secret/i.test(newFn.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")),
    );
    check(
      "1c. it makes NO direct Gmail API call of its own",
      !/gmail\.googleapis|users\/me\/messages/i.test(newFn.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")),
    );
    const shared = readdirSync(deadboardFns).filter((d) => /gmail/i.test(d));
    check("1d. no second gmail-* function directory was created", shared.length === 0, shared);

    // ===== 2. CREDENTIAL COPIED = 0 =====
    const dnaOsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const credRefs = readFileSync(join(dnaOsRoot, "credentials/registry/data/api-credential-references.jsonl"), "utf-8");
    check("2a. DNA OS credential registry still has NO google/gmail provider", !/gmail|google/i.test(credRefs));
    check("2b. the new Edge Function never returns or logs a credential", !/GMAIL_REFRESH_TOKEN["'\s]*[,)]|return.*REFRESH_TOKEN/.test(newFn));

    // ===== 3. AUTH IS ENFORCED =====
    const unauth = await fetchAlertEmails({ ...config, secret_value: "wrong" }, "from:notify.railway.app");
    check("3a. a wrong shared secret is refused (UNAUTHORIZED)", !unauth.ok && unauth.error_code === "UNAUTHORIZED", unauth.error_code);

    // ===== 4. RAW MESSAGE RECEIVED + CONVERSION CORRECT =====
    const fetched = await fetchAlertEmails(config, "from:(notify.railway.app OR vercel.com) newer_than:7d");
    check("4a. raw messages received over real HTTP", fetched.ok && fetched.emails.length === 6, { ok: fetched.ok, n: fetched.emails.length, detail: fetched.detail });
    const first = fetched.emails[0];
    check("4b. adapter conversion is correct (epoch-millis -> RFC3339)", first.received_at === "2026-08-26T06:19:17.000Z", first.received_at);
    check("4c. every field maps across the contract boundary", first.message_id === "1a03cb91688a2d24" && first.thread_id === "1a03cb91688a2d24" && first.sender === "hello@notify.railway.app", first);

    // ===== 5. CORRELATION + DEDUP + UNKNOWN PROVIDER + FINANCIAL =====
    const reports = await runAlertCorrelation(fetched.emails);
    check("5a. every ingested email produced a report — none silently dropped", reports.length === 6, reports.length);

    const newIncidents = reports.filter((r) => r.dedup.verdict === "NEW_INCIDENT");
    const duplicates = reports.filter((r) => r.dedup.verdict === "DUPLICATE_ALERT");
    check("5b. thread dedup correct: 4 railway mails / 2 services -> 2 incidents + 2 duplicates", duplicates.length === 2 && newIncidents.length === 4, { new: newIncidents.length, dup: duplicates.length });

    const unknown = reports.find((r) => r.assessment.alert.message_id === "unknown-sender-0001");
    check("5c. UNKNOWN PROVIDER PRESERVED — enters correlation, not discarded", unknown !== undefined);
    check("5d. its provider is PROVIDER_UNRESOLVED, not a guess", unknown?.assessment.alert.provider === PROVIDER_UNRESOLVED, unknown?.assessment.alert.provider);
    check("5e. it stays visible as UNRESOLVED_ALERT", unknown?.assessment.incident_state === "UNRESOLVED_ALERT", unknown?.assessment.incident_state);

    const billing = reports.find((r) => r.assessment.alert.alert_type === "BILLING_FAILURE");
    check("6a. financial alert detected from the real Vercel email", billing !== undefined);
    check("6b. DECISION_REQUIRED = OWNER", billing?.decision_required === "OWNER", billing?.decision_required);
    check("6c. AI_FINANCIAL_AUTHORITY = NO on every report", reports.every((r) => r.ai_financial_authority === false));
    check("6d. the recommended action refuses to pay or retry a charge", /must not pay, retry a charge/.test(billing?.recommended_next_software_action ?? ""), billing?.recommended_next_software_action);

    // ===== 7. AI DECISION IN TRUTH PATH = NO =====
    const truthPath = ["parse.ts", "resolve.ts", "correlate.ts", "dedup.ts", "pipeline.ts"];
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const aiMarkers = /anthropic|openai|claude|gpt-|gemini|llm|completion|prompt/i;
    const aiOffenders = truthPath.filter((f) => aiMarkers.test(strip(readFileSync(join(dnaOsRoot, "control/alert-correlation", f), "utf-8"))));
    check("7a. no AI reference in any truth-path source file", aiOffenders.length === 0, aiOffenders);

    const railwayRecovered = reports.find((r) => r.service === "dna-os-circuit");
    console.log(`      [live] ${railwayRecovered?.current_real_state}`);
    check("7b. correlation still judged by a REAL live probe, not the email", railwayRecovered?.assessment.observation !== null && railwayRecovered?.recovered_or_still_failing === "RECOVERED", railwayRecovered?.recovered_or_still_failing);
  } finally {
    server.close();
  }
}

main()
  .catch((error) => { failed++; console.error("FAIL  harness: " + (error instanceof Error ? error.stack ?? error.message : String(error))); })
  .finally(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  });

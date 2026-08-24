import { defineRailway, github, mongo, postgres, project, service, volume } from "railway/iac";

const REPO = "t23598788-oss/-DNA-OS-INFRASTRUCTURE-";

export default defineRailway(() => {
  const MongoDB = mongo("MongoDB", { region: "iad" });
  MongoDB.deploy = { startCommand: "docker-entrypoint.sh mongod --ipv6 --bind_ip ::,0.0.0.0 --setParameter diagnosticDataCollectionEnabled=false" };
  const Postgres = postgres("Postgres", { region: "iad" });
  const mongodbVolume = volume("mongodb-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "iad", sizeMB: 500 });
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "iad", sizeMB: 5000 });

  // Real network services deployed 2026-08-24 (Railway migration). All
  // three were built loopback-only and had no request auth of their own
  // (see permissions/network-auth-gate/ + git history the same date) —
  // each gets a real, freshly-generated shared secret here, injected only
  // into these Railway services, never committed to source. HOST=0.0.0.0
  // is required for Railway's network (private or public) to reach the
  // process at all; PORT is injected automatically by Railway and each
  // service's own start.ts/server.ts already reads it first.

  // Real shared secrets are set out-of-band via `railway variable set`
  // after these services exist — never written to this file (this file is
  // committed to GitHub source; a literal secret here would leak it).
  // HOST=0.0.0.0 is the only variable declared here since it's not
  // sensitive.

  // API_SERVICE, not a UI — no public domain. Real caller (dna-os-deadboard,
  // a separate repo) is Mac-local today and its own reachability from this
  // service is unverified from here; giving this a public domain would add
  // exposed surface with no confirmed consumer yet.
  const ownerCommandHttp = service("owner-command-http", {
    source: github(REPO),
    startCommand: "npx tsx transport/owner-command-http/server.ts",
    healthcheckPath: "/health",
    variables: { HOST: "0.0.0.0" },
  });

  // UI_APP — real reachable URL per the migration's own requirement. GET
  // routes (the circuit-board UI, SSE /events, read-only JSON) stay open;
  // every write route is gated by the same shared-secret pattern.
  const dnaOsCircuit = service("dna-os-circuit", {
    source: github(REPO),
    startCommand: "npx tsx dna-os-circuit/runtime/start.ts",
    healthcheckPath: "/",
    variables: { HOST: "0.0.0.0" },
  });

  // UI_APP — same reasoning as dna-os-circuit. Reaches no execution path
  // (evidence-store writes only), still gated per the peer-reviewed
  // finding that forged joint/violation rows are a real integrity risk.
  const jointMonitor = service("joint-monitor", {
    source: github(REPO),
    startCommand: "npx tsx observability/joint-monitor/start.ts",
    healthcheckPath: "/",
    variables: { HOST: "0.0.0.0" },
  });

  return project("DNA-OS-INFRASTRUCTURE", {
    resources: [MongoDB, Postgres, mongodbVolume, postgresVolume, ownerCommandHttp, dnaOsCircuit, jointMonitor],
  });
});

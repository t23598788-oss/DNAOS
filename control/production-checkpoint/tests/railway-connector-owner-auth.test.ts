import { invokeRailwayConnector, __setRailwayInvokerTestHooks } from "../../../connections/railway/router-invoker";

declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
declare const process: { exit(code: number): void };

type GraphqlCall = { readonly document: string; readonly variables: Record<string, unknown> | undefined };

function command(payload: Record<string, unknown>) {
  return {
    command_id: "cmd-railway-auth-test",
    issued_by: {
      identity_id: "test",
      acting_as_account_id: "test",
      acting_as_tenant_id: "test",
      software_id: "test",
      kind: "service" as const,
    },
    intent: "connector.invoke" as const,
    payload,
    issued_at: new Date().toISOString(),
  };
}

function ok(value: boolean, message: string): void {
  if (!value) throw new Error(message);
}

async function run(): Promise<void> {
  let passed = 0;
  let failed = 0;

  async function check(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      passed++;
      console.log(`PASS ${name}`);
    } catch (error) {
      failed++;
      console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      __setRailwayInvokerTestHooks();
    }
  }

  const readCases: Array<{ intent: string; payload: Record<string, unknown> }> = [
    { intent: "railway.project_status", payload: { project_id: "proj_1" } },
    { intent: "railway.environment_status", payload: {} },
    { intent: "railway.list_project_services", payload: { project_id: "proj_1" } },
    { intent: "railway.get_service_instance", payload: { service_id: "svc_1", environment_id: "env_1" } },
    { intent: "railway.get_source_status", payload: { service_id: "svc_1" } },
    { intent: "railway.list_variable_names", payload: { environment_id: "env_1" } },
    { intent: "railway.get_deployment", payload: { deployment_id: "dep_1" } },
    { intent: "railway.get_deployment_logs", payload: { deployment_id: "dep_1" } },
    { intent: "railway.get_domain", payload: { service_id: "svc_1", environment_id: "env_1" } },
  ];

  await check("reads do not attempt Owner authorization gate", async () => {
    let ownerChecks = 0;
    const gqlCalls: GraphqlCall[] = [];
    __setRailwayInvokerTestHooks({
      validateOwnerSession: () => {
        ownerChecks++;
        return { ok: true, session: {} } as unknown as ReturnType<typeof import("../../../control/owner-authentication/contract").validateOwnerSession>;
      },
      railwayGraphql: async (document, variables) => {
        gqlCalls.push({ document, variables });
        if (document.includes("EnvironmentStatus")) {
          return { http_status: 200, data: { environment: { id: "env_1", name: "prod", projectId: "proj_1" } }, errors: [], auth_required: false, summary: "ok" };
        }
        if (document.includes("ProjectServices")) {
          return {
            http_status: 200,
            data: { project: { id: "proj_1", name: "p", services: { edges: [{ node: { id: "svc_1", name: "dna-os-circuit" } }] } } },
            errors: [],
            auth_required: false,
            summary: "ok",
          };
        }
        if (document.includes("ServiceInstance") || document.includes("CurrentDomain")) {
          return {
            http_status: 200,
            data: { serviceInstance: { domains: { serviceDomains: [{ domain: "app.example.com" }] }, latestDeployment: { id: "dep_1", status: "SUCCESS", canRedeploy: true } }, service: { id: "svc_1", name: "svc" } },
            errors: [],
            auth_required: false,
            summary: "ok",
          };
        }
        if (document.includes("SourceStatus")) {
          return {
            http_status: 200,
            data: { service: { id: "svc_1", name: "svc", source: { owner: "o", repo: "r", branch: "main", provider: "github" } } },
            errors: [],
            auth_required: false,
            summary: "ok",
          };
        }
        if (document.includes("VariableNames")) {
          return { http_status: 200, data: { environment: { id: "env_1", variables: { edges: [{ node: { name: "HOST" } }, { node: { name: "PORT" } }] } } }, errors: [], auth_required: false, summary: "ok" };
        }
        if (document.includes("DeploymentLogs")) {
          return { http_status: 200, data: { deployment: { id: "dep_1", logs: "line1\nline2" } }, errors: [], auth_required: false, summary: "ok" };
        }
        if (document.includes("Deployment(")) {
          return {
            http_status: 200,
            data: { deployment: { id: "dep_1", status: "SUCCESS", staticUrl: "https://example.com", canRedeploy: true, meta: { commitSha: "abc1234" } } },
            errors: [],
            auth_required: false,
            summary: "ok",
          };
        }
        return { http_status: 200, data: { project: { id: "proj_1", name: "project", description: "desc" } }, errors: [], auth_required: false, summary: "ok" };
      },
    });

    for (const row of readCases) {
      const out = await invokeRailwayConnector(command({ intent: row.intent, ...row.payload }));
      ok(out.ok === true, `${row.intent} should succeed`);
    }
    ok(ownerChecks === 0, "read intents must not call owner authorization gate");
    ok(gqlCalls.length === readCases.length, "every read should reach read GraphQL path");
  });

  const mutationCases: Array<{ intent: string; payload: Record<string, unknown> }> = [
    { intent: "railway.create_service", payload: { project_id: "proj_1", service_name: "svc-new" } },
    { intent: "railway.connect_source", payload: { service_id: "svc_1", source_owner: "org", source_repo: "repo" } },
    { intent: "railway.create_deployment_trigger", payload: { service_id: "svc_1", environment_id: "env_1", commit_sha: "a".repeat(40) } },
    { intent: "railway.deploy_revision", payload: { service_id: "svc_1", environment_id: "env_1", commit_sha: "b".repeat(40) } },
    { intent: "railway.redeploy_deployment", payload: { deployment_id: "dep_1" } },
    { intent: "railway.create_domain", payload: { service_id: "svc_1", environment_id: "env_1", domain: "app.example.com" } },
  ];

  await check("mutations fail closed when Owner authorization missing/denied", async () => {
    let ownerChecks = 0;
    let gqlCalls = 0;
    __setRailwayInvokerTestHooks({
      validateOwnerSession: () => {
        ownerChecks++;
        return { ok: false, code: "DENIED", reason: "denied" } as unknown as ReturnType<typeof import("../../../control/owner-authentication/contract").validateOwnerSession>;
      },
      railwayGraphql: async () => {
        gqlCalls++;
        return { http_status: 200, data: {}, errors: [], auth_required: false, summary: "ok" };
      },
    });

    for (const row of mutationCases) {
      const noSession = await invokeRailwayConnector(command({ intent: row.intent, ...row.payload }));
      ok(noSession.ok === false && noSession.summary === "OWNER_AUTHORIZATION_REQUIRED", `${row.intent} should require owner authorization`);
      const denied = await invokeRailwayConnector(command({ intent: row.intent, owner_session_id: "owner-session-1", ...row.payload }));
      ok(denied.ok === false && denied.summary === "OWNER_AUTHORIZATION_DENIED", `${row.intent} should deny invalid owner authorization`);
    }
    ok(ownerChecks === mutationCases.length, "denied mutations should validate owner session");
    ok(gqlCalls === 0, "denied mutations must not reach Railway GraphQL");
  });

  await check("mutations call Owner authorization before Railway GraphQL", async () => {
    const order: string[] = [];
    __setRailwayInvokerTestHooks({
      validateOwnerSession: () => {
        order.push("owner");
        return { ok: true, session: {} } as unknown as ReturnType<typeof import("../../../control/owner-authentication/contract").validateOwnerSession>;
      },
      railwayGraphql: async (document) => {
        order.push("graphql");
        if (document.includes("serviceCreate")) {
          return { http_status: 200, data: { serviceCreate: { id: "svc_2", name: "svc-new" } }, errors: [], auth_required: false, summary: "ok" };
        }
        if (document.includes("serviceConnectRepo")) {
          return { http_status: 200, data: { serviceConnectRepo: true }, errors: [], auth_required: false, summary: "ok" };
        }
        if (document.includes("serviceDomainCreate")) {
          return { http_status: 200, data: { serviceDomainCreate: { domain: "app.example.com" } }, errors: [], auth_required: false, summary: "ok" };
        }
        if (document.includes("deploymentRedeploy")) {
          return { http_status: 200, data: { deploymentRedeploy: { id: "dep_2", status: "QUEUED" } }, errors: [], auth_required: false, summary: "ok" };
        }
        return { http_status: 200, data: { serviceInstanceDeployV2: "dep_2" }, errors: [], auth_required: false, summary: "ok" };
      },
    });

    for (const row of mutationCases) {
      const out = await invokeRailwayConnector(command({ intent: row.intent, owner_session_id: "verified-session", ...row.payload }));
      ok(out.ok === true, `${row.intent} should pass with verified owner authorization`);
    }
    ok(order.length === mutationCases.length * 2, "every mutation should call owner check and graphql exactly once");
    for (let i = 0; i < order.length; i += 2) {
      ok(order[i] === "owner" && order[i + 1] === "graphql", "owner auth must run before mutation GraphQL call");
    }
  });

  if (failed > 0) process.exit(1);
  console.log(`PASS railway-connector-owner-auth (${passed} checks)`);
}

void run();

import { createRailwayConnectorInvoker } from "../../../connections/railway/router-invoker";

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

  await check("read intents are not blocked by mutation owner gate", async () => {
    const gqlCalls: GraphqlCall[] = [];
    let validateCalls = 0;
    const invokeRailwayConnector = createRailwayConnectorInvoker({
      validateOwnerSession: () => {
        validateCalls++;
        return { ok: true, session: {} } as ReturnType<typeof import("../../../control/owner-authentication/contract").validateOwnerSession>;
      },
      railwayGraphql: async (document, variables) => {
        gqlCalls.push({ document, variables });
        if (document.includes("EnvironmentStatus")) {
          return { http_status: 200, data: { environment: { id: "env_1", name: "prod", projectId: "proj_1" } }, errors: [], auth_required: false, summary: "ok" };
        }
        if (document.includes("ProjectServices")) {
          return { http_status: 200, data: { project: { id: "proj_1", name: "p", services: { edges: [{ node: { id: "svc_1", name: "dna-os-circuit" } }] } } }, errors: [], auth_required: false, summary: "ok" };
        }
        if (document.includes("ServiceInstance") || document.includes("CurrentDomain")) {
          return { http_status: 200, data: { serviceInstance: { domains: { serviceDomains: [{ domain: "app.example.com" }] }, latestDeployment: { id: "dep_1", status: "SUCCESS", canRedeploy: true } }, service: { id: "svc_1", name: "svc" } }, errors: [], auth_required: false, summary: "ok" };
        }
        if (document.includes("SourceStatus")) {
          return { http_status: 200, data: { service: { id: "svc_1", name: "svc", source: { owner: "o", repo: "r", branch: "main", provider: "github" } } }, errors: [], auth_required: false, summary: "ok" };
        }
        if (document.includes("VariableNames")) {
          return { http_status: 200, data: { environment: { id: "env_1", variables: { edges: [{ node: { name: "HOST" } }] } } }, errors: [], auth_required: false, summary: "ok" };
        }
        if (document.includes("DeploymentLogs")) {
          return { http_status: 200, data: { deployment: { id: "dep_1", logs: "line-1" } }, errors: [], auth_required: false, summary: "ok" };
        }
        if (document.includes("Deployment(")) {
          return { http_status: 200, data: { deployment: { id: "dep_1", status: "SUCCESS", staticUrl: "https://example.com", canRedeploy: true, meta: { commitSha: "abc1234" } } }, errors: [], auth_required: false, summary: "ok" };
        }
        return { http_status: 200, data: { project: { id: "proj_1", name: "project", description: "desc" } }, errors: [], auth_required: false, summary: "ok" };
      },
    });

    const missingProject = await invokeRailwayConnector(command({ intent: "railway.project_status" }));
    ok(missingProject.ok === false && missingProject.summary === "project_id required", "project_status should validate required project_id");

    for (const row of readCases) {
      const out = await invokeRailwayConnector(command({ intent: row.intent, ...row.payload }));
      ok(out.summary !== "OWNER_AUTHORIZATION_REQUIRED", `${row.intent} should not require owner mutation authorization`);
      ok(out.summary !== "OWNER_AUTHORIZATION_DENIED", `${row.intent} should not run mutation owner authorization gate`);
      if (row.intent === "railway.project_status") {
        ok(out.summary !== "project_id required", "project_status should dispatch when project_id is provided");
      }
    }
    ok(validateCalls === 0, "read intents must not attempt the mutation owner authorization gate");
    ok(gqlCalls.length === readCases.length, "all read intents should dispatch to read GraphQL handlers");
  });

  const mutationCases: Array<{ intent: string; payload: Record<string, unknown> }> = [
    { intent: "railway.create_service", payload: { project_id: "proj_1", service_name: "svc-new" } },
    { intent: "railway.connect_source", payload: { service_id: "svc_1", source_owner: "org", source_repo: "repo" } },
    { intent: "railway.create_deployment_trigger", payload: { service_id: "svc_1", environment_id: "env_1", commit_sha: "a".repeat(40) } },
    { intent: "railway.deploy_revision", payload: { service_id: "svc_1", environment_id: "env_1", commit_sha: "b".repeat(40) } },
    { intent: "railway.redeploy_deployment", payload: { deployment_id: "dep_1" } },
    { intent: "railway.create_domain", payload: { service_id: "svc_1", environment_id: "env_1", domain: "app.example.com" } },
  ];

  await check("mutation intents fail closed without owner authorization", async () => {
    const gqlCalls: GraphqlCall[] = [];
    const invokeRailwayConnector = createRailwayConnectorInvoker({
      validateOwnerSession: () => ({ ok: false, reason_code: "OWNER_SESSION_NOT_FOUND", detail: "nope" } as ReturnType<typeof import("../../../control/owner-authentication/contract").validateOwnerSession>),
      railwayGraphql: async (document, variables) => {
        gqlCalls.push({ document, variables });
        return { http_status: 200, data: {}, errors: [], auth_required: false, summary: "ok" };
      },
    });
    for (const row of mutationCases) {
      const out = await invokeRailwayConnector(command({ intent: row.intent, ...row.payload }));
      ok(out.ok === false, `${row.intent} should fail`);
      ok(out.summary === "OWNER_AUTHORIZATION_REQUIRED", `${row.intent} should fail as owner authorization required`);
      ok(out.auth_required === true, `${row.intent} should signal auth_required`);
    }
    ok(gqlCalls.length === 0, "missing owner authorization must not reach Railway GraphQL");
  });

  await check("mutation owner authorization check runs before mutation argument checks", async () => {
    const invokeRailwayConnector = createRailwayConnectorInvoker({
      validateOwnerSession: () => ({ ok: false, reason_code: "OWNER_SESSION_NOT_FOUND", detail: "nope" } as ReturnType<typeof import("../../../control/owner-authentication/contract").validateOwnerSession>),
      railwayGraphql: async () => ({ http_status: 200, data: {}, errors: [], auth_required: false, summary: "ok" }),
    });
    const out = await invokeRailwayConnector(command({
      intent: "railway.create_service",
      owner_session_id: "invalid-session-id",
    }));
    ok(out.ok === false, "mutation should fail");
    ok(out.summary === "OWNER_AUTHORIZATION_DENIED", "invalid owner session should be denied before validating mutation fields");
  });

  await check("mutation owner authorization runs before Railway GraphQL mutation calls", async () => {
    const sequence: string[] = [];
    const invokeRailwayConnector = createRailwayConnectorInvoker({
      validateOwnerSession: () => {
        sequence.push("authorize");
        return { ok: true, session: { owner_identity: "owner" } } as ReturnType<typeof import("../../../control/owner-authentication/contract").validateOwnerSession>;
      },
      railwayGraphql: async () => {
        sequence.push("graphql");
        return {
          http_status: 200,
          data: { serviceCreate: { id: "svc_2", name: "svc-new" } },
          errors: [],
          auth_required: false,
          summary: "ok",
        };
      },
    });
    const out = await invokeRailwayConnector(command({
      intent: "railway.create_service",
      owner_session_id: "valid-session",
      project_id: "proj_1",
      service_name: "svc-new",
    }));
    ok(out.ok === true, "authorized mutation should succeed");
    ok(sequence.join(">") === "authorize>graphql", "owner authorization must happen before Railway GraphQL mutation");
  });

  await check("deployment trigger validates commit_sha and emits trigger id on success", async () => {
    const invokeRailwayConnector = createRailwayConnectorInvoker({
      validateOwnerSession: () => ({ ok: true, session: { owner_identity: "owner" } } as ReturnType<typeof import("../../../control/owner-authentication/contract").validateOwnerSession>),
      railwayGraphql: async () => ({
        http_status: 200,
        data: { serviceInstanceDeployV2: "dep-trigger-1" },
        errors: [],
        auth_required: false,
        summary: "ok",
      }),
    });

    const badCommit = await invokeRailwayConnector(command({
      intent: "railway.create_deployment_trigger",
      owner_session_id: "valid-session",
      service_id: "svc_1",
      environment_id: "env_1",
      commit_sha: "not-a-sha",
    }));
    ok(badCommit.ok === false && badCommit.summary === "DEPLOYMENT_REVISION_NOT_FOUND", "invalid commit should fail locally");

    const created = await invokeRailwayConnector(command({
      intent: "railway.create_deployment_trigger",
      owner_session_id: "valid-session",
      service_id: "svc_1",
      environment_id: "env_1",
      commit_sha: "a".repeat(40),
    }));
    ok(created.ok === true, "valid trigger should succeed");
    ok(created.summary === "deployment trigger created", "trigger should have dedicated summary");
    ok(created.artifacts.some((row) => row.kind === "deployment_trigger_id" && row.ref === "dep-trigger-1"), "trigger id artifact must be present");
  });

  if (failed > 0) process.exit(1);
  console.log(`PASS railway-connector-owner-auth (${passed} checks)`);
}

void run();

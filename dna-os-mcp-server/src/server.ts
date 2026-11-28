/**
 * MCP tool/resource registration — transport-agnostic. This module knows
 * nothing about stdio, HTTP, or any other wire format; see stdio.ts (and any
 * future remote transport) for that. Adding a transport later means writing
 * a new thin entrypoint that calls createDnaOsMcpServer().connect(transport)
 * — this file does not change.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"

import type { DnaOsConfig } from "./config.js"
import type { McpAdapterError } from "./errors.js"
import type { NormalizedResult } from "./normalize.js"

import { TOOL_NAME as SYSTEM_SUMMARY, runArchitectureSystemSummary } from "./tools/architectureSystemSummary.js"
import { TOOL_NAME as LIST_MODULES, runRegistryListModules } from "./tools/registryListModules.js"
import { TOOL_NAME as LIST_COMMANDS, runRegistryListCommands } from "./tools/registryListCommands.js"
import { TOOL_NAME as DEPENDENCY_GRAPH, runArchitectureGetDependencyGraph } from "./tools/architectureDependencyGraph.js"
import { TOOL_NAME as RUNTIME_QUERY, runRuntimeQuery, type RuntimeQueryInput } from "./tools/runtimeQuery.js"
import { TOOL_NAME as CONTRACTOR_TASK_CLAIM, runContractorTaskClaim, type ContractorTaskClaimInput } from "./tools/contractorTaskClaim.js"
import { TOOL_NAME as CONTRACTOR_EVIDENCE_SUBMIT, runContractorEvidenceSubmit, type ContractorEvidenceSubmitInput } from "./tools/contractorEvidenceSubmit.js"
import { TOOL_NAME as CONTRACTOR_STATUS, runContractorStatus, type ContractorStatusInput } from "./tools/contractorStatus.js"
import { RESOURCE_NAME as CONSTITUTION_RESOURCE, RESOURCE_URI as CONSTITUTION_URI, readConstitutionGetRules } from "./resources/constitutionGetRules.js"

const TOOL_DEFINITIONS = [
  {
    name: SYSTEM_SUMMARY,
    description: "DNA OS layer stack, core/canonical principles, and authority model. Read-only, no args.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: LIST_MODULES,
    description: "List every registered DNA OS module (reuses the existing registry.list_modules command via GET /api/v1/modules). Read-only, no args.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: LIST_COMMANDS,
    description: "List every registered DNA OS command from command-registry.json. Read-only, no args.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: DEPENDENCY_GRAPH,
    description: "DNA OS's allowed cross-layer import graph (registry/dependency-graph.json). Read-only, no args.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: RUNTIME_QUERY,
    description: "Passthrough to POST /api/v1/query — executes a single read-only DNA OS command (requires_confirmation:false only; the dispatcher rejects anything else). Requires DNA_OS_API_TOKEN to be configured.",
    inputSchema: {
      type: "object" as const,
      properties: {
        command: { type: "string", description: "Dotted DNA OS command name, e.g. debt.list" },
        args: { type: "object", description: "Command arguments, per registry.list_commands output" },
      },
      required: ["command"],
    },
  },
  {
    name: CONTRACTOR_TASK_CLAIM,
    description: "Claim a contractor task: creates a real JobContract (workerTaskOrchestrator) + queue job (queueRuntime) and returns the canonical WorkerRequest payload. Requires DNA_OS_API_TOKEN with a propose scope.",
    inputSchema: {
      type: "object" as const,
      properties: {
        ownerId: { type: "string", description: "Owning session id (queue ownership is enforced by queueRuntime)" },
        capabilityRequired: { type: "string", description: "DNA OS capability the contractor must provide, e.g. code.generate" },
        taskDescription: { type: "string" },
        acceptanceCriteria: { type: "array", items: { type: "string" } },
        permittedReadScope: { type: "array", items: { type: "string" } },
        permittedWriteScope: { type: "array", items: { type: "string" } },
        permittedTools: { type: "array", items: { type: "string" } },
        forbiddenTools: { type: "array", items: { type: "string" } },
      },
      required: ["ownerId", "capabilityRequired", "taskDescription"],
    },
  },
  {
    name: CONTRACTOR_EVIDENCE_SUBMIT,
    description: "Submit a contractor result/evidence (WorkerResponse shape). Evidence refs are verified by changeSetRuntime; an unverifiable SUCCEEDED result is downgraded to PARTIAL. Nothing is applied.",
    inputSchema: {
      type: "object" as const,
      properties: {
        ownerId: { type: "string" },
        jobId: { type: "string" },
        workerResponse: { type: "object", description: "WorkerResponse: { status, output?, error?, evidence? }" },
        evidenceRefs: { type: "array", items: { type: "object", properties: { kind: { type: "string" }, refId: { type: "string" } } } },
      },
      required: ["ownerId", "jobId", "workerResponse"],
    },
  },
  {
    name: CONTRACTOR_STATUS,
    description: "Read contractor job status from the existing queue lifecycle (queueRuntime.listJobs/getJob). Read-only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        ownerId: { type: "string" },
        jobId: { type: "string", description: "Optional: one job instead of the owner's whole list" },
      },
      required: ["ownerId"],
    },
  },
]

const RESOURCE_DEFINITIONS = [
  {
    uri: CONSTITUTION_URI,
    name: CONSTITUTION_RESOURCE,
    description: "The full DNA OS Constitution (registry/CONSTITUTION.json), read-only.",
    mimeType: "application/json",
  },
]

function errorToToolResult(error: McpAdapterError) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error }, null, 2) }],
  }
}

function resultToToolResult(result: NormalizedResult) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  }
}

export function createDnaOsMcpServer(config: DnaOsConfig): Server {
  const server = new Server(
    { name: "dna-os-mcp-server", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }))

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: RESOURCE_DEFINITIONS }))

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== CONSTITUTION_URI) {
      throw new Error(`Unknown resource URI: ${request.params.uri}`)
    }
    const outcome = await readConstitutionGetRules(config)
    if (!outcome.ok) {
      throw new Error(JSON.stringify(outcome.error))
    }
    return {
      contents: [
        {
          uri: CONSTITUTION_URI,
          mimeType: "application/json",
          text: JSON.stringify(outcome.result, null, 2),
        },
      ],
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    switch (name) {
      case CONTRACTOR_TASK_CLAIM: {
        const outcome = await runContractorTaskClaim(config, args as unknown as ContractorTaskClaimInput)
        return outcome.ok ? resultToToolResult(outcome.result) : errorToToolResult(outcome.error)
      }
      case CONTRACTOR_EVIDENCE_SUBMIT: {
        const outcome = await runContractorEvidenceSubmit(config, args as unknown as ContractorEvidenceSubmitInput)
        return outcome.ok ? resultToToolResult(outcome.result) : errorToToolResult(outcome.error)
      }
      case CONTRACTOR_STATUS: {
        const outcome = await runContractorStatus(config, args as unknown as ContractorStatusInput)
        return outcome.ok ? resultToToolResult(outcome.result) : errorToToolResult(outcome.error)
      }
      case SYSTEM_SUMMARY: {
        const outcome = await runArchitectureSystemSummary(config)
        return outcome.ok ? resultToToolResult(outcome.result) : errorToToolResult(outcome.error)
      }
      case LIST_MODULES: {
        const outcome = await runRegistryListModules(config)
        return outcome.ok ? resultToToolResult(outcome.result) : errorToToolResult(outcome.error)
      }
      case LIST_COMMANDS: {
        const outcome = await runRegistryListCommands(config)
        return outcome.ok ? resultToToolResult(outcome.result) : errorToToolResult(outcome.error)
      }
      case DEPENDENCY_GRAPH: {
        const outcome = await runArchitectureGetDependencyGraph(config)
        return outcome.ok ? resultToToolResult(outcome.result) : errorToToolResult(outcome.error)
      }
      case RUNTIME_QUERY: {
        const input = args as unknown as RuntimeQueryInput
        if (!input?.command) {
          return errorToToolResult({
            code: "BAD_REQUEST",
            message: "runtime.query requires a { command } argument.",
            endpoint: "/api/v1/query",
            retryable: false,
          })
        }
        const outcome = await runRuntimeQuery(config, input)
        return outcome.ok ? resultToToolResult(outcome.result) : errorToToolResult(outcome.error)
      }
      default:
        return errorToToolResult({
          code: "BAD_REQUEST",
          message: `Unknown tool: ${name}`,
          endpoint: "n/a",
          retryable: false,
        })
    }
  })

  return server
}

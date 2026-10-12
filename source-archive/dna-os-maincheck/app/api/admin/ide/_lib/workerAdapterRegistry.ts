/**
 * The existing Worker Adapter Registry, shared by provider/health views and
 * developer selection. Registry access does not require the selection engine.
 * Adapter objects, order and state are unchanged; this is not a new runtime.
 */
import type { WorkerAdapter } from "./workerAdapter";
import { anthropicApiAdapter, openaiApiAdapter, geminiApiAdapter } from "./workerAdapters/apiWorkerAdapter";
import { digitalOceanApiAdapter } from "./workerAdapters/digitalOceanWorkerAdapter";
import { claudeCliAdapter } from "./workerAdapters/cliWorkerAdapter";
import { mcpWorkerAdapter } from "./workerAdapters/mcpWorkerAdapter";
import { mcpDnaOsAdapter } from "./workerAdapters/mcpDnaOsAdapter";
import { ollamaLocalAdapter } from "./workerAdapters/localModelWorkerAdapter";
import { humanWorkerAdapter } from "./workerAdapters/humanWorkerAdapter";

export const WORKER_ADAPTER_REGISTRY: WorkerAdapter[] = [
  anthropicApiAdapter, openaiApiAdapter, geminiApiAdapter, digitalOceanApiAdapter, claudeCliAdapter, mcpWorkerAdapter, mcpDnaOsAdapter, ollamaLocalAdapter, humanWorkerAdapter,
];

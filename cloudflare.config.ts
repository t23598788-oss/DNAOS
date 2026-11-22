import { bindings, defineConfig, defineWorker, triggers } from "cf/config";

const workerName = "wandering-queen-756b";

export default defineConfig({
  worker: defineWorker({
    name: workerName,
    entrypoint: "./workers/dnaos-main-worker.ts",
    compatibilityDate: "2026-11-15",
    triggers: [
      triggers.queue({
        name: "dnaos-core-events",
        maxBatchSize: 10,
        maxBatchTimeout: 2,
        maxRetries: 8,
      }),
    ],
    env: {
      DNAOS_CORE_EVENTS: bindings.queue({ name: "dnaos-core-events" }),
    },
  }),
});

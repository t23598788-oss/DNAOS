/** Cloudflare service configuration for the fulfillment-ingest Worker. */
import { bindings, defineConfig, defineWorker } from "cf/config";

export const fulfillmentWorker = defineWorker({
  name: "dnaos-fulfillment-ingest",
  entrypoint: "./index.ts",
  compatibilityDate: "2026-11-15",
  observability: { enabled: true, redactQueryString: true, logs: { enabled: true, persist: true, invocationLogs: false, headSamplingRate: 1 } },
  workersDev: false,
  previewUrls: false,
  // Runtime values are provisioned separately; no credentials are loaded by builds.
  env: {
    SUPABASE_URL: bindings.secret(),
    GATEWAY_INTERNAL_SECRET: bindings.secret(),
    SUPABASE_SERVICE_ROLE_KEY: bindings.secret(),
  },
});

export default defineConfig({
  worker: fulfillmentWorker,
});

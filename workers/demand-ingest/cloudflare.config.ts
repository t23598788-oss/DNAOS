/** Cloudflare service configuration for the demand-ingest Worker. */
import { bindings, defineConfig, defineWorker } from "cf/config";

export const demandWorker = defineWorker({
  name: "dnaos-demand-ingest",
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
    STOCK_ADAPTER_ID: bindings.secret(),
  },
});

export default defineConfig({
  worker: demandWorker,
});

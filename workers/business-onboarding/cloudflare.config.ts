/** Cloudflare bindings and service configuration for the DNA OS authentication and command Gateway. */
import { bindings, defineConfig, defineWorker } from "cf/config";
import { stockWorker } from "../stock-ingest/cloudflare.config.ts";
import { demandWorker } from "../demand-ingest/cloudflare.config.ts";
import { fulfillmentWorker } from "../fulfillment-ingest/cloudflare.config.ts";

export default defineConfig({
  worker: defineWorker({
    name: "dnaos-business-onboarding",
    entrypoint: "./index.ts",
    compatibilityDate: "2026-11-17",
    observability: { enabled: true, redactQueryString: true, logs: { enabled: true, persist: true, invocationLogs: false, headSamplingRate: 1 } },
    env: {
      AUTH_RATE_LIMITER: bindings.rateLimit({
        namespace: "dnaos-business-onboarding-auth",
        simple: { limit: 5, period: 60 },
      }),
      RATE_LIMITER: bindings.rateLimit({
        namespace: "dnaos-business-onboarding-users",
        simple: { limit: 60, period: 60 },
      }),
      // Values are supplied out of band; never read real credentials during builds.
      SUPABASE_URL: bindings.secret(),
      SUPABASE_ANON_KEY: bindings.secret(),
      SUPABASE_SERVICE_ROLE_KEY: bindings.secret(),
      AUTH_APP_ORIGIN: bindings.secret(),
      ERP_CREDENTIALS_ENCRYPTION_KEY: bindings.secret(),
      ERP_CREDENTIALS_KEY_VERSION: bindings.secret(),
      GATEWAY_INTERNAL_SECRET: bindings.secret(),
      STOCK_INGEST: bindings.worker({ worker: stockWorker }),
      DEMAND_INGEST: bindings.worker({ worker: demandWorker }),
      FULFILLMENT_INGEST: bindings.worker({ worker: fulfillmentWorker }),
    },
  }),
});

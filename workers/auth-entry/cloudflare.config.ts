/** Production configuration for the isolated DNA OS login surface. */
import { bindings, defineConfig, defineWorker, triggers } from "cf/config";

export default defineConfig({
  worker: defineWorker({
    name: "dnaos-auth-entry",
    entrypoint: "./index.ts",
    compatibilityDate: "2026-11-17",
    workersDev: false,
    previewUrls: false,
    observability: {
      enabled: true,
      redactQueryString: true,
      logs: { enabled: true, persist: true, invocationLogs: false, headSamplingRate: 1 },
    },
    triggers: [
      triggers.fetch({ pattern: "dnaos.dev/login", zone: "dnaos.dev" }),
      triggers.fetch({ pattern: "dnaos.dev/start", zone: "dnaos.dev" }),
      triggers.fetch({ pattern: "dnaos.dev/v1/auth/*", zone: "dnaos.dev" }),
    ],
    env: {
      SUPABASE_URL: bindings.secret(),
      SUPABASE_ANON_KEY: bindings.secret(),
      AUTH_APP_ORIGIN: { type: "text", value: "https://dnaos.dev" },
      AUTH_RATE_LIMITER: bindings.rateLimit({
        // Cloudflare requires a positive integer string for namespace IDs.
        // Keep this namespace unique to the login Worker.
        namespace: "2026112201",
        simple: { limit: 5, period: 60 },
      }),
    },
  }),
});

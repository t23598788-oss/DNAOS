import { defineConfig, devices } from "playwright/test";

// TASK-070 (capability #62, STEP 1) — minimal, real Playwright config.
//
// Why this exists: the Owner's instruction ("ห้ามเดา ทดสอบ interaction จริง")
// requires real, interaction-tested verification of /admin/ide, not a
// structural code-read. `playwright` (v1.62.1) was already a real dependency
// in package.json before this task — no new package was installed. The
// separate `@playwright/test` package is NOT installed, but the installed
// `playwright` package itself ships the identical test-runner/config API
// under its `playwright/test` subpath export (confirmed real at authoring
// time: `require('playwright/test')` resolves and exposes `defineConfig`,
// `test`, `expect`, `chromium`, etc. — same module Playwright's own docs
// describe as what `@playwright/test` re-exports). So this file uses
// `playwright/test`, never `@playwright/test`, and adds zero new
// dependencies to package.json.
//
// This does not start its own dev server (webServer) — TASK-070's audit
// starts/observes `npm run dev` manually so its real startup logs can be
// checked before tests run, per the task's explicit instruction.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.DNA_OS_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    // Runs without the "setup" dependency — these tests need no real
    // authenticated session (see e2e/auth-gate.spec.ts's own comment for
    // why: real ADMIN_EMAIL/ADMIN_PASSWORD from .env.local are genuinely
    // rejected by the real, live Supabase Auth instance right now).
    {
      name: "no-auth",
      testMatch: /auth-gate\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    // The full interaction audit — requires "setup" to succeed first (a
    // real authenticated session). Currently blocked by the same stale
    // credential issue "no-auth" documents; kept as real, ready-to-run
    // infrastructure for whenever the Owner rotates ADMIN_PASSWORD (or a
    // service-role test-session convention is explicitly approved).
    {
      name: "chromium",
      testMatch: /admin-ide-audit\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/admin.json" },
      dependencies: ["setup"],
    },
  ],
});

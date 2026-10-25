import { test as setup, expect } from "playwright/test";
import path from "path";

// TASK-070 real-auth setup — logs in through the SAME real login form a
// human uses — RETIRED2026-09-24: /login now emails a magic link
// using the real ADMIN_EMAIL/ADMIN_PASSWORD already configured in this
// repo's own .env.local (the same credentials app/api/auth/auto-login
// already uses for the native Tauri wrap — see that route's comment).
// This is NOT a fabricated auth bypass: it drives the real sign-in form
// with real, already-provisioned owner credentials, then saves the real
// resulting Supabase session cookies for reuse by the audit spec.
const STORAGE_STATE_PATH = path.join(__dirname, ".auth", "admin.json");

setup("authenticate as real admin via /login", async ({ page }) => {
  // RETIRED — single auth flow (2026-09-24): /login is now passwordless
  // (signInWithOtp → emailed link → /auth/confirm). No password field or
  // password endpoint exists anymore; completing the flow requires the Owner
  // to open the email (this suite deliberately never touches a mailbox).
  setup.skip(true, "email-link flow: no scripted password login exists by design");
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "ADMIN_EMAIL / ADMIN_PASSWORD not set in the environment — this repo's " +
      ".env.local defines them (same real credentials app/api/auth/auto-login " +
      "already uses), but they weren't loaded into this process's env. Refusing " +
      "to fabricate a fake session."
    );
  }

  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('button[type="submit"]').click();

  // Real navigation away from /login proves a real session was established
  // (the login form does a hard window.location.href redirect on success).
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
  await expect(page).not.toHaveURL(/\/login/);

  await page.context().storageState({ path: STORAGE_STATE_PATH });
});

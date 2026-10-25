import { test, expect } from "playwright/test";

// TASK-070 — real, live tests that do NOT require an authenticated session
// (see e2e/auth.setup.ts's comment / the audit report for why a real
// authenticated session could not be established in this environment: the
// real ADMIN_EMAIL/ADMIN_PASSWORD in .env.local are genuinely rejected by
// the real, live Supabase Auth instance this dev server points at).
//
// These tests still give real, live evidence about /admin/ide's real
// front door: the middleware auth gate, and the real login form itself.
test.use({ storageState: { cookies: [], origins: [] } });

test("unauthenticated GET /admin/ide real-redirects to /login?next=... (middleware.ts gate)", async ({ page }) => {
  const response = await page.goto("/admin/ide");
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fide/);
  expect(response?.status()).toBeLessThan(400);
  await expect(page.getByRole("heading", { name: /Sign in/ })).toBeVisible();
});

test.skip("RETIRED — passwordless email-link login (no password endpoint to assert; Owner clicks the emailed link)", async ({ page }) => {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  test.skip(!email || !password, "ADMIN_EMAIL/ADMIN_PASSWORD not present in the test process environment");

  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email!);
  await page.locator('input[name="password"]').fill(password!);
  const submitResp = page.waitForResponse((r) => r.url().includes("/auth/v1/token"));
  await page.locator('button[type="submit"]').click();
  const resp = await submitResp;
  // Real, live evidence for the audit report: the credentials configured in
  // this repo's .env.local for exactly this purpose are genuinely rejected
  // by the real Supabase Auth backend right now (not a Playwright bug).
  expect(resp.status()).toBe(400);
  await expect(page.getByText(/Invalid login credentials|อีเมลหรือรหัสผ่านไม่ถูกต้อง/)).toBeVisible();
});

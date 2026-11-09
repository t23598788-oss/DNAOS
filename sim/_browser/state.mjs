import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes('supabase.com')) ?? ctx.pages()[0];
await page.waitForLoadState('domcontentloaded').catch(() => {});
const body = await page.evaluate(() => document.body.innerText.slice(0, 1200));
console.log('URL:', page.url());
console.log('TITLE:', await page.title());
const signals = {
  signInForm: /sign\s*in|magic link|continue with|email/i.test(body),
  passwordField: await page.locator('input[type=password]').count(),
  emailField: await page.locator('input[type=email], input[name=email]').count(),
  projectsNav: /projects|organizations|new project/i.test(body),
};
console.log('SIGNALS:', JSON.stringify(signals));
console.log('--- body ---');
console.log(body);
process.exit(0);

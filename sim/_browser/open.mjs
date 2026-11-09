import { chromium } from 'playwright';

const ctx = await chromium.launchPersistentContext('.sim-browser-profile', {
  channel: 'chrome',
  headless: false,
  viewport: null,
  args: ['--remote-debugging-port=9222', '--no-first-run', '--no-default-browser-check'],
});
const pages = ctx.pages();
const page = pages[0] ?? (await ctx.newPage());
await page.goto('https://supabase.com/dashboard/sign-in', {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});
console.log('opened:', page.url());
console.log('title:', await page.title());
setInterval(() => {}, 1 << 30);

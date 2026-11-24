import { test, expect } from '@playwright/test';

export const SIGNAL = '?signal=localhost:9000';

export async function freshKey(page) {
  await page.goto('/tests/blank.html');
  return page.evaluate(async () => (await import('/keys.js')).newKey());
}

/** Open the app as a role in an isolated test room (?room= works on localhost only), tapping the one first-run step. */
export async function openAs(context, key, role, { tap = true, extra = '' } = {}) {
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', role, e.message));
  await page.goto(`/${SIGNAL}&room=${key}${extra}`);
  if (tap) await page.click(`#b-who-${role}`);
  return page;
}

export const stateOf = (page) => page.evaluate(() => window.__ah.state());

export async function waitState(page, want, timeout = 15000) {
  await page.waitForFunction((w) => window.__ah && window.__ah.state() === w, want, { timeout, polling: 100 });
}

export { test, expect };

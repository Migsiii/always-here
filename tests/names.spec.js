import { test, expect, freshKey, waitState, SIGNAL } from './helpers.js';

// Fake names only. Real names never live in the repo.
const NA = 'Alex';
const NB = 'Sam 🐼';
const frag = (key, r, na = NA, nb = NB) =>
  `#k=${key}&r=${r}&na=${encodeURIComponent(na)}&nb=${encodeURIComponent(nb)}`;

test('N1 names from the link: title, waiting text, avatar, 375px, fragment stripped', async ({ browser, page }) => {
  const key = await freshKey(page);
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const a = await ctx.newPage();
  await a.goto(`/${SIGNAL}${frag(key, 'a')}`);
  await a.locator('#b-ready:visible, #b-share-done:visible').first().click();
  await waitState(a, 'waiting', 10000);
  expect(a.url()).not.toContain('na=');
  expect(a.url()).not.toContain('#');
  await expect(a.locator('#h-wait')).toHaveText(`Waiting for ${NB}…`);
  await expect(a.locator('#wait-initial')).toHaveText('S');
  expect(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const stored = await a.evaluate(() => JSON.parse(localStorage.getItem('ah.v1.names')));
  expect(stored).toEqual({ a: NA, b: NB });
  await ctx.close();
});

test('N2 emoji-first name: avatar initial is the whole emoji; call title and labels show it', async ({ browser, page }) => {
  const key = await freshKey(page);
  const ca = await browser.newContext(), cb = await browser.newContext();
  const a = await ca.newPage();
  await a.goto(`/${SIGNAL}${frag(key, 'a', NA, '🐼 Sam')}`);
  await a.locator('#b-ready:visible, #b-share-done:visible').first().click();
  await waitState(a, 'waiting', 10000);
  await expect(a.locator('#wait-initial')).toHaveText('🐼');
  const b = await cb.newPage();
  await b.goto(`/${SIGNAL}${frag(key, 'b', NA, '🐼 Sam')}`);
  await b.locator('#b-ready:visible, #b-share-done:visible').first().click();
  await waitState(a, 'call', 12000);
  expect(await a.title()).toContain('🐼 Sam');
  await expect(a.locator('#remote-initial')).toHaveText('🐼');
  await ca.close(); await cb.close();
});

test('N3 sanitising: control characters removed, length capped, bad encoding ignored', async ({ browser, page }) => {
  const key = await freshKey(page);
  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  const long = 'x'.repeat(60);
  await a.goto(`/${SIGNAL}#k=${key}&r=a&na=Al%00ex%0A&nb=${long}`);
  await a.locator('#b-ready:visible, #b-share-done:visible').first().click();
  const stored = await a.evaluate(() => JSON.parse(localStorage.getItem('ah.v1.names')));
  expect(stored.a).toBe('Alex');
  expect(stored.b.length).toBe(24);
  await a.evaluate(() => localStorage.removeItem('ah.v1.names'));
  await a.goto('/tests/blank.html');
  await a.goto(`/${SIGNAL}#k=${key}&r=a&na=%E0%A4%A&nb=ok`);
  await a.waitForFunction(() => window.__ah && localStorage.getItem('ah.v1.names'));
  const s2 = await a.evaluate(() => JSON.parse(localStorage.getItem('ah.v1.names')));
  expect(s2.a).toBeUndefined();
  expect(s2.b).toBe('ok');
  await ctx.close();
});

test('N4 share screen shows the link format and builds the link with encoded names', async ({ page }) => {
  await page.goto(`/${SIGNAL}`);
  await page.click('#b-start');
  await expect(page.locator('#s-share')).toContainText('&na=<name a>&nb=<name b>');
  await page.fill('#i-share-na', NA);
  await page.fill('#i-share-nb', NB);
  const v = await page.inputValue('#i-share');
  expect(v).toContain(`&na=${encodeURIComponent(NA)}&nb=${encodeURIComponent(NB)}`);
  expect(v).toContain('%F0%9F%90%BC');
});

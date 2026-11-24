import { test, expect, freshKey, openAs, waitState, SIGNAL } from './helpers.js';

// Nicknames are constants in source: a = "Bubiii", b = "baba 🐼". Never full names.

test('N1 names are constants: waiting text, avatar initial, 375px, nothing stored', async ({ browser, page }) => {
  const key = await freshKey(page);
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const a = await openAs(ctx, key, 'a');
  await waitState(a, 'waiting', 10000);
  await expect(a.locator('#h-wait')).toHaveText('Waiting for baba 🐼…');
  await expect(a.locator('#wait-initial')).toHaveText('B');
  expect(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await a.evaluate(() => localStorage.getItem('ah.v1.names'))).toBeNull();
  await ctx.close();
});

test('N2 call: title and labels use the nicknames, emoji renders; names in the address are ignored', async ({ browser, page }) => {
  const key = await freshKey(page);
  const ca = await browser.newContext(), cb = await browser.newContext();
  const a = await openAs(ca, key, 'a');
  const b = await cb.newPage();
  await b.goto(`/${SIGNAL}&room=${key}#na=Mallory&nb=Eve`);
  await b.click('#b-who-b');
  await waitState(a, 'call', 12000);
  expect(await a.title()).toContain('baba 🐼');
  await expect(a.locator('#remote-initial')).toHaveText('B');
  await waitState(b, 'call', 12000);
  expect(await b.title()).toContain('Bubiii');
  expect(await b.title()).not.toContain('Eve');
  await ca.close(); await cb.close();
});

test('N3 Settings has no name fields and no invite-link buttons; Switch person forgets the role', async ({ browser, page }) => {
  const key = await freshKey(page);
  const ctx = await browser.newContext();
  const a = await openAs(ctx, key, 'a');
  await waitState(a, 'waiting', 10000);
  await a.click('#b-settings-w');
  for (const id of ['#i-name-a', '#i-name-b', '#b-names', '#b-copy-a', '#b-copy-b']) await expect(a.locator(id)).toHaveCount(0);
  await expect(a.locator('#b-forget')).toHaveText('Switch person');
  await a.click('#b-forget');
  await expect(a.locator('#h-who')).toBeVisible();
  expect(await a.evaluate(() => localStorage.getItem('ah.v1.role'))).toBeNull();
  await ctx.close();
});

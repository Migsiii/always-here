import { test, expect, freshKey, openAs, waitState, stateOf, SIGNAL } from './helpers.js';

async function pair(browser, page0, { first = 'a', gap = 0, keyOverride, init } = {}) {
  const key = keyOverride || (await freshKey(page0));
  const ca = await browser.newContext();
  const cb = await browser.newContext();
  const ctx = { a: ca, b: cb };
  const second = first === 'a' ? 'b' : 'a';
  const p1 = await openAs(ctx[first], key, first);
  if (gap) await p1.waitForTimeout(gap);
  const p2 = await openAs(ctx[second], key, second);
  const pages = { [first]: p1, [second]: p2 };
  return { key, a: pages.a, b: pages.b, ca, cb, close: async () => { await ca.close(); await cb.close(); } };
}

const poke = (p) => p.mouse.move(120 + Math.random() * 50, 160);
const bothInCall = async (a, b, ms = 10000) => {
  await Promise.all([waitState(a, 'call', ms), waitState(b, 'call', ms)]);
  for (const p of [a, b]) await p.waitForFunction(() => window.__ah.remoteLive(), null, { timeout: ms });
};

test('T1 mangled link is rejected on the welcome screen', async ({ page }) => {
  const key = await freshKey(page);
  const bad = key.slice(0, 5) + (key[5] === 'A' ? 'B' : 'A') + key.slice(6);
  await page.goto(`/${SIGNAL}`);
  await page.fill('#i-link', `https://x.github.io/always-here/#k=${bad}&r=b`);
  await page.click('#f-link button[type=submit]');
  await expect(page.locator('#e-link')).toBeVisible();
  await expect(page.locator('#e-link')).toContainText('incomplete');
  expect(await stateOf(page)).toBe('setup');
  await page.fill('#i-link', 'nonsense');
  await page.click('#f-link button[type=submit]');
  await expect(page.locator('#e-link')).toContainText("doesn't look like a room link");
});

test('T2 alone for 20 s: waiting, no tracks, no streams', async ({ browser, page }) => {
  const key = await freshKey(page);
  const ctx = await browser.newContext();
  const a = await openAs(ctx, key, 'a');
  await waitState(a, 'waiting', 10000);
  await a.waitForTimeout(20000);
  expect(await stateOf(a)).toBe('waiting');
  expect(await a.evaluate(() => window.__ah.localTracks())).toBe(0);
  expect(await a.evaluate(() => [...document.querySelectorAll('video')].filter((v) => v.srcObject).length)).toBe(0);
  await ctx.close();
});

test('T3 A open, then B opens: both in call quickly with live video', async ({ browser, page }) => {
  const p = await pair(browser, page);
  const t0 = Date.now();
  await bothInCall(p.a, p.b, 8000);
  console.log('join took ms', Date.now() - t0);
  for (const x of [p.a, p.b]) expect(await x.evaluate(() => window.__ah.localTracks())).toBeGreaterThan(0);
  await p.close();
});

test('T4 B open first, A opens 10 s later', async ({ browser, page }) => {
  const p = await pair(browser, page, { first: 'b', gap: 10000 });
  await bothInCall(p.a, p.b, 12000);
  await p.close();
});

test('T5 B leaves: A back to waiting within 15 s, tracks stopped', async ({ browser, page }) => {
  const p = await pair(browser, page);
  await bothInCall(p.a, p.b);
  await p.b.close({ runBeforeUnload: true });
  await waitState(p.a, 'waiting', 15000);
  expect(await p.a.evaluate(() => window.__ah.localTracks())).toBe(0);
  expect(await p.a.evaluate(() => [...document.querySelectorAll('video')].filter((v) => v.srcObject).length)).toBe(0);
  await p.close();
});

test('T6 B goes silent (no heartbeat, no bye): A waiting within 15 s', async ({ browser, page }) => {
  const p = await pair(browser, page);
  await bothInCall(p.a, p.b);
  await p.b.evaluate(() => window.__ah.debug.freeze());
  const t0 = Date.now();
  await waitState(p.a, 'waiting', 15000);
  console.log('silent detect ms', Date.now() - t0);
  expect(await p.a.evaluate(() => window.__ah.localTracks())).toBe(0);
  await p.close();
});

test('T7 different keys never connect', async ({ browser, page }) => {
  const k1 = await freshKey(page), k2 = await freshKey(page);
  const ca = await browser.newContext(), cb = await browser.newContext();
  const a = await openAs(ca, k1, 'a');
  const b = await openAs(cb, k2, 'b');
  await a.waitForTimeout(12000);
  expect(await stateOf(a)).not.toBe('call');
  expect(await stateOf(b)).not.toBe('call');
  expect(await a.evaluate(() => window.__ah.localTracks())).toBe(0);
  await ca.close(); await cb.close();
});

test('T8 controls: mic, camera, step away', async ({ browser, page }) => {
  const p = await pair(browser, page);
  await bothInCall(p.a, p.b);
  await poke(p.a);
  await p.a.click('#b-mic');
  await expect(p.b.locator('#badge-mic')).toBeVisible();
  await expect(p.a.locator('#b-mic')).toHaveAttribute('aria-pressed', 'true');
  await p.a.click('#b-mic');
  await expect(p.b.locator('#badge-mic')).toBeHidden();
  await poke(p.a);
  await p.a.click('#b-cam');
  await expect(p.b.locator('#remote-avatar')).toBeVisible();
  await poke(p.a);
  await p.a.click('#b-cam');
  await expect(p.b.locator('#remote-avatar')).toBeHidden();

  await poke(p.b);
  await p.b.click('#b-away');
  await expect(p.a.locator('#o-remote-away')).toBeVisible();
  await expect(p.b.locator('#o-self-away')).toBeVisible();
  expect(await p.b.evaluate(() => window.__ah.localTracks())).toBe(0);
  await p.b.click('#b-back');
  await expect(p.a.locator('#o-remote-away')).toBeHidden();
  expect(await p.b.evaluate(() => window.__ah.localTracks())).toBeGreaterThan(0);
  await p.a.waitForFunction(() => window.__ah.remoteLive(), null, { timeout: 8000 });
  await p.close();
});

test('T9 heart shows on both sides', async ({ browser, page }) => {
  const p = await pair(browser, page);
  await bothInCall(p.a, p.b);
  await poke(p.a);
  await p.a.click('#b-heart');
  await expect(p.b.locator('#hearts .heart').first()).toBeAttached();
  await expect(p.a.locator('#hearts .heart').first()).toBeAttached();
  await p.close();
});

test('T10 together timer counts', async ({ browser, page }) => {
  const p = await pair(browser, page);
  await bothInCall(p.a, p.b);
  await p.a.waitForTimeout(2500);
  expect(await p.a.locator('#timer').textContent()).not.toBe('0:00:00');
  await p.close();
});

test('T11 sound chip after a gesture-less reload; title shows who is here', async ({ browser, page }) => {
  const key = await freshKey(page);
  const ca = await browser.newContext(), cb = await browser.newContext();
  // Simulate a browser that keeps audio suspended until resume() is called.
  await ca.addInitScript(() => {
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor() { super(); this._u = false; }
      get state() { return this._u ? super.state : 'suspended'; }
      resume() { this._u = true; return super.resume(); }
    };
  });
  const a = await openAs(ca, key, 'a');
  await waitState(a, 'waiting', 10000);
  await a.reload();
  await waitState(a, 'waiting', 10000);
  await expect(a.locator('#chip-sound')).toBeVisible();
  const b = await openAs(cb, key, 'b');
  await waitState(a, 'call', 10000);
  expect(await a.title()).toContain('You');
  await ca.close(); await cb.close();
});

test('T12 wrong handshake proof never reaches a call', async ({ browser, page }) => {
  const key = await freshKey(page);
  const ca = await browser.newContext(), cb = await browser.newContext();
  const a = await openAs(ca, key, 'a');
  const b = await openAs(cb, key, 'b', { tap: false });
  await b.evaluate(() => { window.__ah.debug.badAuth = true; });
  await b.locator('#b-ready').click();
  await b.waitForTimeout(10000);
  expect(await stateOf(a)).not.toBe('call');
  expect(await stateOf(b)).not.toBe('call');
  expect(await a.evaluate(() => window.__ah.localTracks())).toBe(0);
  await ca.close(); await cb.close();
});

test('T13 sleep/wake: call survives a simulated wake', async ({ browser, page }) => {
  const p = await pair(browser, page);
  await bothInCall(p.a, p.b);
  await p.a.evaluate(() => window.__ah.debug.fakeSleep());
  await p.a.waitForTimeout(5000);
  expect(await stateOf(p.a)).toBe('call');
  await p.close();
});

test('C1 @cloud real PeerJS cloud', async ({ browser, page }) => {
  test.skip(!process.env.CLOUD, 'set CLOUD=1 to run against 0.peerjs.com');
  const key = await freshKey(page);
  const ca = await browser.newContext(), cb = await browser.newContext();
  const open = async (ctx, role) => {
    const pg = await ctx.newPage();
    await pg.goto(`/${process.env.RELAY ? "?relay=1" : ""}#k=${key}&r=${role}`);
    await pg.locator('#b-ready:visible, #b-share-done:visible').first().click();
    return pg;
  };
  const a = await open(ca, 'a'); const b = await open(cb, 'b');
  await bothInCall(a, b, 30000);
  await ca.close(); await cb.close();
});

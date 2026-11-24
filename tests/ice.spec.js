import { test, expect, freshKey, SIGNAL } from './helpers.js';

const b64u = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
// Placeholder values only.
const RELAY = [{ urls: ['turn:relay.example.test:3478', 'turns:relay.example.test:443'], username: 'user-placeholder', credential: 'secret-placeholder' }];
const ice = (page) => page.evaluate(() => localStorage.getItem('ah.v1.ice'));

test('S1.1 &ice= is saved, stripped from the address bar, never logged, and reaches the peer connection', async ({ browser, page }) => {
  const key = await freshKey(page);
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    window.__cfg = [];
    const Orig = window.RTCPeerConnection;
    window.RTCPeerConnection = function (cfg, ...r) { window.__cfg.push(JSON.stringify(cfg)); return new Orig(cfg, ...r); };
    window.RTCPeerConnection.prototype = Orig.prototype;
  });
  const p = await ctx.newPage();
  const logs = [];
  p.on('console', (m) => logs.push(m.text()));
  await p.goto(`/${SIGNAL}#k=${key}&r=a&ice=${b64u(RELAY)}`);
  await p.locator('#b-ready:visible, #b-share-done:visible').first().click();
  expect(JSON.parse(await ice(p))).toEqual(RELAY);
  expect(p.url()).not.toContain('ice=');
  expect(p.url()).not.toContain('#');
  // PeerJS probes with its own default config; a real connection uses ours. B dials A, so A gets a connection.
  const otherCtx = await browser.newContext();
  const other = await otherCtx.newPage();
  await other.goto(`/${SIGNAL}#k=${key}&r=b`);
  await other.locator('#b-ready:visible, #b-share-done:visible').first().click();
  await p.waitForFunction(() => window.__cfg.some((c) => c.includes('user-placeholder')), null, { timeout: 15000 });
  const cfg = JSON.parse(await p.evaluate(() => window.__cfg.find((c) => c.includes('user-placeholder'))));
  expect(cfg.iceServers).toEqual(expect.arrayContaining([expect.objectContaining({ username: 'user-placeholder' })]));
  expect(logs.join('\n')).not.toContain('secret-placeholder');
  expect(logs.join('\n')).not.toContain('relay.example.test');
  await otherCtx.close(); await ctx.close();
});

test('S1.1 invalid ice values are ignored', async ({ browser, page }) => {
  const key = await freshKey(page);
  const bad = [
    b64u([{ urls: 'http://evil.example.test' }]),
    b64u([{ urls: 'turn:a.example.test' }, { urls: 'turn:b.example.test' }, { urls: 'turn:c.example.test' }, { urls: 'turn:d.example.test' }, { urls: 'turn:e.example.test' }]),
    b64u({ urls: 'turn:a.example.test' }),
    b64u([]),
    '!!!not-base64!!!',
  ];
  for (const v of bad) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(`/${SIGNAL}#k=${key}&r=a&ice=${v}`);
    expect(await ice(p)).toBeNull();
    await ctx.close();
  }
});

test('S1.1 Settings relay field: saved, rejected when invalid, cleared when empty, carried in the invite link', async ({ browser, page }) => {
  const key = await freshKey(page);
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  await p.goto(`/${SIGNAL}#k=${key}&r=a`);
  await p.locator('#b-ready:visible, #b-share-done:visible').first().click();
  await p.click('#b-settings-w');
  await p.fill('#i-relay', 'not json');
  await p.click('#b-relay');
  await expect(p.locator('#t-relay')).toContainText("doesn't look");
  expect(await ice(p)).toBeNull();
  await p.fill('#i-relay', JSON.stringify(RELAY));
  await p.click('#b-relay');
  await expect(p.locator('#t-relay')).toContainText('saved');
  expect(JSON.parse(await ice(p))).toEqual(RELAY);
  await p.click('#b-copy-b');
  const link = await p.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain('&ice=');
  expect(JSON.parse(Buffer.from(link.split('&ice=')[1].split('&')[0], 'base64url').toString())).toEqual(RELAY);
  await p.fill('#i-relay', '');
  await p.click('#b-relay');
  expect(await ice(p)).toBeNull();
  await ctx.close();
});

test('S1.2 default ICE servers are Google STUN only (no dead PeerJS TURN hosts)', async ({ page }) => {
  await page.goto('/tests/blank.html');
  const d = await page.evaluate(async () => (await import('/signal.js')).DEFAULT_ICE);
  expect(d).toEqual([{ urls: 'stun:stun.l.google.com:19302' }]);
  expect(JSON.stringify(d)).not.toContain('peerjs.com');
});

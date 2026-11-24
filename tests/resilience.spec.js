import { test, expect, freshKey, openAs, waitState, SIGNAL } from './helpers.js';

const bothInCall = async (a, b, ms = 15000) => {
  await Promise.all([waitState(a, 'call', ms), waitState(b, 'call', ms)]);
};

test('B1 room id held elsewhere for ~5 s then released: A recovers, one Peer only, B can join', async ({ browser, page }) => {
  const key = await freshKey(page);
  const hogCtx = await browser.newContext();
  const hog = await hogCtx.newPage();
  await hog.goto('/tests/blank.html');
  await hog.addScriptTag({ url: '/peerjs.min.js' });
  await hog.evaluate(async (k) => {
    const { peerIds } = await import('/keys.js');
    const ids = await peerIds(k);
    await new Promise((res, rej) => {
      window.__hog = new window.Peer(ids.a, { host: 'localhost', port: 9000, secure: false, path: '/', key: 'peerjs' });
      window.__hog.on('open', res); window.__hog.on('error', rej);
    });
  }, key);

  const ca = await browser.newContext();
  const a = await openAs(ca, key, 'a');
  await a.waitForTimeout(5000);
  expect(await a.evaluate(() => window.__ahPeers())).toBeLessThanOrEqual(1);
  await hog.evaluate(() => window.__hog.destroy());
  await waitState(a, 'waiting', 15000);
  await a.waitForTimeout(6000); // let any stray timer fire
  expect(await a.evaluate(() => window.__ahPeers())).toBe(1);
  expect(await a.evaluate(() => window.__ah.state())).toBe('waiting');

  const cb = await browser.newContext();
  const b = await openAs(cb, key, 'b');
  await bothInCall(a, b, 15000);
  expect(await a.evaluate(() => window.__ahPeers())).toBe(1);
  await hogCtx.close(); await ca.close(); await cb.close();
});

test('M1 slow link: B\'s connection attempt is not abandoned every 3 s', async ({ browser, page }) => {
  const key = await freshKey(page);
  const ca = await browser.newContext(), cb = await browser.newContext();
  // B's data channel needs ~6 s to come up (answer applied late), like a slow mobile/TURN path.
  await cb.addInitScript(() => {
    const orig = RTCPeerConnection.prototype.setRemoteDescription;
    RTCPeerConnection.prototype.setRemoteDescription = function (d) {
      if (d && d.type === 'answer') return new Promise((res) => setTimeout(res, 6000)).then(() => orig.call(this, d));
      return orig.call(this, d);
    };
  });
  const a = await openAs(ca, key, 'a');
  const b = await openAs(cb, key, 'b');
  await bothInCall(a, b, 25000);
  await ca.close(); await cb.close();
});

test('M3 stale handshake continuation cannot touch a newer link; duplicate hello/proof ignored', async ({ browser, page }) => {
  const key = await freshKey(page);
  const ca = await browser.newContext(), cb = await browser.newContext();
  const a = await openAs(ca, key, 'a');
  await waitState(a, 'waiting', 10000);
  await a.evaluate(() => { window.__ah.debug.signDelay = 1500; });
  const b = await openAs(cb, key, 'b');
  // A has B's hello and is inside sign(). A new link opens meanwhile.
  await a.waitForFunction(() => window.__ah.lastMessage() === 'hello' || window.__ah.debug.handshake().gotHello, null, { timeout: 15000 });
  await a.evaluate(() => { window.__ah.debug.signDelay = 0; window.__ah.debug.relink(); });
  expect(await a.evaluate(() => window.__ah.debug.handshake().gotHello)).toBe(false);
  await a.waitForTimeout(2500); // the stale sign() has now finished
  const h = await a.evaluate(() => window.__ah.debug.handshake());
  expect(h.sentProof).toBe(false);
  expect(h.authed).toBe(false);
  // A second hello on the same link is dropped.
  await a.evaluate(() => window.__ah.debug.inject({ t: 'hello', n: 'abc' }));
  await a.evaluate(() => window.__ah.debug.inject({ t: 'hello', n: 'def' }));
  await a.waitForTimeout(300);
  expect((await a.evaluate(() => window.__ah.debug.handshake())).gotHello).toBe(true);
  await ca.close(); await cb.close();
});

test('M2a B getUserMedia never resolves: both sides return to waiting, no local tracks', async ({ browser, page }) => {
  const key = await freshKey(page);
  const ca = await browser.newContext(), cb = await browser.newContext();
  await ca.addInitScript(() => { window.__AH_MEDIA_MS = 4000; });
  await cb.addInitScript(() => {
    window.__AH_MEDIA_MS = 4000;
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    // The first-run probe (plain audio/video:true) works; the call's request hangs, like an unanswered iOS prompt.
    navigator.mediaDevices.getUserMedia = (c) => (c && c.video && c.video.width ? new Promise(() => {}) : real(c));
  });
  const a = await openAs(ca, key, 'a');
  const b = await openAs(cb, key, 'b');
  await waitState(a, 'linking', 15000);
  await waitState(a, 'waiting', 12000);
  expect(await a.evaluate(() => window.__ah.localTracks())).toBe(0);
  await waitState(b, 'waiting', 12000);
  expect(await b.evaluate(() => window.__ah.localTracks())).toBe(0);
  expect(await a.evaluate(() => window.__ah.state())).not.toBe('call');
  await ca.close(); await cb.close();
});

test('M2b A has no camera or mic: B still gets A\'s side as receive-only, banner shows, call works', async ({ browser, page }) => {
  const key = await freshKey(page);
  const ca = await browser.newContext(), cb = await browser.newContext();
  await ca.addInitScript(() => {
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    // First-run probe passes; the call's requests are refused.
    navigator.mediaDevices.getUserMedia = (c) => (c && ((c.video && c.video.width) || (c.audio && !c.video && c.audio.echoCancellation))
      ? Promise.reject(new DOMException('blocked', 'NotAllowedError')) : real(c));
  });
  const a = await openAs(ca, key, 'a');
  const b = await openAs(cb, key, 'b');
  await Promise.all([waitState(a, 'call', 20000), waitState(b, 'call', 20000)]);
  await b.waitForFunction(() => window.__ah.remoteLive(), null, { timeout: 10000 }).catch(() => {});
  expect(await a.evaluate(() => window.__ah.localTracks())).toBe(0);
  await a.waitForFunction(() => window.__ah.remoteLive(), null, { timeout: 10000 });
  await expect(a.locator('#banner-media')).toBeVisible();
  await ca.close(); await cb.close();
});

test('M2c blocked-media note is visible on the waiting screen', async ({ browser, page }) => {
  const key = await freshKey(page);
  const ca = await browser.newContext(), cb = await browser.newContext();
  await ca.addInitScript(() => {
    window.__AH_MEDIA_MS = 3000;
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => (c && ((c.video && c.video.width) || (c.audio && !c.video && c.audio.echoCancellation))
      ? Promise.reject(new DOMException('blocked', 'NotAllowedError')) : real(c));
  });
  await cb.addInitScript(() => {
    window.__AH_MEDIA_MS = 3000;
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => (c && c.video && c.video.width ? new Promise(() => {}) : real(c));
  });
  const a = await openAs(ca, key, 'a');
  await waitState(a, 'waiting', 10000);
  const b = await openAs(cb, key, 'b');
  await waitState(a, 'linking', 15000);
  await expect(a.locator('#wait-media')).toBeVisible();
  await ca.close(); await cb.close();
});

test('R2 minors: bidi stripped, bad link shown with a stored key, input border contrast', async ({ browser, page }) => {
  const key = await freshKey(page);
  const ctx = await browser.newContext();
  const a = await openAs(ctx, key, 'a');
  await waitState(a, 'waiting', 10000);
  // names with bidi overrides
  const p2 = await ctx.newPage();
  await p2.goto(`/?signal=localhost:9000#k=${key}&r=a&nb=${encodeURIComponent('\u202Eevil\u2066x')}`);
  await expect(p2.locator('#h-wait')).toHaveText('Waiting for evilx…');
  // mangled link while a key is stored: the error is visible on the waiting screen
  const p3 = await ctx.newPage();
  await p3.goto(`/?signal=localhost:9000#k=${key.slice(0, 5)}${key[5] === 'A' ? 'B' : 'A'}${key.slice(6)}&r=b`);
  await expect(p3.locator('#wait-linkerr')).toBeVisible();
  await expect(p3.locator('#wait-linkerr')).toContainText('incomplete');
  // input border contrast >= 3:1 against the page background
  const ratio = await p3.evaluate(() => {
    const lum = (c) => { const [r, g, b] = c.match(/\d+/g).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const inp = document.getElementById('i-name-a');
    const l1 = lum(getComputedStyle(inp).borderTopColor), l2 = lum(getComputedStyle(document.body).backgroundColor);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(3);
  await ctx.close();
});

test('R2 flip: old camera is released first and a failing new camera falls back', async ({ browser, page }) => {
  const key = await freshKey(page);
  const ca = await browser.newContext(), cb = await browser.newContext();
  await cb.addInitScript(() => {
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.__gum = [];
    navigator.mediaDevices.getUserMedia = (c) => {
      if (c && c.video && c.video.facingMode && !c.audio) {
        const live = window.__live ? window.__live() : -1;
        window.__gum.push({ f: c.video.facingMode.ideal, live });
        if (c.video.facingMode.ideal === 'environment') return Promise.reject(new DOMException('busy', 'NotReadableError'));
      }
      return real(c);
    };
  });
  const a = await openAs(ca, key, 'a');
  const b = await openAs(cb, key, 'b');
  await Promise.all([waitState(a, 'call', 15000), waitState(b, 'call', 15000)]);
  await b.evaluate(() => { window.__live = () => window.__ah.localTracks(); });
  await b.evaluate(() => { document.getElementById('b-flip').hidden = false; });
  await b.mouse.move(100, 150);
  await b.click('#b-flip');
  await b.waitForFunction(() => window.__gum.length >= 2, null, { timeout: 8000 });
  const calls = await b.evaluate(() => window.__gum);
  expect(calls[0].f).toBe('environment');
  expect(calls[0].live).toBe(1); // only the audio track is still live: the old camera was stopped first
  expect(calls[1].f).toBe('user'); // fell back
  await b.waitForFunction(() => window.__ah.localTracks() === 2, null, { timeout: 5000 });
  await ca.close(); await cb.close();
});

test('S1.3 relay-only with no relay: after 2 failures the note shows, B backs off, cameras stay off, success resets', async ({ browser, page }) => {
  test.setTimeout(120000);
  const key = await freshKey(page);
  const ca = await browser.newContext(), cb = await browser.newContext();
  for (const c of [ca, cb]) await c.addInitScript(() => { window.__AH_DIAL_MS = 3000; window.__AH_MEDIA_MS = 3000; });
  // ?relay=1 forces relayed candidates only; the default ICE list has no TURN now, so nothing can connect.
  const a = await openAs(ca, key, 'a', { extra: '&relay=1' });
  const b = await openAs(cb, key, 'b', { extra: '&relay=1' });
  await expect(b.locator('#wait-netfail')).toBeHidden();
  await b.waitForFunction(() => window.__ah.debug.netFail().streak >= 2, null, { timeout: 60000 });
  await expect(b.locator('#wait-netfail')).toBeVisible();
  await expect(b.locator('#wait-netfail')).toHaveText("Couldn't connect on this network. Try Wi-Fi, or add a relay in Settings.");
  expect((await b.evaluate(() => window.__ah.debug.netFail())).gap).toBe(30000);
  for (const pg of [a, b]) {
    expect(await pg.evaluate(() => window.__ah.localTracks())).toBe(0);
    expect(await pg.evaluate(() => window.__ah.state())).not.toBe('call');
  }
  await ca.close(); await cb.close();
});

test('S1.3 a successful call resets the failure count and the dial gap', async ({ browser, page }) => {
  const key = await freshKey(page);
  const ca = await browser.newContext(), cb = await browser.newContext();
  const a = await openAs(ca, key, 'a');
  const b = await openAs(cb, key, 'b');
  await bothInCall(a, b, 20000);
  for (const pg of [a, b]) expect(await pg.evaluate(() => window.__ah.debug.netFail())).toEqual({ streak: 0, gap: 0, shown: false });
  await ca.close(); await cb.close();
});

test('S1.3 partial path (link opens, media never starts): media timeouts count, note shows, tracks stop each round', async ({ browser, page }) => {
  test.setTimeout(90000);
  const key = await freshKey(page);
  const ca = await browser.newContext(), cb = await browser.newContext();
  await ca.addInitScript(() => { window.__AH_MEDIA_MS = 2500; });
  await cb.addInitScript(() => {
    window.__AH_MEDIA_MS = 2500;
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => (c && c.video && c.video.width ? new Promise(() => {}) : real(c));
  });
  const a = await openAs(ca, key, 'a');
  const b = await openAs(cb, key, 'b');
  await a.waitForFunction(() => window.__ah.debug.netFail().streak >= 2, null, { timeout: 60000 });
  await expect(a.locator('#wait-netfail')).toBeVisible();
  await waitState(a, 'waiting', 10000);
  expect(await a.evaluate(() => window.__ah.localTracks())).toBe(0);
  await ca.close(); await cb.close();
});

test('Nit 3 the bad-link message is cleared once a valid link is adopted', async ({ browser, page }) => {
  const key = await freshKey(page);
  const ctx = await browser.newContext();
  const a = await openAs(ctx, key, 'a');
  await waitState(a, 'waiting', 10000);
  await a.evaluate(() => { const e = document.getElementById('wait-linkerr'); e.textContent = 'x'; e.hidden = false; });
  await a.evaluate(async (k) => { await window.__ah.debug.adopt('#k=' + k + '&r=a'); }, key);
  await expect(a.locator('#wait-linkerr')).toBeHidden();
  await ctx.close();
});

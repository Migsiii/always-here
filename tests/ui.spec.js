import { test, expect, freshKey, openAs, waitState, SIGNAL } from './helpers.js';

async function audit(page, label) {
  const o = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, iw: window.innerWidth,
    small: [...document.querySelectorAll('button, a[href], input')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden]'); })
      .map((e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.className, w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter((x) => x.w < 44 || x.h < 44),
    unlabeled: [...document.querySelectorAll('button')]
      .filter((b) => !b.closest('[hidden]') && !b.textContent.trim() && !b.getAttribute('aria-label')).map((b) => b.id),
  }));
  expect(o.sw, `${label} horizontal scroll`).toBeLessThanOrEqual(o.iw);
  expect(o.small, `${label} small targets`).toEqual([]);
  expect(o.unlabeled, `${label} icon buttons without label`).toEqual([]);
}

for (const vp of [{ width: 375, height: 812 }, { width: 768, height: 1024 }]) {
  test(`V1 ${vp.width}px: no h-scroll, 44px targets, labels`, async ({ browser, page }) => {
    const key = await freshKey(page);
    const ctx = await browser.newContext({ viewport: vp });
    const ctx2 = await browser.newContext({ viewport: vp });
    const w = await ctx.newPage();
    await w.goto(`/${SIGNAL}`);
    await audit(w, 'welcome');
    const a = await openAs(ctx, key, 'a');
    await waitState(a, 'waiting', 10000);
    await audit(a, 'waiting');
    const b = await openAs(ctx2, key, 'b');
    await waitState(a, 'call', 10000);
    await a.mouse.move(100, 100);
    await audit(a, 'call');
    await ctx.close(); await ctx2.close();
  });
}

test('V2 reduced motion removes the waiting pulse', async ({ browser, page }) => {
  const key = await freshKey(page);
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const a = await openAs(ctx, key, 'a');
  await waitState(a, 'waiting', 10000);
  expect(await a.evaluate(() => getComputedStyle(document.querySelector('.pulse')).animationName)).toBe('none');
  await ctx.close();
});

test('M1 manifest and icons', async ({ request }) => {
  const r = await request.get('/manifest.webmanifest');
  expect(r.ok()).toBe(true);
  const m = await r.json();
  expect(m.start_url).toBe('./');
  expect(m.scope).toBe('./');
  expect(m.display).toBe('standalone');
  for (const size of ['192x192', '512x512']) {
    const i = m.icons.find((x) => x.sizes === size && x.type === 'image/png');
    expect(i, size).toBeTruthy();
    expect((await request.get('/' + i.src)).ok()).toBe(true);
  }
  expect(m.icons.some((x) => x.purpose === 'maskable')).toBe(true);
  expect((await request.get('/icon-180.png')).ok()).toBe(true);
});

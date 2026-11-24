import { test, expect } from '@playwright/test';

// Run keys.js inside a page (WebCrypto needs a secure context: localhost counts).
async function inPage(page, fn, arg) {
  await page.goto('/tests/blank.html');
  return page.evaluate(async ([src, a]) => {
    const k = await import('/keys.js');
    return new Function('k', 'a', `return (async()=>{${src}})()`)(k, a);
  }, [fn, arg]);
}

test('K1 keys: generate, parse, reject, room ids', async ({ page }) => {
  const r = await inPage(page, `
    const key = await k.newKey();
    const other = await k.newKey();
    const flip = (s, i) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);
    const out = {};
    out.len = key.length;
    out.raw = (await k.parseKey(key)).ok;
    out.url = (await k.parseKey('https://x.github.io/always-here/#k=' + key + '&r=b')).ok;
    out.frag = (await k.parseKey('  #k=' + key + ' ')).ok;
    out.mangled = (await k.parseKey(flip(key, 3))).reason;
    out.badCheck = (await k.parseKey(flip(key, 24))).reason;
    out.trunc = (await k.parseKey(key.slice(0, 20))).reason;
    out.empty = (await k.parseKey('')).reason;
    const ids = await k.peerIds(key), ids2 = await k.peerIds(key), ids3 = await k.peerIds(other);
    out.stable = ids.a === ids2.a && ids.b === ids2.b;
    out.differs = ids.a !== ids3.a;
    out.idShape = /^ah-[0-9a-f]{32}-a$/.test(ids.a) && /^ah-[0-9a-f]{32}-b$/.test(ids.b);
    const ak = await k.authKey(key), ak2 = await k.authKey(other);
    const mac = await k.sign(ak, 'nonce:a');
    out.verifyOk = await k.verify(ak, 'nonce:a', mac);
    out.verifyBadMsg = await k.verify(ak, 'nonce:b', mac);
    out.verifyBadKey = await k.verify(ak2, 'nonce:a', mac);
    out.verifyGarbage = await k.verify(ak, 'nonce:a', '!!!');
    out.nonce = k.randNonce() !== k.randNonce();
    return out;
  `);
  expect(r.len).toBe(26);
  expect([r.raw, r.url, r.frag]).toEqual([true, true, true]);
  expect(r.mangled).toBe('checksum');
  expect(r.badCheck).toBe('checksum');
  expect(r.trunc).toBe('format');
  expect(r.empty).toBe('format');
  expect([r.stable, r.differs, r.idShape]).toEqual([true, true, true]);
  expect([r.verifyOk, r.verifyBadMsg, r.verifyBadKey, r.verifyGarbage]).toEqual([true, false, false, false]);
  expect(r.nonce).toBe(true);
});

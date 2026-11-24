// Room key helpers. Pure functions, no DOM, no network.
// There is one room, for the two of us. Its key is this constant, so opening the site just works.
// The repo is public, so anyone who reads this could join. That is accepted: the room is personal and
// the call is only ever between two people. The challenge/response handshake still runs.
export const ROOM_KEY = '-j-jYcCdKahpiGy6ragHgQRxtN';

const enc = new TextEncoder();
const subtle = crypto.subtle;

export function b64u(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64u(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sha256(text) {
  return new Uint8Array(await subtle.digest('SHA-256', enc.encode(text)));
}

const KEY_RE = /^[A-Za-z0-9_-]{26}$/;

async function checksum(body) {
  return b64u((await sha256('always-here:v1:ck:' + body)).slice(0, 3));
}

/** New random 128-bit key: 22 chars body + 4 chars checksum. */
export async function newKey() {
  const body = b64u(crypto.getRandomValues(new Uint8Array(16)));
  return body + (await checksum(body));
}

/** Accepts a full URL, a "#k=..." fragment, or the raw 26 chars. */
export async function parseKey(input) {
  let s = String(input ?? '').trim();
  const m = s.match(/[#&?]k=([^&\s]*)/);
  if (m) s = m[1];
  s = s.trim();
  if (!KEY_RE.test(s)) return { ok: false, reason: 'format' };
  if ((await checksum(s.slice(0, 22))) !== s.slice(22)) return { ok: false, reason: 'checksum' };
  return { ok: true, key: s };
}

export async function roomId(key) {
  return hex((await sha256('always-here:v1:room:' + key)).slice(0, 16));
}

/** PeerJS ids: a = the always-on side, b = the one who dials in. */
export async function peerIds(key) {
  const r = await roomId(key);
  return { a: `ah-${r}-a`, b: `ah-${r}-b` };
}

export async function authKey(key) {
  const raw = await sha256('always-here:v1:auth:' + key);
  return subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function sign(k, str) {
  return b64u(new Uint8Array(await subtle.sign('HMAC', k, enc.encode(str))));
}

export async function verify(k, str, mac) {
  try {
    return await subtle.verify('HMAC', k, unb64u(String(mac)), enc.encode(str));
  } catch {
    return false;
  }
}

export function randNonce() {
  return b64u(crypto.getRandomValues(new Uint8Array(16)));
}

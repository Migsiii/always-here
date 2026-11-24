import { ROOM_KEY, parseKey, peerIds, authKey, sign, verify, randNonce } from './keys.js';
import { createSignal, serverOptions } from './signal.js';
import * as media from './media.js';

// Nicknames only (never full names). a = the always-on side, b = the one who dials in.
export const PEOPLE = { a: 'Bubiii', b: 'baba 🐼' };
// Relay servers baked into the page for later. Empty on purpose: a TURN login must not be in this public repo.
// A relay can still be set per device in Settings or with &ice= in the address.
const ICE_SERVERS = [];
const graphemes = (t) => (typeof Intl !== 'undefined' && Intl.Segmenter
  ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t), (x) => x.segment)
  : Array.from(t));
// ---- relay (ICE servers) ----
// A TURN login must never be in this public repo, so it arrives in the address (&ice=) or is pasted
// into Settings, and lives only in this browser's localStorage. It is never logged.
const ICE_MAX = 4;
function cleanIce(v) {
  if (!Array.isArray(v) || !v.length || v.length > ICE_MAX) return null;
  const out = [];
  for (const e of v) {
    if (!e || typeof e !== 'object') return null;
    const urls = Array.isArray(e.urls) ? e.urls : [e.urls];
    if (!urls.length || urls.length > 4 || !urls.every((u) => typeof u === 'string' && u.length <= 200 && /^(turns?|stun):\S+$/i.test(u))) return null;
    const o = { urls: urls.length === 1 ? urls[0] : urls };
    for (const f of ['username', 'credential']) if (typeof e[f] === 'string' && e[f].length <= 512) o[f] = e[f];
    out.push(o);
  }
  return out;
}
const b64uDecode = (t) => {
  const b = atob(t.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(b, (c) => c.charCodeAt(0)));
};
/** Accepts a JSON array or its base64url form. Returns a cleaned array, or null when invalid. */
function parseIce(text) {
  const s = String(text == null ? '' : text).trim();
  if (!s || s.length > 4000) return null;
  try { return cleanIce(JSON.parse(s[0] === '[' ? s : b64uDecode(s))); } catch { return null; }
}
function iceFromLink(input) {
  const m = String(input).match(/[#&?]ice=([^&#\s]*)/);
  if (!m) return null;
  let v = '';
  try { v = decodeURIComponent(m[1]); } catch { return null; }
  return parseIce(v);
}
const initialOf = (t) => (graphemes(String(t || '').trim())[0] || '?').toUpperCase();
const $ = (id) => document.getElementById(id);
const LS = 'ah.v1.';
const store = {
  get: (k) => { try { return localStorage.getItem(LS + k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(LS + k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(LS + k); } catch {} },
  clear: () => { try { Object.keys(localStorage).filter((k) => k.startsWith(LS)).forEach((k) => localStorage.removeItem(k)); } catch {} },
};
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);

let key = null;
let role = null; // 'a' = always-on side, 'b' = the one who dials in
let state = 'setup';
let lastMessage = null;

const nameOf = (r) => PEOPLE[r];
const other = () => (role === 'a' ? 'b' : 'a');
const otherName = () => nameOf(other());

// ---------- screens ----------
const SCREENS = ['s-who', 's-ready', 's-wait', 's-call', 's-else'];
function show(id) {
  for (const s of SCREENS) $(s).hidden = s !== id;
  const h = $(id).querySelector('h1');
  if (h && id !== 's-call') { h.setAttribute('tabindex', '-1'); try { h.focus({ preventScroll: true }); } catch {} }
}
function say(text) { const l = $('live'); l.textContent = ''; setTimeout(() => { l.textContent = text; }, 50); }
const storedIce = () => { try { return cleanIce(JSON.parse(store.get('ice') || '[]')) || []; } catch { return []; } };
const iceList = () => [...(cleanIce(ICE_SERVERS) || []), ...storedIce()];

// ---------- routing ----------
function route() {
  if (!role) { renderWho(); show('s-who'); state = 'setup'; preselectWho(); return; }
  if (!store.get('ready')) { show('s-ready'); state = 'setup'; return; }
  startRoom();
}

function renderWho() {
  $('b-who-a').textContent = `I'm ${nameOf('a')}`;
  $('b-who-b').textContent = `I'm ${nameOf('b')}`;
}

// Bonus: if one side is already online, this device must be the other one. Preselect the free slot.
// The probe is an anonymous Peer (it never claims a real id) that tries to connect to a slot. An empty slot makes
// the server answer "peer-unavailable" after its ~5 s expiry. Silence for 6.5 s means someone is there (they close
// a stranger's connection without a word, so nothing is disturbed). Only a suggestion: both buttons always work.
function probeOnline(id) {
  return new Promise((resolve) => {
    let p = null, done = false;
    const end = (v) => { if (done) return; done = true; clearTimeout(t); clearTimeout(t2); try { p && p.destroy(); } catch {} resolve(v); };
    const t = setTimeout(() => end(null), 9000);
    let t2 = null;
    try {
      p = new window.Peer({ ...serverOptions(), debug: 0 });
      p.on('error', (e) => end(e && e.type === 'peer-unavailable' ? false : null));
      p.on('open', () => {
        const c = p.connect(id, { reliable: true });
        c.on('open', () => end(true));
        t2 = setTimeout(() => end(true), 6500);
      });
    } catch { end(null); }
  });
}
async function preselectWho() {
  let ids;
  try { ids = await peerIds(key); } catch { return; }
  const [aOn, bOn] = await Promise.all([probeOnline(ids.a), probeOnline(ids.b)]);
  if (role || state !== 'setup' || $('s-who').hidden) return;
  const pick = aOn === true && bOn !== true ? 'b' : bOn === true && aOn !== true ? 'a' : null;
  if (!pick) return;
  $('s-who').dataset.suggest = pick;
  $('b-who-' + pick).className = 'btn primary';
  $('b-who-' + (pick === 'a' ? 'b' : 'a')).className = 'btn secondary';
  $('b-who-' + pick).focus();
  $('who-hint').textContent = `${nameOf(pick === 'a' ? 'b' : 'a')} is already here, so this is probably ${nameOf(pick)}.`;
  $('who-hint').hidden = false;
}

function wireSetup() {
  // Picking who you are is the one first-run tap. It is also the gesture that unlocks sound and permissions.
  for (const b of [$('b-who-a'), $('b-who-b')]) {
    b.addEventListener('click', () => { role = b.dataset.role; store.set('role', role); finishFirstRun(); });
  }
  $('b-ready').addEventListener('click', () => finishFirstRun());
}

let firstRunFails = 0;
async function finishFirstRun() {
  const err = $('e-ready');
  err.hidden = true;
  media.unlockAudio();
  try {
    await media.probePermission();
  } catch {
    if (firstRunFails++ === 0) {
      route(); // lands on the ready screen so the message shows
      show('s-ready');
      err.textContent = 'Camera or microphone is blocked. Allow them in your browser, then tap again. Or tap again to continue anyway.';
      err.hidden = false;
      $('b-ready').textContent = 'Try again';
      return;
    }
  }
  if (role === 'a' && 'Notification' in window && Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch {}
  }
  store.set('ready', '1');
  startRoom();
}

// ---------- settings ----------
let sheetOpener = null;
function openSheet(opener) {
  sheetOpener = opener;
  $('t-sheet').textContent = '';
  $('t-relay').textContent = storedIce().length ? 'A relay is set on this device.' : '';
  $('sheet').hidden = false;
  $('i-relay').focus();
}
function closeSheet() {
  $('sheet').hidden = true;
  if (sheetOpener) sheetOpener.focus();
}
function wireSettings() {
  $('b-settings-w').addEventListener('click', (e) => openSheet(e.currentTarget));
  $('b-settings-c').addEventListener('click', (e) => openSheet(e.currentTarget));
  $('b-sheet-close').addEventListener('click', closeSheet);
  $('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) closeSheet(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('sheet').hidden) closeSheet();
    if (e.key === 'Tab' && !$('sheet').hidden) {
      const f = [...$('sheet').querySelectorAll('button, input')].filter((x) => !x.hidden && !x.disabled);
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  $('b-relay').addEventListener('click', () => {
    const v = $('i-relay').value.trim();
    if (!v) { store.del('ice'); $('t-relay').textContent = 'Relay removed.'; }
    else {
      const ice = parseIce(v);
      if (!ice) { $('t-relay').textContent = "That doesn't look like relay settings."; return; }
      store.set('ice', JSON.stringify(ice));
      $('t-relay').textContent = 'Relay saved.';
    }
    $('i-relay').value = '';
    resetNetFail();
    if (state === 'waiting') startRoom(); // nobody is connected: use it now. Otherwise it applies from the next connection.
  });
  // Switch person: forget which of the two this device is. The room itself is fixed.
  $('b-forget').addEventListener('click', () => {
    store.del('role'); store.del('ready');
    try { signal && signal.stop(); } catch {}
    location.replace(location.pathname);
  });
}

function renderNames() {
  $('wait-initial').textContent = initialOf(otherName());
  $('h-wait').textContent = `Waiting for ${otherName()}…`;
  $('remote-initial').textContent = initialOf(otherName());
  renderWho();
}

// ---------- only one tab per device ----------
let bc = null;
const tabId = Math.random().toString(36).slice(2);
let running = false;
function wireClaim() {
  try { bc = new BroadcastChannel('ah'); } catch { return; }
  bc.onmessage = (e) => {
    if (e.data && e.data.t === 'claim' && e.data.id !== tabId && running) {
      shutdown();
      $('t-else').textContent = 'Always Here is open in another tab. Only one can be your room at a time.';
      $('b-else').textContent = 'Use here';
      show('s-else');
      state = 'elsewhere';
    }
  };
  $('b-else').addEventListener('click', () => { startRoom(); });
}

// ---------- presence + call ----------
const HB_MS = 5000;
const HB_DEAD_MS = 10000; // two missed heartbeats; a silent peer is noticed within ~12 s (10 s + watchdog tick)
const HANDSHAKE_MS = 5000;
const MEDIA_MS = 15000; // from "authed" to the first remote stream; after that the link is dropped and tracks stop
const mediaMs = () => (isLocal && window.__AH_MEDIA_MS) || MEDIA_MS;

// Failures in a row (media timeout, media ICE failure, data link that never opened). After NETFAIL_AT the
// waiting screen says so and B dials only every NETFAIL_GAP_MS. A successful call resets both.
const NETFAIL_AT = 2;
const NETFAIL_GAP_MS = 30000;
let failStreak = 0;
let dialGapMs = 0;
function renderNetFail() {
  const on = failStreak >= NETFAIL_AT;
  $('wait-netfail').hidden = !on;
  dialGapMs = on ? NETFAIL_GAP_MS : 0;
  if (signal) signal.setDialGap(dialGapMs);
}
function noteFail() { failStreak++; renderNetFail(); }
function resetNetFail() { failStreak = 0; renderNetFail(); }
let signal = null;
let ids = null;
let authK = null;
let nonceMine = null;
let sentProof = false;
let theirProofOk = false;
let gotHello = false; // one hello and one proof per link
let gotProof = false;
let linkGen = 0; // bumped on every new link and teardown, so a slow sign()/verify() cannot touch a newer link
let authed = false;
let hbLast = 0;
let hbTimer = null;
let handshakeTimer = null;
let mediaTimer = null;
let mediaBlocked = false;
let localStream = null;
let remoteStream = null;
let pendingAnswer = null;
let gumDone = false;
let callStart = 0;
let timerInt = null;
let frozen = false;
let me = { mic: true, cam: true, away: false };
let them = { mic: true, cam: true, away: false };
let facing = 'user';

const setState = (s) => { state = s; };

function setStatus(text) { $('wait-status').textContent = text; }

async function startRoom() {
  shutdown();
  running = true;
  if (bc) bc.postMessage({ t: 'claim', id: tabId });
  renderNames();
  setState('starting');
  show('s-wait');
  renderWaiting();
  const myRole = role;
  ids = await peerIds(key);
  authK = await authKey(key);
  if (!running || role !== myRole) return;
  const sig = createSignal({ myId: ids[role], otherId: ids[other()], role, iceServers: iceList() });
  signal = sig;
  renderNetFail();
  sig.on('open', () => { if (state === 'starting') setState('waiting'); })
    .on('server-up', () => setStatus('Connected to server'))
    .on('id-busy', () => setStatus('Still closing an old session…'))
    .on('server-down', () => setStatus("Can't reach the server, retrying…"))
    .on('id-taken', () => {
      shutdown();
      $('t-else').textContent = 'This room is open on another device or tab. Close it there, then tap Try again.';
      $('b-else').textContent = 'Try again';
      show('s-else');
      setState('elsewhere');
    })
    .on('link-open', onLinkOpen)
    .on('dial-failed', () => { if (running) noteFail(); })
    .on('link-close', () => linkLost('link-close'))
    .on('data', onData)
    .on('incoming-call', (answer) => { pendingAnswer = answer; maybeAnswer(); })
    .on('remote-stream', onRemoteStream)
    .on('media-failed', () => linkLost('media-failed'))
    .on('media-connected', onMediaConnected)
    .on('media-close', () => { if (state === 'call' || state === 'linking') linkLost('media-close'); });
  sig.start();
}

function shutdown() {
  running = false;
  teardown();
  try { signal && signal.stop(); } catch {}
  signal = null;
}

function renderWaiting() {
  renderChips();
  const t = store.get('lastTogether');
  $('wait-last').textContent = t ? `Last together: ${relTime(new Date(t))}` : '';
}
function relTime(d) {
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
setInterval(() => { if (state === 'waiting' || state === 'starting') renderWaiting(); }, 30000);

function onLinkOpen() {
  if (!running) return;
  teardown();
  setState('linking');
  nonceMine = randNonce();
  sentProof = false; theirProofOk = false; authed = false; gotHello = false; gotProof = false;
  signal.send({ t: 'hello', n: nonceMine });
  clearTimeout(handshakeTimer);
  handshakeTimer = setTimeout(() => { if (!authed) linkLost('handshake'); }, HANDSHAKE_MS);
}

async function onData(msg) {
  if (!msg || typeof msg !== 'object') return;
  lastMessage = msg.t;
  if (msg.t === 'hello' && typeof msg.n === 'string' && msg.n.length <= 64) {
    if (gotHello || !nonceMine) return;
    gotHello = true;
    const gen = linkGen;
    if (isLocal && window.__ah.debug.signDelay) await new Promise((r) => setTimeout(r, window.__ah.debug.signDelay));
    const mac = (isLocal && window.__ah.debug.badAuth) ? 'AAAA' : await sign(authK, msg.n + ':' + role);
    if (gen !== linkGen) return;
    signal && signal.send({ t: 'proof', mac });
    sentProof = true;
    checkAuth();
    return;
  }
  if (msg.t === 'proof') {
    if (!nonceMine || typeof msg.mac !== 'string' || gotProof) return;
    gotProof = true;
    const gen = linkGen;
    const ok = await verify(authK, nonceMine + ':' + other(), msg.mac);
    if (gen !== linkGen) return;
    if (!ok) { linkLost('bad-proof'); return; }
    theirProofOk = true;
    checkAuth();
    return;
  }
  if (!authed) return;
  hbLast = Date.now();
  if (msg.t === 'bye') linkLost('bye');
  else if (msg.t === 'state') { them = { mic: !!msg.mic, cam: !!msg.cam, away: !!msg.away }; renderThem(); }
  else if (msg.t === 'heart') spawnHearts();
}

function checkAuth() {
  if (authed || !sentProof || !theirProofOk) return;
  authed = true;
  clearTimeout(handshakeTimer);
  hbLast = Date.now();
  clearTimeout(mediaTimer);
  mediaTimer = setTimeout(() => { if (state === 'linking') linkLost('media-timeout'); }, mediaMs());
  clearInterval(hbTimer);
  hbTimer = setInterval(() => { if (!frozen) signal && signal.send({ t: 'hb', ts: Date.now() }); }, HB_MS);
  me = { mic: true, cam: true, away: false };
  them = { mic: true, cam: true, away: false };
  sendState();
  startMedia();
}

function sendState() { signal && signal.send({ t: 'state', ...me }); }

async function startMedia() {
  gumDone = false;
  const mySignal = signal;
  const gen = linkGen;
  let s = null;
  try { s = await media.getStream(facing); } catch {
    try { s = new MediaStream([await media.getTrack('audio')]); } catch {}
  }
  if (!authed || signal !== mySignal || gen !== linkGen) { media.stopStream(s); return; }
  localStream = s;
  gumDone = true;
  setMediaBlocked(!s);
  $('v-self').srcObject = s;
  me.mic = !!(s && s.getAudioTracks().length);
  me.cam = !!(s && s.getVideoTracks().length);
  sendState();
  if (role === 'a') {
    try { signal.callOther(s || new MediaStream()); } catch { linkLost('call-failed'); }
  } else maybeAnswer();
}

// Visible on both the waiting screen (while linking) and the call screen.
function setMediaBlocked(on) {
  mediaBlocked = on;
  $('banner-media').hidden = !on;
  $('wait-media').hidden = !on;
}

function maybeAnswer() {
  if (!pendingAnswer || !authed || !gumDone) return;
  const a = pendingAnswer; pendingAnswer = null;
  a(localStream);
}

function onRemoteStream(s) {
  if (!authed) return;
  if (state === 'call' && remoteStream === s) return;
  remoteStream = s;
  $('v-remote').srcObject = s;
  enterCall();
  playRemote();
}

// The other side may have no camera or mic, so no remote stream ever arrives. Once the media path is
// up, give a stream a moment, then show the call anyway (their avatar, and they can hear/see us).
function onMediaConnected() {
  const gen = linkGen;
  setTimeout(() => { if (gen === linkGen && state === 'linking' && authed) enterCall(); }, 1500);
}

function playRemote() {
  const v = $('v-remote');
  v.muted = false;
  const p = v.play();
  if (p && p.catch) p.catch(() => { v.muted = true; v.play().catch(() => {}); $('b-tap').hidden = false; });
}

function enterCall() {
  if (state === 'call') return;
  resetNetFail();
  clearTimeout(mediaTimer);
  setState('call');
  show('s-call');
  callStart = Date.now();
  tickTimer();
  clearInterval(timerInt);
  timerInt = setInterval(tickTimer, 1000);
  renderThem();
  renderMe();
  say(`${otherName()} joined`);
  onCallEntered();
}

function tickTimer() {
  const s = Math.floor((Date.now() - callStart) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  $('timer').textContent = `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function renderThem() {
  $('badge-mic').hidden = them.mic;
  $('badge-cam').hidden = them.cam;
  $('remote-avatar').hidden = them.cam && !them.away;
  $('o-remote-away').hidden = !them.away;
  $('t-remote-away').textContent = `${otherName()} stepped away`;
}
function renderMe() {
  $('o-self-away').hidden = !me.away;
  $('self-tile').classList.toggle('off', !me.cam || me.away);
}

function teardown() {
  linkGen++;
  clearInterval(hbTimer); hbTimer = null;
  clearTimeout(handshakeTimer);
  clearTimeout(mediaTimer);
  clearInterval(timerInt); timerInt = null;
  media.stopStream(localStream);
  media.stopStream(remoteStream);
  localStream = null; remoteStream = null; pendingAnswer = null;
  authed = false; sentProof = false; theirProofOk = false; gumDone = false; nonceMine = null;
  for (const id of ['v-remote', 'v-self']) $(id).srcObject = null;
  for (const id of ['b-tap', 'banner-media', 'wait-media', 'o-remote-away', 'o-self-away', 'remote-avatar', 'badge-mic', 'badge-cam']) $(id).hidden = true;
  onCallLeft();
}

function linkLost(reason) {
  if (!running) return;
  const was = state;
  if (was !== 'linking' && was !== 'call') return;
  if (reason === 'media-timeout' || reason === 'media-failed') noteFail();
  teardown();
  if (signal) { try { signal.dropLink(); } catch {} }
  if (was === 'call') {
    store.set('lastTogether', new Date().toISOString());
    say(`${otherName()} left`);
  }
  setState('waiting');
  renderWaiting();
  show('s-wait');
  $('wait-media').hidden = !mediaBlocked; // keep the reason visible after a media timeout
}

// ---------- controls ----------
const SVGNS = 'http://www.w3.org/2000/svg';
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let idleTimer = null;

function setIcon(id, sym) { $(id).setAttribute('href', `./icons.svg#${sym}`); }

function renderControls() {
  $('b-mic').setAttribute('aria-pressed', String(!me.mic));
  $('b-cam').setAttribute('aria-pressed', String(!me.cam));
  setIcon('u-mic', me.mic ? 'mic' : 'mic-off');
  setIcon('u-cam', me.cam ? 'cam' : 'cam-off');
  $('b-away').setAttribute('aria-label', me.away ? 'Back from away' : 'Step away');
  renderMe();
}

function trackOf(kind) {
  return localStream && (kind === 'audio' ? localStream.getAudioTracks() : localStream.getVideoTracks())[0];
}

function toggle(kind) {
  if (me.away) return;
  const t = trackOf(kind);
  if (!t) return;
  t.enabled = !t.enabled;
  if (kind === 'audio') me.mic = t.enabled; else me.cam = t.enabled;
  renderControls();
  sendState();
}

async function stepAway() {
  if (me.away || !localStream) return;
  signal.replaceTrack('audio', null);
  signal.replaceTrack('video', null);
  media.stopStream(localStream);
  me.away = true;
  renderControls();
  sendState();
  $('b-back').focus();
}

async function comeBack() {
  if (!me.away) return;
  const mySignal = signal;
  let s = null;
  try { s = await media.getStream(facing); } catch { try { s = new MediaStream([await media.getTrack('audio')]); } catch {} }
  if (signal !== mySignal || state !== 'call') { media.stopStream(s); return; }
  if (!s) { setMediaBlocked(true); return; }
  localStream = s;
  $('v-self').srcObject = s;
  signal.replaceTrack('audio', s.getAudioTracks()[0] || null);
  signal.replaceTrack('video', s.getVideoTracks()[0] || null);
  me = { mic: s.getAudioTracks().length > 0, cam: s.getVideoTracks().length > 0, away: false };
  $('v-self').classList.toggle('env', facing === 'environment');
  renderControls();
  sendState();
  $('b-away').focus();
}

let flipping = false;
async function flipCamera() {
  if (me.away || !localStream || flipping) return;
  flipping = true;
  const mySignal = signal;
  const next = facing === 'user' ? 'environment' : 'user';
  // Release the current camera first: many phones cannot open a second one while the first is held.
  const old = trackOf('video');
  if (old) { localStream.removeTrack(old); old.stop(); }
  let t = null, got = next;
  try { t = await media.getTrack('video', next); } catch {
    try { t = await media.getTrack('video', facing); got = facing; } catch {}
  }
  flipping = false;
  if (signal !== mySignal || state !== 'call' || me.away || !localStream) { media.stopStream(t && new MediaStream([t])); return; }
  if (!t) { // nothing could be opened: show as camera off rather than a frozen frame
    signal.replaceTrack('video', null);
    me.cam = false; renderControls(); sendState();
    return;
  }
  t.enabled = me.cam;
  localStream.addTrack(t);
  signal.replaceTrack('video', t);
  facing = got;
  $('v-self').srcObject = localStream;
  $('v-self').classList.toggle('env', facing === 'environment');
}

function toggleFullscreen() {
  const st = $('stage');
  const inFs = document.fullscreenElement || document.webkitFullscreenElement;
  if (inFs) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else (st.requestFullscreen || st.webkitRequestFullscreen).call(st);
}

async function togglePip() {
  const v = $('v-remote');
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else if (document.pictureInPictureEnabled) await v.requestPictureInPicture();
    else if (v.webkitSupportsPresentationMode && v.webkitSupportsPresentationMode('picture-in-picture')) {
      v.webkitSetPresentationMode(v.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
    }
  } catch {}
}

function spawnHearts() {
  const box = $('hearts');
  const n = reducedMotion() ? 1 : 6;
  for (let i = 0; i < n; i++) {
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'heart');
    const use = document.createElementNS(SVGNS, 'use');
    use.setAttribute('href', './icons.svg#heart-fill');
    svg.appendChild(use);
    svg.style.left = `${reducedMotion() ? 50 : 15 + Math.random() * 70}%`;
    svg.style.animationDelay = `${i * 120}ms`;
    box.appendChild(svg);
    setTimeout(() => svg.remove(), 3200);
  }
}

function pokeBar() {
  const s = $('s-call');
  s.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if ($('bar').contains(document.activeElement)) return;
    s.classList.add('idle');
  }, 3000);
}

function wireControls() {
  $('b-mic').addEventListener('click', () => toggle('audio'));
  $('b-cam').addEventListener('click', () => toggle('video'));
  $('b-away').addEventListener('click', () => (me.away ? comeBack() : stepAway()));
  $('b-back').addEventListener('click', comeBack);
  $('b-flip').addEventListener('click', flipCamera);
  $('b-fs').addEventListener('click', toggleFullscreen);
  $('b-pip').addEventListener('click', togglePip);
  $('b-heart').addEventListener('click', () => { signal && signal.send({ t: 'heart' }); spawnHearts(); });
  $('b-media-retry').addEventListener('click', () => { signal && signal.dropLink(); linkLost('media-retry'); });
  for (const ev of ['pointerdown', 'pointermove', 'keydown']) $('s-call').addEventListener(ev, pokeBar);
  $('s-call').addEventListener('focusin', pokeBar);
}

async function onCallEntered() {
  $('b-fs').hidden = !(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  $('b-pip').hidden = !(document.pictureInPictureEnabled || ($('v-remote').webkitSupportsPresentationMode && $('v-remote').webkitSupportsPresentationMode('picture-in-picture')));
  $('b-flip').hidden = true;
  renderControls();
  pokeBar();
  const n = await media.cameraCount();
  if (state === 'call') $('b-flip').hidden = n < 2;
  onCallAlerts();
}

function onCallLeft() {
  clearTimeout(idleTimer);
  $('s-call').classList.remove('idle');
  me = { mic: true, cam: true, away: false };
  them = { mic: true, cam: true, away: false };
  facing = 'user';
  $('v-self').classList.remove('env');
  setIcon('u-mic', 'mic'); setIcon('u-cam', 'cam');
  $('b-mic').setAttribute('aria-pressed', 'false');
  $('b-cam').setAttribute('aria-pressed', 'false');
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch {}
  try { if (document.pictureInPictureElement) document.exitPictureInPicture(); } catch {}
  onCallAlertsOff();
}

// ---------- resilience ----------
let lastTick = Date.now();

let recovering = false;
let recoverAfter = 0;
async function recoverTracks() {
  if (recovering || Date.now() < recoverAfter) return;
  if (state !== 'call' || me.away || flipping || !localStream || !signal) return;
  const dead = localStream.getTracks().some((t) => t.readyState !== 'live');
  if (!dead) return;
  const mySignal = signal;
  recovering = true;
  try {
    const s = await media.getStream(facing);
    if (signal !== mySignal || state !== 'call') { media.stopStream(s); return; }
    media.stopStream(localStream);
    localStream = s;
    $('v-self').srcObject = s;
    signal.replaceTrack('audio', s.getAudioTracks()[0] || null);
    signal.replaceTrack('video', s.getVideoTracks()[0] || null);
    const a = s.getAudioTracks()[0], v = s.getVideoTracks()[0];
    if (a) a.enabled = me.mic;
    if (v) v.enabled = me.cam;
  } catch { recoverAfter = Date.now() + 10000; } // back off instead of retrying every 2 s
  finally { recovering = false; }
}

function healthCheck(woke) {
  if (!running || !signal) return;
  const ps = signal.peerState();
  if (!ps || ps.destroyed || ps.disconnected) signal.reconnect();
  if ((state === 'linking' || state === 'call') && authed && Date.now() - hbLast > HB_DEAD_MS) { linkLost('hb-timeout'); return; }
  if (woke || state === 'call') recoverTracks();
}

function wireResilience() {
  setInterval(() => {
    const now = Date.now();
    const woke = now - lastTick > 10000;
    lastTick = now;
    if (woke) hbLast = Math.max(hbLast, now - HB_DEAD_MS + 5000); // give the other side a moment to be heard after a sleep
    healthCheck(woke);
  }, 2000);
  window.addEventListener('online', () => signal && signal.reconnect());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (!running && role && store.get('ready') && state !== 'elsewhere' && state !== 'setup') startRoom();
    else healthCheck(true);
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && role && store.get('ready')) startRoom();
  });
  window.addEventListener('pagehide', () => {
    if (!running || !signal) return;
    if (!frozen) signal.send({ t: 'bye' });
    shutdown();
  });
}

// ---------- alerts ----------
const BASE_TITLE = 'Always Here';

function onCallAlerts() {
  media.chime();
  document.title = `${otherName()} is here · ${BASE_TITLE}`;
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const n = new Notification(`${otherName()} is here`, { tag: 'ah-here', icon: './icon-192.png' });
      n.onclick = () => { window.focus(); n.close(); };
    } catch {}
  }
  media.wakeLockOn();
}

function onCallAlertsOff() {
  document.title = BASE_TITLE;
  media.wakeLockOff();
}

function renderChips() {
  $('chip-sound').hidden = media.audioState() === 'running' || media.audioState() === 'unsupported';
  $('chip-alerts').hidden = !(role === 'a' && 'Notification' in window && Notification.permission === 'default');
}

function wireAlerts() {
  $('chip-sound').addEventListener('click', async () => { await media.unlockAudio(); renderChips(); });
  $('chip-alerts').addEventListener('click', async () => {
    try { await Notification.requestPermission(); } catch {}
    renderChips();
  });
  $('b-tap').addEventListener('click', () => {
    const v = $('v-remote');
    v.muted = false;
    v.play().catch(() => {});
    $('b-tap').hidden = true;
  });
  // Any first gesture unlocks sound, so the chip only shows after a gesture-less reload.
  const unlock = async () => { await media.unlockAudio(); renderChips(); };
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state === 'call') media.wakeLockOn();
    renderChips();
  });
}

// ---------- boot ----------
async function boot() {
  wireSetup();
  wireSettings();
  wireClaim();
  wireControls();
  wireAlerts();
  wireResilience();
  // One fixed room. Older builds kept a generated key and names here; they are not used any more.
  store.del('key'); store.del('names');
  key = ROOM_KEY;
  if (isLocal) { // tests only: an isolated room per test, so they do not collide on one signalling server
    const r = new URLSearchParams(location.search).get('room');
    if (r && (await parseKey(r)).ok) key = r;
  }
  role = store.get('role');
  if (role !== 'a' && role !== 'b') role = null;
  // Old invite links (#k= #r= #na= #nb=) are ignored. A relay (&ice=) is still accepted. The fragment is always stripped.
  if (location.hash) {
    const ice = iceFromLink(location.hash);
    if (ice) store.set('ice', JSON.stringify(ice));
    history.replaceState(null, '', location.pathname + location.search);
  }
  route();
}

window.__ah = {
  state: () => state,
  role: () => role,
  localTracks: () => (localStream ? localStream.getTracks().filter((t) => t.readyState === 'live').length : 0),
  remoteLive: () => { const v = $('v-remote'); return !!v.srcObject && v.readyState >= 2 && v.videoWidth > 0; },
  lastMessage: () => lastMessage,
  debug: {},
};
if (isLocal) {
  // Test hooks, localhost only.
  window.__ah.debug.freeze = () => { frozen = true; };
  window.__ah.debug.fakeSleep = () => { lastTick = Date.now() - 20000; };
  window.__ah.debug.netFail = () => ({ streak: failStreak, gap: dialGapMs, shown: !$('wait-netfail').hidden });
  window.__ah.debug.relink = () => onLinkOpen();
  window.__ah.debug.handshake = () => ({ sentProof, theirProofOk, authed, gotHello, gotProof });
  window.__ah.debug.inject = (m) => onData(m);
}
boot();


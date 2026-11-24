// The only file that touches PeerJS. Everything else talks to this small interface.
//
//   const sig = createSignal({ myId, otherId, role, iceServers, relayOnly });
//   sig.on(event, fn)   events: open, server-down, server-up, id-taken, link-open(conn),
//                       link-close, data(msg), incoming-call(answerFn), remote-stream(stream),
//                       media-failed, media-connected, media-close,
//                       dial-failed (a data link attempt closed, errored or timed out without ever opening)
//   sig.start() sig.stop() sig.send(obj) sig.dropLink()
//   sig.callOther(stream)      role 'a' only
//   sig.replaceTrack(kind, track|null)
//   sig.setDialGap(ms)         role 'b': minimum time between connection attempts (0 = every tick)
//   sig.reconnect()            nudge a dropped signaling socket
//   sig.isServerUp()

// STUN only. The old PeerJS TURN hosts no longer exist; a relay is added per device (see README).
export const DEFAULT_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
];

const DIAL_MS = 3000;
const DIAL_ATTEMPT_MS = 15000; // a slow link (mobile data, TURN) gets this long to open before we redial
const attemptMs = () => (isLocal() && window.__AH_DIAL_MS) || DIAL_ATTEMPT_MS; // test override, localhost only
const ID_RETRY_MS = 3000;
const ID_RETRY_MAX_MS = 60000;
const BACKOFF = [2000, 4000, 8000, 15000];

const isLocal = () => ['localhost', '127.0.0.1'].includes(location.hostname);

// Every Peer ever made, so tests can assert that none is orphaned (localhost only).
const allPeers = new Set();
if (isLocal()) window.__ahPeers = () => [...allPeers].filter((p) => !p.destroyed).length;

function serverOptions() {
  const o = { host: '0.peerjs.com', port: 443, secure: true, path: '/' };
  if (isLocal()) {
    const s = new URLSearchParams(location.search).get('signal');
    if (s) {
      const [host, port] = s.split(':');
      Object.assign(o, { host, port: Number(port) || 9000, secure: false, path: '/', key: 'peerjs' });
    }
  }
  return o;
}

export function createSignal({ myId, otherId, role, iceServers = [], relayOnly = false }) {
  const handlers = {};
  const emit = (ev, ...a) => (handlers[ev] || []).slice().forEach((fn) => { try { fn(...a); } catch (e) { console.error(e); } });

  let peer = null;
  let stopped = true;
  let serverUp = false;
  let conn = null;
  let call = null;
  let dialTimer = null;
  let retryTimer = null;
  let retryStep = 0;
  let idStart = 0;
  let pending = null;
  let pendingSince = 0;
  let dialGap = 0;
  let lastDial = 0;
  let idRetrying = false; // an unavailable-id retry is scheduled: nobody else may make a Peer meanwhile

  const forceRelay = relayOnly || (isLocal() && new URLSearchParams(location.search).get('relay') === '1');

  function makePeer() {
    if (stopped) return;
    if (peer) { const o = peer; peer = null; try { o.destroy(); } catch {} } // never leave an orphan holding the id
    const opts = {
      ...serverOptions(),
      config: {
        iceServers: [...DEFAULT_ICE, ...iceServers],
        iceTransportPolicy: forceRelay ? 'relay' : 'all',
      },
      debug: 1,
    };
    const p = new window.Peer(myId, opts);
    peer = p;
    allPeers.add(p);

    p.on('open', () => {
      if (peer !== p) return;
      retryStep = 0;
      idStart = 0;
      serverUp = true;
      emit('server-up');
      emit('open');
    });

    p.on('disconnected', () => {
      if (peer !== p || stopped) return;
      serverUp = false;
      emit('server-down');
      scheduleRetry(() => { if (peer === p && !p.destroyed) p.reconnect(); else if (peer === p) recreate(); });
    });

    p.on('close', () => {
      if (peer !== p || stopped) return;
      serverUp = false;
      emit('server-down');
      scheduleRetry(recreate);
    });

    p.on('error', (err) => {
      if (peer !== p || stopped) return;
      const type = err && err.type;
      if (type === 'peer-unavailable') { abortPending(); return; } // other side not here yet: dial again next tick
      if (type === 'unavailable-id') {
        if (!idStart) idStart = Date.now();
        if (Date.now() - idStart > ID_RETRY_MAX_MS) { emit('id-taken'); return; }
        emit('id-busy');
        peer = null; // before destroy(): its own disconnected/close events must not look like a server drop
        try { p.destroy(); } catch {}
        clearTimeout(retryTimer);
        idRetrying = true;
        retryTimer = setTimeout(() => { idRetrying = false; recreate(); }, ID_RETRY_MS);
        return;
      }
      if (type === 'webrtc' || type === 'browser-incompatible') return;
      serverUp = false;
      emit('server-down');
      if (p.destroyed) scheduleRetry(recreate);
      else if (p.disconnected) scheduleRetry(() => { if (peer === p && !p.destroyed) p.reconnect(); });
      else scheduleRetry(recreate);
    });

    p.on('connection', (c) => {
      if (peer !== p) return;
      if (c.peer !== otherId) { try { c.close(); } catch {} return; }
      adoptConn(c);
    });

    p.on('call', (c) => {
      if (peer !== p) return;
      if (c.peer !== otherId) { try { c.close(); } catch {} return; }
      emit('incoming-call', (stream) => {
        setCall(c);
        c.answer(stream || undefined);
      });
    });
  }

  function scheduleRetry(fn) {
    clearTimeout(retryTimer);
    idRetrying = false;
    const d = BACKOFF[Math.min(retryStep++, BACKOFF.length - 1)];
    retryTimer = setTimeout(() => { if (!stopped) fn(); }, d);
  }

  function recreate() {
    if (stopped) return;
    const old = peer;
    peer = null;
    try { old && old.destroy(); } catch {}
    makePeer();
  }

  function adoptConn(c) {
    if (conn && conn !== c) { const old = conn; conn = null; try { old.close(); } catch {} }
    conn = c;
    let wasOpen = false;
    const opened = () => {
      if (conn !== c) return;
      wasOpen = true;
      emit('link-open', c);
    };
    c.on('data', (d) => { if (conn === c) emit('data', d); });
    c.on('close', () => { if (pending === c) pending = null; if (conn === c) { conn = null; if (!wasOpen) emit('dial-failed'); emit('link-close'); } });
    c.on('error', () => { if (pending === c) pending = null; if (conn === c) { conn = null; try { c.close(); } catch {} if (!wasOpen) emit('dial-failed'); emit('link-close'); } });
    if (c.open) opened(); else c.on('open', opened);
  }

  function setCall(c) {
    if (call && call !== c) { const old = call; call = null; try { old.close(); } catch {} }
    call = c;
    c.on('stream', (s) => { if (call === c) emit('remote-stream', s); });
    c.on('close', () => { if (call === c) { call = null; emit('media-close'); } });
    c.on('error', () => { if (call === c) { call = null; emit('media-close'); } });
    // ICE watcher: the pc appears a moment after the call object.
    let tries = 0;
    const hook = () => {
      if (call !== c) return;
      const pc = c.peerConnection;
      if (pc) {
        const check = () => {
          if (call !== c) return;
          if (pc.iceConnectionState === 'failed') emit('media-failed');
          else if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') emit('media-connected');
        };
        pc.addEventListener('iceconnectionstatechange', check);
        check();
      } else if (tries++ < 20) setTimeout(hook, 100);
    };
    hook();
  }

  function abortPending() {
    const old = pending;
    if (!old) return;
    pending = null;
    if (conn === old) conn = null; // detach first so its close event stays silent
    try { old.close(); } catch {}
  }

  function dialTick() {
    if (stopped || role !== 'b' || !peer || peer.destroyed || !peer.open) return;
    if (conn && conn.open) return;
    // A slow attempt is left alone until it opens, fails, or runs out of time.
    if (pending && !pending.open) {
      if (Date.now() - pendingSince < attemptMs()) return;
      abortPending();
      emit('dial-failed'); // a silent timeout: the path never came up
    }
    if (Date.now() - lastDial < dialGap) return;
    try {
      const c = peer.connect(otherId, { reliable: true });
      pending = c;
      pendingSince = lastDial = Date.now();
      adoptConn(c);
    } catch {}
  }

  const api = {
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return api; },
    isServerUp: () => serverUp,
    setDialGap(ms) { dialGap = ms; },
    start() {
      if (!stopped) return;
      stopped = false;
      retryStep = 0;
      makePeer();
      if (role === 'b') dialTimer = setInterval(dialTick, DIAL_MS);
    },
    stop() {
      stopped = true;
      clearInterval(dialTimer); clearTimeout(retryTimer);
      idRetrying = false;
      const p = peer; peer = null; conn = null; call = null; pending = null; serverUp = false;
      try { p && p.destroy(); } catch {}
    },
    send(obj) {
      if (conn && conn.open) { try { conn.send(obj); return true; } catch {} }
      return false;
    },
    linkOpen: () => !!(conn && conn.open),
    dropLink() {
      const c = conn, m = call; conn = null; call = null; pending = null;
      try { m && m.close(); } catch {}
      try { c && c.close(); } catch {}
    },
    dropCall() {
      const m = call; call = null;
      try { m && m.close(); } catch {}
    },
    callOther(stream) {
      if (!peer || !peer.open) return false;
      // Always offer to receive, so a side with no camera or mic can still see and hear the other.
      const c = peer.call(otherId, stream, { constraints: { offerToReceiveAudio: true, offerToReceiveVideo: true } });
      if (!c) return false;
      setCall(c);
      return true;
    },
    replaceTrack(kind, track) {
      const pc = call && call.peerConnection;
      if (!pc) return false;
      const t = pc.getTransceivers().find((x) => x.receiver && x.receiver.track && x.receiver.track.kind === kind);
      if (!t || !t.sender) return false;
      t.sender.replaceTrack(track || null).catch(() => {});
      return true;
    },
    reconnect() {
      if (stopped || idRetrying) return; // the id retry owns the next Peer
      if (!peer || peer.destroyed) { recreate(); return; }
      if (peer.disconnected) { try { peer.reconnect(); } catch { recreate(); } }
    },
    peerState: () => (peer ? { open: peer.open, disconnected: peer.disconnected, destroyed: peer.destroyed } : null),
  };
  return api;
}

// Media helpers: getUserMedia wrapper, stop-all, cameras, wake lock, chime.

export function stopStream(stream) {
  if (!stream) return;
  for (const t of stream.getTracks()) { try { t.stop(); } catch {} }
}

const AUDIO = { echoCancellation: true, noiseSuppression: true };

export async function getStream(facing = 'user') {
  return navigator.mediaDevices.getUserMedia({
    audio: AUDIO,
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: facing } },
  });
}

/** One fresh track of a kind (used after "step away" and to flip the camera). */
export async function getTrack(kind, facing = 'user') {
  const s = await navigator.mediaDevices.getUserMedia(
    kind === 'audio'
      ? { audio: AUDIO }
      : { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: facing } } },
  );
  return s.getTracks()[0];
}

/** Ask for permission once and let go of the devices straight away. */
export async function probePermission() {
  let s;
  try {
    s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  } catch (e) {
    try { s = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { throw e; }
  }
  stopStream(s);
}

export async function cameraCount() {
  try {
    const d = await navigator.mediaDevices.enumerateDevices();
    return d.filter((x) => x.kind === 'videoinput').length;
  } catch { return 0; }
}

// ---- audio (chime + unlock) ----
let ctx = null;
function audio() {
  if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (C) ctx = new C(); }
  return ctx;
}
export const audioState = () => { const c = audio(); return c ? c.state : 'unsupported'; };
export async function unlockAudio() {
  const c = audio();
  if (c && c.state !== 'running') { try { await c.resume(); } catch {} }
  return audioState();
}
export function chime() {
  const c = audio();
  if (!c || c.state !== 'running') return false;
  const t0 = c.currentTime;
  [[660, 0], [880, 0.2]].forEach(([f, d]) => {
    const o = c.createOscillator(); const g = c.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + d);
    g.gain.exponentialRampToValueAtTime(0.15, t0 + d + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.4);
    o.connect(g).connect(c.destination);
    o.start(t0 + d); o.stop(t0 + d + 0.45);
  });
  return true;
}

// ---- wake lock ----
let lock = null;
export async function wakeLockOn() {
  if (!('wakeLock' in navigator) || (lock && !lock.released)) return;
  try { lock = await navigator.wakeLock.request('screen'); } catch { lock = null; }
}
export function wakeLockOff() {
  try { lock && lock.release(); } catch {}
  lock = null;
}

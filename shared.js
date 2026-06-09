// ── Shared state & sync for Escape Room ──────────────────────
// All state lives in localStorage; cross-tab realtime via BroadcastChannel.
window.ER = (function () {
  const CFG_KEY   = 'er_config';
  const STATE_KEY = 'er_state';
  const LB_KEY    = 'er_leaderboard';

  const channel = ('BroadcastChannel' in window) ? new BroadcastChannel('escape_room') : null;

  const DEFAULT_CONFIG = {
    durationSec: 60 * 60,           // 60 minutes
    rooms: [
      { code: '1234567890', hints: ['Empieza por el principio.', 'Son diez dígitos en orden.', 'Es 1234567890.'] },
    ],
  };

  function freshState() {
    return {
      started: false,
      paused: false,
      finished: false,
      won: false,
      currentRoom: 0,
      startEpoch: null,        // ms when timer (re)started
      elapsedBeforePause: 0,   // accumulated seconds while running, frozen on pause
      penaltySec: 0,           // added by hints
      hintsUsed: {},           // roomIndex -> count
      finishRemaining: null,   // seconds left at win
    };
  }

  function getConfig() {
    try {
      const c = JSON.parse(localStorage.getItem(CFG_KEY));
      if (c && Array.isArray(c.rooms) && c.rooms.length) return c;
    } catch (e) {}
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
  function setConfig(c) {
    localStorage.setItem(CFG_KEY, JSON.stringify(c));
    broadcast({ type: 'config' });
  }

  function getState() {
    try {
      const s = JSON.parse(localStorage.getItem(STATE_KEY));
      if (s && typeof s === 'object') return Object.assign(freshState(), s);
    } catch (e) {}
    return freshState();
  }
  function setState(s) {
    localStorage.setItem(STATE_KEY, JSON.stringify(s));
    broadcast({ type: 'state' });
  }
  function resetState() {
    const s = freshState();
    localStorage.setItem(STATE_KEY, JSON.stringify(s));
    broadcast({ type: 'reset' });
    return s;
  }

  // Seconds elapsed in the live run (does NOT include penalty).
  function elapsedSeconds(s) {
    let e = s.elapsedBeforePause || 0;
    if (s.started && !s.paused && s.startEpoch) {
      e += (Date.now() - s.startEpoch) / 1000;
    }
    return e;
  }

  function remainingSeconds(s, cfg) {
    if (!s.started) return cfg.durationSec;
    return cfg.durationSec - elapsedSeconds(s) - (s.penaltySec || 0);
  }

  // ── Timer controls (used by GM) ──
  function start() {
    const s = getState();
    if (s.finished) return s;
    if (!s.started) { s.started = true; s.startEpoch = Date.now(); s.paused = false; }
    else if (s.paused) { s.paused = false; s.startEpoch = Date.now(); }
    setState(s);
    return s;
  }
  function pause() {
    const s = getState();
    if (!s.started || s.paused || s.finished) return s;
    s.elapsedBeforePause = elapsedSeconds(s);
    s.paused = true; s.startEpoch = null;
    setState(s);
    return s;
  }
  function addTime(seconds) {
    const s = getState();
    // negative penalty effectively adds time back
    s.penaltySec = (s.penaltySec || 0) - seconds;
    setState(s);
    return s;
  }

  // ── Leaderboard ──
  function getScores() {
    try { return JSON.parse(localStorage.getItem(LB_KEY)) || []; } catch (e) { return []; }
  }
  function addScore(entry) {
    const lb = getScores();
    lb.push(entry);
    lb.sort((a, b) => b.remaining - a.remaining); // more time left = better
    const top = lb.slice(0, 10);
    localStorage.setItem(LB_KEY, JSON.stringify(top));
    return top;
  }
  function clearScores() { localStorage.removeItem(LB_KEY); }

  // ── Messaging ──
  function broadcast(msg) {
    if (channel) channel.postMessage(msg);
  }
  function flash(text) { broadcast({ type: 'flash', text }); }

  const listeners = [];
  function onMessage(fn) { listeners.push(fn); }
  if (channel) channel.onmessage = (e) => listeners.forEach(fn => fn(e.data));
  // also react to localStorage changes from other tabs as a fallback
  window.addEventListener('storage', (e) => {
    if (e.key === STATE_KEY) listeners.forEach(fn => fn({ type: 'state' }));
    if (e.key === CFG_KEY)   listeners.forEach(fn => fn({ type: 'config' }));
  });

  return {
    getConfig, setConfig,
    getState, setState, resetState, freshState,
    elapsedSeconds, remainingSeconds,
    start, pause, addTime,
    getScores, addScore, clearScores,
    flash, broadcast, onMessage,
    DEFAULT_CONFIG,
  };
})();

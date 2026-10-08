import { api, poller, store } from './api.js';
import * as C from './content.js';

const $ = (id) => document.getElementById(id);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const LS = 'localStorage';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLL_WAITING = 4000;
const POLL_IDLE = 60000;

/* ---------- reset per i test: ?reset=1 ---------- */
if (new URLSearchParams(location.search).has('reset')) {
  store.del(LS, 'deviceToken');
  store.del(LS, 'alertSeen');
  history.replaceState(null, '', location.pathname);
}

/* ---------- identità del dispositivo ---------- */
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // fallback per browser vecchi o contesti non https (test in LAN)
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
let token = store.get(LS, 'deviceToken');
let storageOk = true;
if (!token || !UUID_RE.test(token)) {
  token = uuid();
  storageOk = store.set(LS, 'deviceToken', token);
}
const fetchMe = () => api('/api/me', { headers: { 'X-Device-Token': token } });

/* ---------- schermate ---------- */
let current = null;      // id della schermata visibile
let last = null;         // ultimo /api/me confermato dal server
let dismissedWinner = null;
let celebrated = null;
let locking = false;

function show(id) {
  if (current === id) return;
  for (const s of document.querySelectorAll('main > .screen')) s.hidden = s.id !== id;
  const el = $(id);
  el.classList.remove('enter');
  if (!reduce) { void el.offsetWidth; el.classList.add('enter'); }
  current = id;
  scrollTo(0, 0);
}

function render(me) {
  last = me;
  renderWinner(me);

  if (me.status === 'approved') {
    $('m-name').textContent = me.display_name;
    $('m-text').textContent = me.mission;
    if (current === 'waiting' && !locking) lockThenMission();
    else if (!locking) show('mission');
    poll.start(POLL_IDLE);
  } else if (me.status === 'pending') {
    $('wait-nick').textContent = me.requested_name;
    $('radar').classList.remove('locked');
    $('wait-status').textContent = 'Matteo deve riconoscerti.';
    show('waiting');
    poll.start(POLL_WAITING);
  } else {
    const fromWaiting = current === 'waiting';
    if (me.status === 'rejected') {
      joinNote(`Matteo non ti riconosce come “${me.requested_name}”. Riprova con un altro nome.`);
    }
    showHall();
    if (fromWaiting) { nick.value = ''; nick.dispatchEvent(new Event('input')); nick.focus(); }
    poll.start(POLL_IDLE);
  }
}

function lockThenMission() {
  locking = true;
  $('radar').classList.add('locked');
  $('wait-status').textContent = 'Segnale agganciato!';
  setTimeout(() => { locking = false; show('mission'); }, reduce ? 600 : 1700);
}

/* ---------- hall ---------- */
let hallBuilt = false;
function showHall() {
  if (!hallBuilt) buildHall();
  show('hall');
}

function buildHall() {
  hallBuilt = true;
  for (const t of C.thanks) $('thanks-text').append(Object.assign(document.createElement('p'), { textContent: t }));
  $('thanks-sign').textContent = C.signature;
  $('hall-foot').textContent = C.footer;

  if (C.thesis?.length) {
    for (const t of C.thesis) $('thesis-text').append(Object.assign(document.createElement('p'), { textContent: t }));
  } else $('thesis-section').hidden = true;

  const grid = $('photos');
  let left = C.photos.length;
  const gone = () => { if (--left === 0) $('photos-section').hidden = true; };
  if (!left) $('photos-section').hidden = true;
  C.photos.forEach((p, i) => {
    const fig = document.createElement('figure');
    const img = Object.assign(new Image(), { src: p.src, alt: p.alt, decoding: 'async', loading: i === 0 ? 'eager' : 'lazy' });
    img.addEventListener('error', () => { fig.remove(); gone(); });
    fig.append(img);
    grid.append(fig);
  });

  if (!storageOk) {
    joinNote('Il browser non salva dati (navigazione privata?). Dopo aver chiesto l\'accesso non chiudere questa pagina.', true);
  }
}

function joinNote(msg, calm = false) {
  const n = $('join-note');
  n.textContent = msg;
  n.classList.toggle('calm', calm);
  n.hidden = !msg;
}

const nick = $('nick');
nick.addEventListener('input', () => { $('nick-count').textContent = `${[...nick.value].length}/30`; });

$('join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = nick.value.replace(/\s+/g, ' ').trim();
  if (!name) { joinNote('Scrivi un nome.'); nick.focus(); return; }
  const btn = $('join-btn');
  btn.disabled = true; btn.textContent = 'Invio…';
  try {
    render(await api('/api/join', { method: 'POST', body: { name }, headers: { 'X-Device-Token': token } }));
    joinNote('');
  } catch (err) {
    if (err.status === 409) {
      // già in attesa o già accettato (es. altra scheda): mostra lo stato vero
      try { render(await fetchMe()); } catch (e2) { joinNote(e2.message); }
    } else {
      joinNote(`${err.message} Riprova.`);
    }
  } finally {
    btn.disabled = false; btn.textContent = 'Chiedi l\'accesso';
  }
});

/* ---------- vincitore ---------- */
function renderWinner(me) {
  const w = me.winner;
  const el = $('winner');
  if (!w || dismissedWinner === w.name) { el.hidden = true; return; }
  $('w-name').textContent = w.name;
  const mine = me.status === 'approved';
  $('w-mine').hidden = !mine;
  $('w-mission').textContent = mine ? me.mission : '';
  $('w-close').hidden = mine;
  el.hidden = false;
  if (celebrated !== w.name) { celebrated = w.name; confetti(); }
}
$('w-close').addEventListener('click', () => {
  dismissedWinner = last?.winner?.name ?? null;
  $('winner').hidden = true;
});

function confetti() {
  if (reduce) return;
  const box = $('confetti');
  box.replaceChildren();
  const colors = ['#e3c27a', '#8fae7a', '#efe7d6', '#c9a35a'];
  for (let i = 0; i < 70; i++) {
    const c = document.createElement('i');
    c.style.left = `${Math.random() * 100}%`;
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = `${Math.random() * 0.9}s`;
    c.style.setProperty('--dx', `${(Math.random() - 0.5) * 40}vw`);
    c.style.setProperty('--r', `${(Math.random() - 0.5) * 1080}deg`);
    box.append(c);
  }
  setTimeout(() => box.replaceChildren(), 4500);
}

/* ---------- polling ed errori ---------- */
function banner(msg) {
  $('banner').hidden = !msg;
  $('banner-msg').textContent = msg || '';
}
const poll = poller(async () => {
  try { render(await fetchMe()); banner(''); }
  catch (err) { banner(err.message); }   // resta visibile l'ultimo stato confermato
}, POLL_IDLE);
$('banner-retry').addEventListener('click', () => poll.now());

let mePromise = fetchMe();
async function start() {
  document.body.classList.remove('locked');
  try {
    render(await mePromise);
  } catch (err) {
    $('fatal-msg').textContent = err.message;
    show('fatal');
  }
}
$('fatal-retry').addEventListener('click', () => {
  show('loading');
  mePromise = fetchMe();
  start();
});
mePromise.catch(() => {});   // l'errore viene mostrato da start()

/* ---------- 1. scherzo ---------- */
const alertEl = $('alert');
if (store.get(LS, 'alertSeen')) {
  alertEl.remove();
  start();
} else {
  alertEl.hidden = false;
  const allow = $('allow'), deny = $('deny'), log = $('log');
  let denies = 0;

  deny.addEventListener('click', () => {
    denies++;
    const s = 0.7 ** denies;
    $('deny-msg').textContent = C.denyMessages[Math.min(denies, C.denyMessages.length) - 1];
    if (s < 0.2) { deny.remove(); allow.focus(); return; }
    deny.style.transform = `scale(${s})`;
    deny.style.flexGrow = String(s);
  });

  allow.addEventListener('click', () => {
    allow.disabled = true;
    deny.disabled = true;
    $('deny-msg').textContent = '';
    const step = reduce ? 0 : 450;
    let i = 0;
    (function next() {
      if (i < C.logAllow.length) { log.textContent += C.logAllow[i++] + '\n'; setTimeout(next, step); }
      else setTimeout(finish, reduce ? 0 : 900);
    })();
  });

  function finish() {
    store.set(LS, 'alertSeen', '1');
    alertEl.classList.add('gone');
    setTimeout(() => alertEl.remove(), reduce ? 0 : 600);
    start();
  }
  allow.focus({ preventScroll: true });
}

/* ---------- sfondo: un satellite in orbita che illumina una stazione a terra ---------- */
(() => {
  const c = $('sky');
  const g = c.getContext('2d');
  let w, h, dpr, stars = [];
  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = c.width = innerWidth * dpr;
    h = c.height = innerHeight * dpr;
    stars = Array.from({ length: 70 }, () => [Math.random() * w, Math.random() * h * 0.7, Math.random() * 1.2 + 0.3]);
  }
  size();
  addEventListener('resize', () => { size(); if (reduce) frame(performance.now()); });

  const t0 = performance.now();
  function frame(t) {
    const s = (t - t0) / 1000;
    g.clearRect(0, 0, w, h);

    g.fillStyle = 'rgba(239,231,214,.55)';
    for (const [x, y, r] of stars) { g.beginPath(); g.arc(x, y, r * dpr, 0, 7); g.fill(); }

    const cx = w * 0.55, cy = h * 0.28, rx = w * 0.75, ry = h * 0.09, tilt = -0.18;
    g.strokeStyle = 'rgba(227,194,122,.16)'; g.lineWidth = dpr;
    g.beginPath(); g.ellipse(cx, cy, rx, ry, tilt, 0, Math.PI * 2); g.stroke();

    const th = s * 0.22;
    const ex = rx * Math.cos(th), ey = ry * Math.sin(th);
    const px = cx + ex * Math.cos(tilt) - ey * Math.sin(tilt);
    const py = cy + ex * Math.sin(tilt) + ey * Math.cos(tilt);

    const gx = w * 0.82, gy = h * 0.62;
    const pulse = (s % 3) / 3;
    g.strokeStyle = `rgba(143,174,122,${0.35 * (1 - pulse)})`;
    g.beginPath(); g.arc(gx, gy, (8 + pulse * 90) * dpr, Math.PI, Math.PI * 2); g.stroke();

    g.setLineDash([3 * dpr, 7 * dpr]);
    g.strokeStyle = 'rgba(227,194,122,.22)';
    g.beginPath(); g.moveTo(px, py); g.lineTo(gx, gy); g.stroke();
    g.setLineDash([]);

    g.fillStyle = '#e3c27a';
    g.beginPath(); g.arc(px, py, 3 * dpr, 0, 7); g.fill();
    g.fillStyle = '#8fae7a';
    g.beginPath(); g.arc(gx, gy, 2.5 * dpr, 0, 7); g.fill();

    if (!reduce) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

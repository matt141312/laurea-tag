import { api, poller, store } from './api.js';

const $ = (id) => document.getElementById(id);
const SS = 'sessionStorage';
const POLL_MS = 4000;

let state = null;
let stateKey = '';

/* ---------- sessione ---------- */
function session() {
  const t = store.get(SS, 'adminToken');
  const exp = Number(store.get(SS, 'adminExp'));
  return t && exp > Date.now() ? t : null;
}

function logout(msg = '') {
  store.del(SS, 'adminToken');
  store.del(SS, 'adminExp');
  poll.stop();
  state = null; stateKey = '';
  document.title = 'Admin';
  $('panel').hidden = true;
  $('login').hidden = false;
  loginErr(msg);
  $('pw').focus();
}

function loginErr(msg) { $('login-err').textContent = msg; $('login-err').hidden = !msg; }

async function adminApi(path, body) {
  const token = session();
  if (!token) { logout('Sessione scaduta. Rifai il login.'); throw new Error('Sessione scaduta.'); }
  try {
    return await api(path, {
      method: body === undefined ? 'GET' : 'POST',
      body,
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    if (err.status === 401) logout(err.message);
    throw err;
  }
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('login-btn');
  btn.disabled = true; btn.textContent = 'Verifica…';
  try {
    const { token, exp } = await api('/api/admin/login', { method: 'POST', body: { password: $('pw').value } });
    if (!store.set(SS, 'adminToken', token) || !store.set(SS, 'adminExp', String(exp))) {
      throw new Error('Il browser non permette di salvare la sessione (navigazione privata?).');
    }
    $('pw').value = '';
    loginErr('');
    enter();
  } catch (err) {
    loginErr(err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Entra';
  }
});

$('logout').addEventListener('click', () => logout());

function enter() {
  $('login').hidden = true;
  $('panel').hidden = false;
  poll.start(POLL_MS, true);
}

/* ---------- polling ---------- */
function panelErr(msg) { $('err-msg').textContent = msg; $('err').hidden = !msg; }

const poll = poller(async () => {
  try { apply(await adminApi('/api/admin/state')); panelErr(''); }
  catch (err) { if (session()) panelErr(err.message); }
}, POLL_MS);
$('err-retry').addEventListener('click', () => poll.now());

/* ---------- rendering ---------- */
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
};
const btn = (label, cls, onClick) => {
  const b = el('button', { type: 'button', className: `btn ${cls}`, textContent: label });
  b.addEventListener('click', onClick);
  return b;
};
const hhmm = (iso) => new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
const missionById = (id) => state.missions.find((m) => m.id === id);

function apply(s) {
  state = s;
  const key = JSON.stringify(s);
  if (key === stateKey) return;   // niente da ridisegnare: non perdere il focus
  stateKey = key;

  const by = (st) => s.guests.filter((g) => g.status === st);
  const pending = by('pending'), approved = by('approved'), rejected = by('rejected');
  document.title = pending.length ? `(${pending.length}) Admin` : 'Admin';
  $('n-pending').textContent = pending.length;
  $('n-approved').textContent = approved.length;
  $('n-rejected').textContent = rejected.length;

  $('pending').replaceChildren(...(pending.length ? pending.map((g) => el('div', { className: 'item pending' },
    el('p', { className: 'name', textContent: g.requested_name }),
    el('p', { className: 'meta', textContent: `alle ${hhmm(g.created_at)}${g.join_count > 1 ? ` · tentativo ${g.join_count}` : ''}` }),
    el('div', { className: 'row' },
      btn('Rifiuta', 'danger', (e) => act(e.target, `/api/admin/guests/${g.id}/reject`, {}, `Rifiutato “${g.requested_name}”`)),
      btn('Accetta', 'gold', () => openApprove(g))),
  )) : [el('p', { className: 'empty', textContent: 'Nessuna richiesta.' })]));

  $('approved').replaceChildren(...(approved.length ? approved.map((g) => el('div', { className: 'item' },
    el('p', { className: 'name', textContent: g.display_name + (g.id === s.winner_guest_id ? ' 🏆' : '') }),
    el('p', { className: 'meta', textContent: g.display_name !== g.requested_name ? `si era presentato come “${g.requested_name}”` : `accettato alle ${hhmm(g.decided_at)}` }),
    el('p', { className: 'mtext', textContent: missionById(g.mission_id)?.text ?? '—' }),
    el('div', { className: 'row' },
      btn('Cambia missione', 'ghost', () => openMission(g)),
      btn('Reset', 'danger', () => confirmAct(`Reset di ${g.display_name}?`, 'Torna alla hall e dovrà chiedere di nuovo l\'accesso.',
        `/api/admin/guests/${g.id}/reset`, {}, `${g.display_name} resettato`))),
  )) : [el('p', { className: 'empty', textContent: 'Ancora nessuno.' })]));

  $('rejected').replaceChildren(...(rejected.length ? rejected.map((g) => el('div', { className: 'item' },
    el('p', { className: 'name', textContent: g.requested_name }),
    el('p', { className: 'meta', textContent: `rifiutato alle ${hhmm(g.decided_at)} · tentativi ${g.join_count}/5` }),
    el('div', { className: 'row' },
      btn('Reset', 'ghost', () => confirmAct(`Reset di “${g.requested_name}”?`, 'Potrà richiedere l\'accesso da capo (tentativi azzerati).',
        `/api/admin/guests/${g.id}/reset`, {}, 'Resettato'))),
  )) : [el('p', { className: 'empty', textContent: 'Nessuno.' })]));

  // vincitore
  const w = approved.find((g) => g.id === s.winner_guest_id);
  $('w-current').textContent = w ? `🏆 ${w.display_name}` : 'Non ancora proclamato.';
  $('w-cancel').hidden = !w;
  const sel = $('w-select');
  const prev = sel.value;
  sel.replaceChildren(el('option', { value: '', textContent: approved.length ? 'Scegli un ospite…' : 'Nessun ospite accettato' }),
    ...approved.map((g) => el('option', { value: g.id, textContent: g.display_name })));
  sel.value = approved.some((g) => String(g.id) === prev) ? prev : '';
}

/* ---------- azioni ---------- */
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2200);
}

async function act(button, path, body, okMsg) {
  button.disabled = true;
  try { apply(await adminApi(path, body)); toast(okMsg); panelErr(''); }
  catch (err) { panelErr(err.message); poll.now(); }
  finally { button.disabled = false; }
}

// Foglio missione: usato da "Accetta" (con nome) e da "Cambia missione".
let sheetSubmit = null;
function missionOptions(selected) {
  const sel = $('sheet-mission');
  sel.replaceChildren(...state.missions.map((m) => el('option', {
    value: m.id,
    textContent: `${m.assigned ? '✓ ' : ''}${m.id}. ${m.text.length > 55 ? m.text.slice(0, 54) + '…' : m.text}`,
  })));
  sel.value = selected;
  preview();
}
function preview() {
  const m = missionById(Number($('sheet-mission').value));
  $('sheet-preview').textContent = m ? m.text + (m.assigned ? `\n(già assegnata a ${m.assigned_to.join(', ')})` : '') : '';
  $('sheet-preview').style.whiteSpace = 'pre-line';
}
$('sheet-mission').addEventListener('change', preview);

function randomFree() {
  const free = state.missions.filter((m) => !m.assigned);
  const pool = free.length ? free : state.missions;
  return pool[Math.floor(Math.random() * pool.length)]?.id;
}

function openApprove(g) {
  $('sheet-title').textContent = `Accetta “${g.requested_name}”`;
  $('sheet-name-wrap').hidden = false;
  $('sheet-name').value = g.requested_name;
  // telefono cambiato: stesso nome di un ospite già accettato → proponi la sua missione
  const twin = state.guests.find((o) => o.status === 'approved' && o.display_name.toLowerCase() === g.requested_name.toLowerCase());
  missionOptions(twin ? twin.mission_id : randomFree());
  $('sheet-err').textContent = twin ? `Attenzione: “${twin.display_name}” è già accettato. Se ha cambiato telefono, tieni la stessa missione e poi fai Reset del vecchio.` : '';
  sheetSubmit = () => adminApi(`/api/admin/guests/${g.id}/approve`, {
    display_name: $('sheet-name').value, mission_id: Number($('sheet-mission').value),
  }).then((s) => [s, `Accettato ${$('sheet-name').value.trim()}`]);
  $('sheet').showModal();
}

function openMission(g) {
  $('sheet-title').textContent = `Missione di ${g.display_name}`;
  $('sheet-name-wrap').hidden = true;
  missionOptions(g.mission_id);
  $('sheet-err').textContent = '';
  sheetSubmit = () => adminApi(`/api/admin/guests/${g.id}/mission`, { mission_id: Number($('sheet-mission').value) })
    .then((s) => [s, 'Missione cambiata']);
  $('sheet').showModal();
}

$('sheet-cancel').addEventListener('click', () => $('sheet').close());
$('sheet-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ok = $('sheet-ok');
  ok.disabled = true;
  try {
    const [s, msg] = await sheetSubmit();
    $('sheet').close();
    apply(s); toast(msg);
  } catch (err) {
    $('sheet-err').textContent = err.message;
    poll.now();
  } finally { ok.disabled = false; }
});

// Conferma generica ("Sei sicuro?")
let confirmRun = null;
function confirmAct(title, text, path, body, okMsg) {
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  $('confirm-err').textContent = '';
  confirmRun = () => adminApi(path, body).then((s) => [s, okMsg]);
  $('confirm').showModal();
}
$('confirm-no').addEventListener('click', () => $('confirm').close());
$('confirm').querySelector('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const yes = $('confirm-yes');
  yes.disabled = true;
  try {
    const [s, msg] = await confirmRun();
    $('confirm').close();
    apply(s); toast(msg);
  } catch (err) {
    $('confirm-err').textContent = err.message;
  } finally { yes.disabled = false; }
});

$('w-proclaim').addEventListener('click', () => {
  const id = Number($('w-select').value);
  const g = state?.guests.find((x) => x.id === id);
  if (!g) { panelErr('Scegli prima un ospite accettato.'); return; }
  confirmAct(`Proclamare ${g.display_name}?`, 'Lo vedranno subito tutti sul telefono.', '/api/admin/winner', { guest_id: id }, `${g.display_name} è il vincitore`);
});
$('w-cancel').addEventListener('click', () =>
  confirmAct('Annullare il vincitore?', 'Sparirà dai telefoni degli ospiti.', '/api/admin/winner', { guest_id: null }, 'Vincitore annullato'));

/* ---------- avvio ---------- */
if (session()) enter(); else logout();

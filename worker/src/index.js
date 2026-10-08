// Laurea Matteo: backend delle bomboniere NFC.
// Cloudflare Worker + D1. Ogni risposta è JSON; ogni errore è { error: "<messaggio leggibile>" }.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const NAME_MAX = 30;
const JOIN_MAX_PER_DEVICE = 5;
const PENDING_MAX = 80;               // tetto globale anti-spam (ospiti ~30)
const JOIN_MAX_PER_IP = 60;           // alla festa tutti escono dallo stesso wifi: limite largo
const LOGIN_FAIL_MAX = 5;
const WINDOW_MS = 15 * 60 * 1000;
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
    }

    try {
      if (origin && !cors) throw new HttpError(403, 'Origine non consentita.');
      const body = await route(request, env);
      return json(200, body, cors);
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.message }, cors);
      console.error(err);
      return json(500, { error: 'Errore interno del server. Riprova tra poco.' }, cors);
    }
  },
};

function corsHeaders(origin, env) {
  if (!origin) return null;
  if (origin !== env.ALLOWED_ORIGIN && !LOCAL_ORIGIN_RE.test(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-Token',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(status, body, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(cors || {}) },
  });
}

async function route(request, env) {
  const { pathname } = new URL(request.url);
  const m = request.method;

  if (m === 'GET' && pathname === '/api/me') return me(request, env);
  if (m === 'POST' && pathname === '/api/join') return join(request, env);
  if (m === 'POST' && pathname === '/api/admin/login') return login(request, env);

  if (pathname.startsWith('/api/admin/')) {
    await requireAdmin(request, env);
    if (m === 'GET' && pathname === '/api/admin/state') return adminState(env);
    if (m === 'POST' && pathname === '/api/admin/winner') return setWinner(request, env);
    const g = pathname.match(/^\/api\/admin\/guests\/(\d+)\/(approve|reject|mission|reset)$/);
    if (m === 'POST' && g) {
      const id = Number(g[1]);
      const action = { approve, reject, mission: changeMission, reset }[g[2]];
      await action(id, request, env);
      return adminState(env);
    }
  }
  throw new HttpError(404, 'Indirizzo non trovato.');
}

/* ---------------- utilità ---------------- */

const now = () => new Date().toISOString();
const clientIp = (req) => req.headers.get('CF-Connecting-IP') || 'local';

async function readJson(request) {
  try { return await request.json(); }
  catch { throw new HttpError(400, 'Richiesta non valida (JSON atteso).'); }
}

function cleanName(raw) {
  if (typeof raw !== 'string') throw new HttpError(400, 'Scrivi un nome.');
  const name = raw.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!name) throw new HttpError(400, 'Scrivi un nome.');
  if ([...name].length > NAME_MAX) throw new HttpError(400, `Massimo ${NAME_MAX} caratteri.`);
  return name;
}

function deviceToken(request) {
  const t = request.headers.get('X-Device-Token') || '';
  if (!UUID_RE.test(t)) throw new HttpError(400, 'Identificativo del dispositivo mancante o non valido.');
  return t.toLowerCase();
}

async function countHits(env, kind, ip) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM hits WHERE kind = ? AND ip = ? AND at > ?')
    .bind(kind, ip, Date.now() - WINDOW_MS).first();
  return row.n;
}

function addHit(env, kind, ip) {
  return env.DB.batch([
    env.DB.prepare('INSERT INTO hits (kind, ip, at) VALUES (?, ?, ?)').bind(kind, ip, Date.now()),
    env.DB.prepare('DELETE FROM hits WHERE at < ?').bind(Date.now() - WINDOW_MS),
  ]);
}

async function getWinner(env) {
  return env.DB.prepare(
    `SELECT g.id, g.display_name AS name FROM settings s
     JOIN guests g ON g.id = CAST(s.value AS INTEGER) AND g.status = 'approved'
     WHERE s.key = 'winner_guest_id'`
  ).first();
}

async function missionExists(env, id) {
  if (!Number.isInteger(id)) throw new HttpError(400, 'Scegli una missione.');
  const row = await env.DB.prepare('SELECT id FROM missions WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(400, 'Missione inesistente.');
}

/* ---------------- ospite ---------------- */

async function me(request, env) {
  const token = deviceToken(request);
  const g = await env.DB.prepare(
    `SELECT g.status, g.requested_name, g.display_name, m.text AS mission
     FROM guests g LEFT JOIN missions m ON m.id = g.mission_id WHERE g.device_token = ?`
  ).bind(token).first();
  const w = await getWinner(env);
  const winner = w ? { name: w.name } : null;
  if (!g) return { status: 'new', requested_name: null, display_name: null, mission: null, winner };
  return {
    status: g.status,
    requested_name: g.requested_name,
    display_name: g.status === 'approved' ? g.display_name : null,
    mission: g.status === 'approved' ? g.mission : null,
    winner,
  };
}

async function join(request, env) {
  const token = deviceToken(request);
  const { name: raw } = await readJson(request);
  const name = cleanName(raw);
  const ip = clientIp(request);

  if (await countHits(env, 'join', ip) >= JOIN_MAX_PER_IP) {
    throw new HttpError(429, 'Troppe richieste da questa rete. Aspetta qualche minuto.');
  }

  const g = await env.DB.prepare('SELECT id, status, join_count FROM guests WHERE device_token = ?').bind(token).first();
  if (g?.status === 'approved') throw new HttpError(409, 'Sei già stato riconosciuto.');
  if (g?.status === 'pending') throw new HttpError(409, 'Hai già una richiesta in attesa.');
  if (g && g.join_count >= JOIN_MAX_PER_DEVICE) {
    throw new HttpError(429, 'Hai finito i tentativi. Vai a parlare con Matteo di persona.');
  }

  const pending = await env.DB.prepare("SELECT COUNT(*) AS n FROM guests WHERE status = 'pending'").first();
  if (pending.n >= PENDING_MAX) throw new HttpError(429, 'Troppe richieste in coda. Riprova tra qualche minuto.');

  await addHit(env, 'join', ip);
  if (g) {
    await env.DB.prepare(
      `UPDATE guests SET requested_name = ?, status = 'pending', join_count = join_count + 1,
       created_at = ?, decided_at = NULL WHERE id = ? AND status = 'rejected'`
    ).bind(name, now(), g.id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO guests (device_token, requested_name, status, created_at) VALUES (?, ?, 'pending', ?)
       ON CONFLICT(device_token) DO NOTHING`
    ).bind(token, name, now()).run();
  }
  return me(request, env);
}

/* ---------------- admin: autenticazione ---------------- */

const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

function secrets(env) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
    throw new HttpError(500, 'Configurazione incompleta: mancano ADMIN_PASSWORD o SESSION_SECRET.');
  }
  return env;
}

const hmacKey = (secret) =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

async function sameSecret(a, b) {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}

async function login(request, env) {
  const { ADMIN_PASSWORD, SESSION_SECRET } = secrets(env);
  const ip = clientIp(request);
  if (await countHits(env, 'login_fail', ip) >= LOGIN_FAIL_MAX) {
    throw new HttpError(429, 'Troppi tentativi sbagliati. Riprova tra 15 minuti.');
  }
  const { password } = await readJson(request);
  if (typeof password !== 'string' || !(await sameSecret(password, ADMIN_PASSWORD))) {
    await addHit(env, 'login_fail', ip);
    throw new HttpError(401, 'Password sbagliata.');
  }
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = b64url(enc.encode(JSON.stringify({ exp })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(SESSION_SECRET), enc.encode(payload));
  return { token: `${payload}.${b64url(sig)}`, exp };
}

async function requireAdmin(request, env) {
  const { SESSION_SECRET } = secrets(env);
  const m = (request.headers.get('Authorization') || '').match(/^Bearer ([\w-]+)\.([\w-]+)$/);
  if (!m) throw new HttpError(401, 'Accesso admin richiesto.');
  let ok = false, exp = 0;
  try {
    ok = await crypto.subtle.verify('HMAC', await hmacKey(SESSION_SECRET), unb64url(m[2]), enc.encode(m[1]));
    exp = JSON.parse(new TextDecoder().decode(unb64url(m[1]))).exp;
  } catch { ok = false; }
  if (!ok) throw new HttpError(401, 'Sessione non valida. Rifai il login.');
  if (!(exp > Date.now())) throw new HttpError(401, 'Sessione scaduta. Rifai il login.');
}

/* ---------------- admin: azioni ---------------- */

async function adminState(env) {
  // ~75 righe lette per chiamata: l'admin fa polling ogni 4 s per ore, D1 conta le righe lette.
  const [guests, missions, winner] = await Promise.all([
    env.DB.prepare(
      `SELECT id, requested_name, display_name, status, mission_id, join_count, created_at, decided_at
       FROM guests ORDER BY created_at`
    ).all(),
    env.DB.prepare('SELECT id, text FROM missions ORDER BY id').all(),
    getWinner(env),
  ]);
  const assigned = new Map();
  for (const g of guests.results) {
    if (g.status === 'approved' && g.mission_id != null) {
      assigned.set(g.mission_id, [...(assigned.get(g.mission_id) || []), g.display_name]);
    }
  }
  return {
    guests: guests.results,
    missions: missions.results.map((m) => {
      const assigned_to = assigned.get(m.id) || [];
      return { id: m.id, text: m.text, assigned: assigned_to.length > 0, assigned_to };
    }),
    winner_guest_id: winner ? winner.id : null,
  };
}

async function decided(env, id, res) {
  if (res.meta.changes > 0) return;
  const g = await env.DB.prepare('SELECT status FROM guests WHERE id = ?').bind(id).first();
  if (!g) throw new HttpError(404, 'Ospite non trovato (forse è stato resettato).');
  throw new HttpError(409, g.status === 'approved' ? 'Già accettato (forse da un altro telefono).'
    : g.status === 'rejected' ? 'Già rifiutato (forse da un altro telefono).' : 'Stato cambiato, ricarica.');
}

async function approve(id, request, env) {
  const { display_name, mission_id } = await readJson(request);
  const name = cleanName(display_name);
  await missionExists(env, mission_id);
  const res = await env.DB.prepare(
    `UPDATE guests SET status = 'approved', display_name = ?, mission_id = ?, decided_at = ?
     WHERE id = ? AND status = 'pending'`
  ).bind(name, mission_id, now(), id).run();
  await decided(env, id, res);
}

async function reject(id, _request, env) {
  const res = await env.DB.prepare(
    `UPDATE guests SET status = 'rejected', decided_at = ? WHERE id = ? AND status = 'pending'`
  ).bind(now(), id).run();
  await decided(env, id, res);
}

async function changeMission(id, request, env) {
  const { mission_id } = await readJson(request);
  await missionExists(env, mission_id);
  const res = await env.DB.prepare(
    `UPDATE guests SET mission_id = ? WHERE id = ? AND status = 'approved'`
  ).bind(mission_id, id).run();
  if (res.meta.changes === 0) throw new HttpError(409, 'Puoi cambiare missione solo a un ospite accettato.');
}

async function reset(id, _request, env) {
  const [res] = await env.DB.batch([
    env.DB.prepare('DELETE FROM guests WHERE id = ?').bind(id),
    env.DB.prepare("DELETE FROM settings WHERE key = 'winner_guest_id' AND value = ?").bind(String(id)),
  ]);
  if (res.meta.changes === 0) throw new HttpError(404, 'Ospite non trovato (forse è già stato resettato).');
}

async function setWinner(request, env) {
  const { guest_id } = await readJson(request);
  if (guest_id === null) {
    await env.DB.prepare("DELETE FROM settings WHERE key = 'winner_guest_id'").run();
    return adminState(env);
  }
  if (!Number.isInteger(guest_id)) throw new HttpError(400, 'Scegli un ospite.');
  const g = await env.DB.prepare("SELECT id FROM guests WHERE id = ? AND status = 'approved'").bind(guest_id).first();
  if (!g) throw new HttpError(409, 'Il vincitore deve essere un ospite accettato.');
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES ('winner_guest_id', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(String(guest_id)).run();
  return adminState(env);
}

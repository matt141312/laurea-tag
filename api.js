// Chiamate al Worker. Ogni fallimento diventa un Error con un messaggio leggibile:
// la pagina lo mostra così com'è, con "Riprova". Niente stati inventati.
import { API_BASE } from './config.js';

export class ApiError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  if (API_BASE.includes('TODO')) throw new ApiError('Backend non configurato (config.js).');
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined,
    });
  } catch (e) {
    throw new ApiError(e.name === 'TimeoutError'
      ? 'Il server non risponde. Controlla la connessione.'
      : 'Nessuna connessione con il server.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* risposta non JSON */ }
  if (!res.ok) throw new ApiError(data?.error || `Errore del server (${res.status}).`, res.status);
  if (data === null) throw new ApiError('Risposta del server non valida.');
  return data;
}

// Polling a catena (mai due richieste in volo), solo con la pagina visibile.
// Al ritorno in primo piano parte subito.
export function poller(fn, ms) {
  let timer = null, running = false, stopped = true, interval = ms;
  async function tick() {
    clearTimeout(timer); timer = null;
    if (stopped || running || document.hidden) return;
    running = true;
    try { await fn(); } finally {
      running = false;
      if (!stopped && !document.hidden) timer = setTimeout(tick, interval);
    }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  return {
    start(newMs = interval, now = false) {
      interval = newMs; stopped = false;
      clearTimeout(timer); timer = null;
      if (now) tick();
      else if (!running) timer = setTimeout(tick, interval);
    },
    stop() { stopped = true; clearTimeout(timer); timer = null; },
    now: () => tick(),
  };
}

export const store = {
  get(area, k) { try { return window[area].getItem(k); } catch { return null; } },
  set(area, k, v) { try { window[area].setItem(k, v); return true; } catch { return false; } },
  del(area, k) { try { window[area].removeItem(k); } catch { /* ignora */ } },
};

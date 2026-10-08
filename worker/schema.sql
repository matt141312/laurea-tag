-- Idempotente: si può rieseguire senza perdere dati.
CREATE TABLE IF NOT EXISTS missions (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guests (
  id INTEGER PRIMARY KEY,
  device_token TEXT NOT NULL UNIQUE,
  requested_name TEXT NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
  mission_id INTEGER REFERENCES missions(id),
  join_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS guests_status ON guests(status);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
-- settings: winner_guest_id

-- Tentativi di login falliti e richieste di accesso, per il rate limit per IP.
CREATE TABLE IF NOT EXISTS hits (
  kind TEXT NOT NULL,   -- 'login_fail' | 'join'
  ip TEXT NOT NULL,
  at INTEGER NOT NULL   -- epoch ms
);
CREATE INDEX IF NOT EXISTS hits_lookup ON hits(kind, ip, at);

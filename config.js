// Unico punto in cui compare l'indirizzo del backend.
// In locale (localhost) usa `wrangler dev`; altrove il Worker pubblicato.
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

export const API_BASE = LOCAL
  ? 'http://localhost:8787'
  : 'https://laurea-tag.laurea-tag.workers.dev';

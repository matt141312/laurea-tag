# Laurea Matteo: bomboniera NFC

Pagina aperta dai tag NFC (NTAG213) delle bomboniere della festa di laurea (~30 ospiti).
Lo scherzo del virus, un ringraziamento con le foto della proclamazione, poi ogni ospite chiede l'accesso col proprio soprannome. **Matteo accetta dal suo telefono** e l'ospite riceve **una missione per la serata**. A fine serata Matteo sceglie il vincitore, che dirige gli scherzi, e tutti lo vedono sul telefono.

## Vincoli

- **L'URL dei tag non cambia**: `https://<username>.github.io/laurea-tag/` (GitHub Pages, questo repo).
- Frontend: HTML/CSS/JS vanilla, **nessun build step**, mobile-first.
- Backend minimo: **Cloudflare Worker + D1** (piano gratuito) in `worker/`, deploy con `wrangler`. Serve solo a ricevere le richieste, gestire le accettazioni e pubblicare il vincitore.
- **Graficamente curato, semplice, divertente.** Poche schermate, ognuna con un solo compito. Ricevuta la missione, l'ospite ha finito e mette via il telefono.
- Repo pubblico: missioni e codice visibili, va bene. L'unico segreto è la password admin, salvata come secret del Worker.
- **Fail loud**: ogni errore di rete o del server viene mostrato con un messaggio chiaro e "Riprova". Niente stati inventati.
- Interfaccia in italiano.

## Stile

Riparti dall'`index.html` attuale:
- palette: `--ink #0f1b2d`, `--paper #efe7d6`, `--laurel #8fae7a`, `--gold #e3c27a`, `--hazard #ffd400` (solo nello scherzo)
- font: Fraunces per i titoli, Atkinson Hyperlegible per il testo, JetBrains Mono solo nel terminale dello scherzo
- sfondo canvas con satellite in orbita

Un solo grande momento animato per schermata, niente effetti sparsi. Rispetta `prefers-reduced-motion`, usa focus visibile e testo da almeno 17px.

## Flusso ospite (`index.html`)

È un'unica pagina con stati. Lo stato si decide da `GET /api/me`, tranne lo scherzo, che usa un flag in `localStorage`.

Identità: al primo avvio si genera `crypto.randomUUID()`, salvato in `localStorage` (try/catch) e mandato nell'header `X-Device-Token`.

### 1. Virus
"SECURITY ALERT: Matteo Passerini is trying to infect your device", con pulsanti ALLOW e DENY.
- **DENY** mostra `ERRORE 110: il rifiuto non è contemplato` (110 è il voto di laurea). A ogni tocco il pulsante DENY si rimpicciolisce (scala ×0.7) finché scompare, e resta solo ALLOW. Il messaggio può cambiare a ogni tocco (testi in `content.js`).
- **ALLOW** avvia il log finto da terminale e porta alla hall.

### 2. Hall
- Ringraziamento generale (`content.js`).
- Foto della proclamazione: 3–6 foto, galleria semplice.
- Campo **"Come ti chiama Matteo?"** a testo libero (max 30 caratteri) e pulsante "Chiedi l'accesso", che chiama `POST /api/join`.

### 3. Sala d'attesa
- Il soprannome inserito in grande e "Richiesta inviata. Matteo deve riconoscerti."
- Animazione: il satellite che cerca segnale.
- Polling di `/api/me` ogni 4 s, solo con la pagina visibile (`visibilitychange`).
- Se la richiesta viene **rifiutata**, compare "Matteo non ti riconosce con questo nome. Riprova" e si torna al campo.
- Se viene **accettata**, parte una piccola animazione di "segnale agganciato" e si passa alla missione.

### 4. Missione
- "Benvenuto, \<nome visualizzato\>", la missione in grande e "La giuria verificherà dal vivo."
- Nessun pulsante: l'ospite ha finito.
- Polling di `/api/me` ogni 60 s, solo con la pagina visibile, per il vincitore e per eventuali cambi di missione.

### 5. Vincitore
Quando `/api/me` restituisce `winner`, tutte le schermate dopo lo scherzo mostrano a tutto schermo: "Il vincitore è \<nome\>. Stasera dirige gli scherzi." Un'animazione celebrativa, una sola. Sotto, la propria missione rimpicciolita.

## Admin (`admin.html`)

Si usa **dal telefono di Matteo durante la festa**: azioni a un tocco, testo grande, niente tabelle.

- **Login**: password, che chiama `POST /api/admin/login` e riceve un token firmato HMAC (scadenza 12 h). Il token sta in `sessionStorage` e viene mandato come `Authorization: Bearer`.
- Polling di `GET /api/admin/state` ogni 4 s con la pagina visibile. Nel titolo della pagina va il numero di richieste in attesa, per esempio `(3) Admin`.
- **Richieste in attesa** (in cima): per ognuna il soprannome inserito e l'orario.
  - **Accetta**: apre un piccolo foglio con il nome visualizzato (precompilato e modificabile) e la missione proposta a caso tra quelle non ancora assegnate, cambiabile dal menu. Un tocco su "Conferma".
  - **Rifiuta**.
- **Ospiti accettati**: nome e missione, con le azioni "Cambia missione" e "Reset" (riporta l'ospite alla hall).
- **Vincitore**: scegli un ospite accettato, "Proclama", poi conferma ("Sei sicuro?"). Serve anche "Annulla vincitore".
- La stessa password funziona su più telefoni, così Matteo può delegare un amico.

## Backend (`worker/`)

### Schema D1 (`worker/schema.sql`)
```sql
CREATE TABLE missions (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL
);
CREATE TABLE guests (
  id INTEGER PRIMARY KEY,
  device_token TEXT NOT NULL UNIQUE,
  requested_name TEXT NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
  mission_id INTEGER REFERENCES missions(id),
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
-- settings: winner_guest_id
```

### API
Ospite (header `X-Device-Token`, validato come UUID):
- `GET  /api/me` → `{ status: 'new'|'pending'|'approved'|'rejected', requested_name, display_name, mission, winner }`
- `POST /api/join` `{ name }` → crea la richiesta, o la riapre come `pending` se era `rejected`. Al massimo 5 richieste per device (oltre: 429 con un messaggio).

Admin (`Authorization: Bearer`):
- `POST /api/admin/login` (5 tentativi falliti per IP ogni 15 min)
- `GET  /api/admin/state` → ospiti, missioni (con il flag "assegnata") e vincitore
- `POST /api/admin/guests/:id/approve` `{ display_name, mission_id }`
- `POST /api/admin/guests/:id/reject`
- `POST /api/admin/guests/:id/mission` `{ mission_id }`
- `POST /api/admin/guests/:id/reset`
- `POST /api/admin/winner` `{ guest_id | null }`

Regole:
- CORS consentito solo da `https://<username>.github.io`, più `http://localhost:*` per lo sviluppo.
- Ogni errore restituisce JSON `{ error: "<messaggio leggibile>" }` con lo status HTTP corretto.
- Approve e reject usano update condizionali (`WHERE status = 'pending'`).
- Secrets: `ADMIN_PASSWORD`, `SESSION_SECRET` (`wrangler secret put`).
- Le missioni si caricano con `seed.sql`. Per cambiarle si modifica il seed e lo si riesegue: niente CRUD nell'admin.

### Configurazione frontend
`config.js` esporta `API_BASE` (l'URL `*.workers.dev`). È l'unico punto in cui compare.

## Struttura

```
index.html  admin.html
style.css   app.js  admin.js
api.js      fetch con errori leggibili, polling solo a pagina visibile
config.js   API_BASE
content.js  testi (ringraziamento, errori DENY, log finto)
assets/img/ foto proclamazione, WebP ~1200px, < 250 KB ciascuna
worker/
  wrangler.toml
  schema.sql
  seed.sql
  reset.sql
  test.sh      test curl di tutti gli endpoint
  package.json wrangler come devDependency
  src/index.js
```

## Ordine di sviluppo

1. `worker/`: schema, seed ed endpoint. Test con `curl` su ogni endpoint, inclusi i casi di errore.
2. Deploy del Worker e `config.js`.
3. `index.html`: scherzo, hall, sala d'attesa, missione, vincitore.
4. `admin.html`.
5. Reset per i test: `?reset=1` su `index.html` svuota `localStorage`. Sul database, uno script `worker/reset.sql`.
6. Prova con 3 telefoni (iPhone, Android, admin): tag, virus, hall, richiesta, accetta/rifiuta, missione, vincitore.
7. Solo dopo, testi definitivi, foto e missioni vere.

## Missioni di esempio (`seed.sql`, da sostituire, almeno 30)

- Fai un brindisi in rima a Matteo che riguardi la sua tesi, il vostro rapporto e un ananas.          
- Spiega a Matteo la sua tesi senza usare le parole “internet”, “5G” o “telefono”.                
- Fai una foto con Matteo in cui entrambi state indicando qualcosa, ma senza dirgli cosa deve indicare.         
- Convinci qualcuno a chiamare Matteo “Ingegnere” almeno 3 volte durante la serata.         
- Fai partire un applauso per Matteo senza dire “applaudiamo Matteo” e senza essere tu il primo ad applaudire.          
- Fai indovinare a qualcuno l'argomento della tesi di Matteo usando esclusivamente gesti.         
- Trova 3 persone che abbiano conosciuto Matteo in periodi diversi della sua vita e fai raccontare a tutte e tre un ricordo su di lui.          
- Convinci qualcuno a fare un brindisi usando la frase “alla propagazione” senza spiegargli prima perché deve dirla.          
- Fai dire a Matteo una parola scelta dalla giuria senza pronunciarla tu e senza chiedergli direttamente di dirla.          
- Fai raccontare a qualcuno la prima impressione che ha avuto di Matteo e poi convinci un'altra persona a raccontare la propria.          
- Fai una foto di gruppo con almeno 5 persone, ma devi riuscire a farla proporre a qualcun altro.         
- Convincere due persone a scambiarsi un complimento reciproco senza dire loro che è una missione.          
- Fai raccontare a Matteo a qualcuno cosa ha fatto per la tesi, ma devi riuscire a far iniziare il discorso da Matteo.          
- Durante una conversazione, inserisci naturalmente le parole “satellite”, “pizza” e “laurea” nella stessa frase senza che nessuno ti chieda perché le hai dette.         
- Convinci qualcuno che “Digital Twin” sarebbe un ottimo nome per un cocktail e fagli proporre una ricetta.         
- Fai dire a qualcuno: “Questa cosa è molto da ingegnere” senza usare tu la parola “ingegnere”.         
- Trova qualcuno che non conosci benissimo e fatti raccontare una cosa che Matteo faceva spesso all'università. Non puoi chiedere direttamente “cosa faceva Matteo all'università?”.          
- Fai pronunciare a 3 persone diverse la parola “antenna” durante conversazioni separate.         
- Convinci qualcuno a fare una foto con Matteo usando una posa inventata da te, senza dirgli che l'hai inventata tu.          
- Fai raccontare a Matteo a qualcuno il significato di “Digital Twin” senza pronunciare tu né “Digital Twin” né “tesi”.         
- Riesci a far dire a Matteo “non è così semplice” durante una conversazione senza parlare di università, studio o lavoro.          
- Convinci due persone che non stanno parlando tra loro a scoprire di avere qualcosa in comune. Non puoi presentarle esplicitamente.          
- Fai fare a qualcuno un brindisi a Matteo utilizzando una metafora completamente assurda.          
- Fai cantare almeno una frase di una canzone a una persona che non sta cantando, senza iniziare tu a cantare.          
- Fai pronunciare a Matteo “finalmente” almeno due volte durante la serata, in due conversazioni diverse.         
- Convincere qualcuno a spiegare a un'altra persona, con parole sue, cosa pensa che Matteo abbia studiato per diventare ingegnere delle telecomunicazioni.          
- Fai in modo che almeno 4 persone dicano “Auguri Ingegnere!” contemporaneamente, senza dire direttamente a nessuno di farlo.         
- Trova una persona che conosce Matteo da molto tempo e convincila a raccontare davanti ad almeno altre due persone un episodio che Matteo probabilmente preferirebbe non fosse raccontato.         
- Missione finale: fai dire a Matteo “Questa è stata una bella idea” senza spiegargli mai che stai facendo una missione.          

## Note

- **Limiti del piano gratuito**: con 30 ospiti, il polling solo a pagina visibile e gli ospiti che smettono dopo la missione, il traffico è minimo. Verifica comunque i limiti attuali di Workers e D1.
- **I tag puntano a GitHub Pages**: il Worker è sostituibile senza riprogrammarli.
- **Telefono cambiato o browser pulito**: l'ospite rifà la richiesta, tu riconosci il nome e la riaccetti con la stessa missione.

## Sviluppo locale

```bash
cd worker && npm install
printf 'ADMIN_PASSWORD="test-pass"\nSESSION_SECRET="dev-secret"\n' > .dev.vars   # ignorato da git
npm run db:local          # schema + seed nel D1 locale
npm run dev               # Worker su http://localhost:8787
./test.sh                 # test curl di tutti gli endpoint (DB vuoto: wrangler d1 execute laurea --local --file=reset.sql)
# in un altro terminale, dalla radice del repo:
python3 -m http.server 5500     # http://localhost:5500/  e  /admin.html
```
`config.js` usa da solo `localhost:8787` quando la pagina è servita da localhost.

## Deploy (una volta)

```bash
cd worker
npx wrangler login
npx wrangler d1 create laurea          # copia il database_id in wrangler.toml
npm run db:remote                      # schema + seed (ripetibile: upsert per id)
npx wrangler secret put ADMIN_PASSWORD
openssl rand -base64 32 | npx wrangler secret put SESSION_SECRET
npm run deploy                         # stampa https://laurea-tag.<subdomain>.workers.dev
```
Poi metti quell'URL in `config.js` e pubblica il repo su GitHub Pages (branch `main`, cartella root).
Reset del DB remoto dopo le prove: `npx wrangler d1 execute laurea --remote --file=reset.sql`.

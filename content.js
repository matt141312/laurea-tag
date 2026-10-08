// Testi della pagina ospite. Modifica qui, non in app.js.

export const thanks = [
  // TODO: riscrivi con parole tue
  'Per ogni esame preparato in silenzio, ogni caffè, ogni “come va la tesi?” a cui ho risposto “quasi finita” per sei mesi. Questa laurea l\'avete costruita anche voi.',
  'Grazie di essere qui stasera.',
];
export const signature = 'Matteo';

// Facoltativo: se vuoto, la sezione non compare.
export const thesis = [
  'Ho costruito un gemello digitale di una rete 5G, interamente open source.',
  'Da una parte c\'è OpenAirInterface, una rete 5G vera fatta in software. Dall\'altra NVIDIA Sionna RT, che calcola come le onde radio rimbalzano su edifici e superfici di un luogo reale. Collegandole, il segnale che arriva al telefono simulato non è più un modello statistico: è quello che arriverebbe davvero lì, compreso l\'effetto Doppler di chi si muove.',
  'Il lavoro copre le bande 5G terrestri FR1 e FR2; il passo successivo sono i satelliti.',
  'Relatore Prof. Vanelli-Coralli, correlatore Matteo Sciacca. Tirocinio presso Qascom.',
];

export const footer = 'Sei arrivato qui avvicinando il telefono a un tag NFC da 144 byte nella bomboniera. Nessun dispositivo è stato infettato.';

// assets/img/, WebP ~1200px lato lungo, < 250 KB. Le foto mancanti vengono nascoste.
export const photos = [
  { src: 'assets/img/01.webp', alt: 'Proclamazione' },
  { src: 'assets/img/02.webp', alt: 'Con la famiglia' },
  { src: 'assets/img/03.webp', alt: 'Con gli amici' },
  { src: 'assets/img/04.webp', alt: 'In laboratorio' },
  { src: 'assets/img/05.webp', alt: 'La corona d\'alloro' },
];

// Un messaggio per ogni tocco su DENY (poi si ricomincia dall'ultimo).
export const denyMessages = [
  'ERRORE 110: il rifiuto non è contemplato.',
  'ERRORE 110: insistere non migliora il voto.',
  'ERRORE 110: la commissione ha già deciso.',
  'ERRORE 110: DENY in esaurimento.',
  'ERRORE 110: ultimo avviso.',
];

export const logAllow = [
  '> Permesso concesso. Scelta saggia.',
  '> Aggancio alla cella 5G NR ... ok',
  '> Allineamento col satellite ... ok',
  '> Installazione gratitudine.exe ... 100%',
  '> Fatto. Benvenuto.',
];

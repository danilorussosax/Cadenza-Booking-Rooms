# Piano di debug — release 1.20

Data: 10 ottobre 2026. Baseline: `89920406560a179fe322f7603f2816f39ff558b9`. Versione dichiarata nei package principali: `1.18.0`; `1.20` è la release obiettivo, non una versione già implementata.

## Mandato e metodo

Analisi del codice senza correzioni applicative. Questo documento è l'unico file aggiunto al repository. Le cancellazioni preesistenti di `.serena/.gitignore` e `.serena/project.yml` non fanno parte del lavoro e sono lasciate intatte. Nessun commit, deploy, aggiornamento dipendenze, seed, migrazione o accesso ai dati di produzione.

Revisione statica trasversale dei flussi e dei loro punti di integrazione: autenticazione, prenotazioni, waitlist, prestiti, Monte Ore, dati personali, messaggistica, backup, SPA/PWA, configurazione e test. Inventario: 40 file route, 58 file servizi e 45 file modelli backend; 209 file sorgente frontend; 113 file nell'albero test backend, 35 frontend e 15 E2E separati. Questi sono conteggi dell'inventario, **non una dichiarazione di lettura integrale riga per riga**. L'approfondimento manuale si concentra sui percorsi descritti nei rilievi; lint copre il proprio scope configurato e TypeScript copre app e configurazione Vite.

Classificazione:

- **P1**: da risolvere prima della release per autorizzazioni, riservatezza, integrità dati o recuperabilità.
- **P2**: difetto funzionale o affidabilità; pianificare nella 1.20.
- **P3**: osservabilità, localizzazione e allineamento documentale.
- **Confermato staticamente**: il percorso errato è visibile nel codice; non significa riprodotto su un server.
- **Rischio di concorrenza**: interleaving plausibile documentato; da riprodurre su PostgreSQL/cluster isolati.
- **Da validare**: dipende dalla configurazione o da una decisione di prodotto.

Le indicazioni sui dati personali sono rilievi tecnici, non una valutazione legale di conformità.

## Verifiche eseguite

Ambiente locale: Node `v24.15.0`.

| Verifica                                                                                       | Esito                                                                      |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `npm run lint`                                                                                 | Exit 0; nessun errore o warning stampato                                   |
| `./frontend/node_modules/.bin/tsc -p frontend/tsconfig.app.json --noEmit --incremental false`  | Exit 0                                                                     |
| `./frontend/node_modules/.bin/tsc -p frontend/tsconfig.node.json --noEmit --incremental false` | Exit 0                                                                     |
| Confronto ricorsivo delle chiavi JSON i18n                                                     | 20 chiavi italiane assenti in inglese; 94 per spagnolo, tedesco e francese |
| Incrocio route SPA, link email e chiamanti API                                                 | Difetti documentati sotto                                                  |
| Lettura test e CI                                                                              | Individuati buchi nelle asserzioni e differenze rispetto ad AGENTS.md      |

Non eseguiti test unitari/integrativi, E2E, build, coverage, load test, restore o chiamate ai provider: il mandato richiede solo analisi del codice. Nessuna affermazione di successo runtime deriva da questa revisione. I log diagnostici temporanei sono `/tmp/cadenza-1.20-lint.log`, `/tmp/cadenza-1.20-types.log` e `/tmp/cadenza-1.20-config-types.log`.

## Rilievi prioritari

### D01 — P1 — Cache dei dati personali condivisa tra sessioni

**Stato:** confermato staticamente.

**Evidenza:** `frontend/src/main.tsx:37` crea un unico QueryClient, esterno all'AuthProvider, con staleTime di 30 secondi. `frontend/src/contexts/AuthContext.tsx:153` e `:170` puliscono storage e stato auth, ma non cancellano query/in-flight. `frontend/src/pages/MyLoans.tsx:36`, `frontend/src/pages/MonteOre.tsx:95` e `frontend/src/components/bookings/WaitlistDashboardCard.tsx:41` usano chiavi personali senza userId.

**Scenario:** A visualizza i prestiti, esce; B accede nello stesso tab prima della scadenza della cache. La query `['loans', 'mine']` può restituire i dati di A; anche una cache stale può mostrarli durante il refetch. Un 401 tardivo di A può inoltre invalidare la nuova sessione, perché `frontend/src/lib/api.ts` non associa l'evento al token della richiesta.

**Intervento proposto:** isolamento della cache per identità/sessione, cancellazione delle richieste precedenti e gestione dei 401 legata alla sessione che li ha generati.

**Accettazione:** passaggio A→logout→B senza reload, con rete rallentata: nessun dato di A visibile e nessuna risposta tardiva capace di disconnettere B.

### D02 — P1 — Cambio aula che evita l'approvazione

**Stato:** confermato staticamente.

**Evidenza:** creazione standard in `backend/routes/bookings.js:406` calcola `pending_approval` da `room.requiresApproval`. La modifica `PUT /:id`, da `:864`, accetta `roomId`, valida e aggiorna i campi a `:936`, conservando `confirmed`. `bookingValidator.js` non applica la transizione di approvazione.

**Scenario:** un utente crea una prenotazione in aula libera da approvazione e la sposta in un'aula che richiede autorizzazione. Resta confermata senza revisione.

**Intervento/accettazione:** una modifica che cambia aula o altri dati soggetti ad approvazione deve applicare la policy concordata; test negativo con utente ordinario e aula protetta, positivo con admin. Verificare anche utenti diventati non approvati dopo la creazione: il PUT usa solo `authenticate`.

### D03 — P1 — Claim waitlist sempre confermato

**Stato:** confermato staticamente.

**Evidenza:** `backend/routes/waitlist.js:210` crea sempre `status: 'confirmed'`; non considera `Room.requiresApproval`, diversamente dalla creazione standard.

**Scenario:** l'utente si mette in coda per un'aula soggetta ad approvazione, poi riscatta lo slot liberato. Ottiene una conferma diretta.

**Intervento/accettazione:** condividere la policy di creazione tra API, waitlist, ricorrenze e bot; il claim di un utente non admin deve produrre lo stato previsto dalla policy e le relative notifiche.

### D04 — P2 — Link email waitlist senza pagina di destinazione

**Stato:** confermato staticamente.

**Evidenza:** `backend/services/waitlistService.js:96` emette `/waitlist/claim/:id`; il template `backend/services/mailTemplateDefaults.js:187` lo usa come CTA. `frontend/src/App.tsx` non registra questa route e termina con NotFound. Il riscatto esiste soltanto nella card della dashboard/API.

**Intervento/accettazione:** definire la destinazione navigabile e preservarla attraverso il login; E2E che segue il link effettivo della mail, con sessione presente e assente, quindi esegue il claim. L'attuale `e2e/tests/waitlist-claim.spec.ts` chiama l'API e non copre il link.

### D05 — P2 — Rinuncia alla waitlist blocca la promozione e non è idempotente

**Stato:** confermato staticamente.

**Evidenza:** DELETE in `backend/routes/waitlist.js:257` imposta `cancelledAt` e decrementa le posizioni senza controllare che l'entry sia già cancellata/riscattata e senza chiamare `notifyNextOnSlot`. `cleanupExpired` in `backend/services/waitlistService.js` seleziona solo `cancelledAt: null`.

**Scenario:** il primo notificato rinuncia: il successivo non viene promosso neppure alla scadenza dell'entry cancellata. Ripetere DELETE della stessa entry applica di nuovo il decremento ai successori, alterando l'ordine.

**Intervento/accettazione:** transizione condizionata e promozione dopo commit; DELETE ripetute non cambiano più le posizioni e una rinuncia promuove una sola persona eleggibile.

### D06 — P2 — Cancellazioni massive senza notifica waitlist

**Stato:** confermato staticamente.

**Evidenza:** `backend/routes/bookings.js:604` usa `Booking.update` massivo senza `individualHooks`; `backend/routes/gdpr.js:240` fa altrettanto. La promozione è legata agli hook di istanza `Booking.afterUpdate`/`afterDestroy` in `backend/models/index.js:255` e `:267`, non a un hook bulk.

**Intervento/accettazione:** enumerare gli slot liberati e notificare dopo commit anche per i percorsi bulk. Confrontare cancellazione singola, bulk admin e cancellazione account: stessa disponibilità e stessa promozione, nessuna email su rollback.

### D07 — P1 — Quote prestiti fuori dalla transazione di creazione

**Stato:** omissione confermata; impatto concorrente da riprodurre.

**Evidenza:** `backend/routes/instrumentLoans.js:218` chiama `checkLoanQuotas` senza `transaction: t`, pur trovandosi nel callback SERIALIZABLE. `backend/services/loanQuotaValidator.js` accetta `transaction` e la applica alle query soltanto se passata. Non è presente configurazione `useCLS` nei sorgenti backend.

**Scenario:** due richieste dello stesso utente su strumenti diversi leggono il medesimo conteggio esterno alla transazione e superano il limite globale. L'anti-overlap sul singolo strumento non garantisce la quota utente.

**Intervento/accettazione:** letture della quota e scrittura devono appartenere alla stessa unità transazionale, con retry coerente. Su PostgreSQL con quota 1, due richieste concorrenti su strumenti diversi devono produrre un solo prestito ammissibile.

### D08 — P1 — Cancellazione prestito concorrente con approvazione

**Stato:** rischio di concorrenza.

**Evidenza:** DELETE in `backend/routes/instrumentLoans.js` legge l'istanza, controlla `status === 'requested'`, poi esegue `loan.destroy()` a `:358`. Il controllo dello stato non fa parte della scrittura. Approve utilizza invece un UPDATE condizionato.

**Scenario:** lo studente legge requested; l'admin approva; il destroy dello studente elimina logicamente il prestito ormai attivo.

**Intervento/accettazione:** lock/transizione condizionata, con stato e proprietà verificati nell'operazione atomica. In una corsa approve/delete non deve sparire un prestito attivo per azione di un utente privo del permesso.

### D09 — P1 — Cancellazione account usa un valore enum inesistente

**Stato:** confermato staticamente; verificare l'errore sul DB PostgreSQL isolato.

**Evidenza:** `backend/routes/gdpr.js:246` filtra `status: ['confirmed', 'pending']`. Il modello `backend/models/Booking.js` ammette `pending_approval`, non `pending`.

**Impatto:** SQLite non trova le prenotazioni in attesa e le lascia attive. Con il tipo ENUM PostgreSQL coerente con il modello, il confronto con `pending` può fallire con invalid input value for enum e annullare l'intera transazione di cancellazione.

**Intervento/accettazione:** eliminare la divergenza dei valori di stato; test con utente non admin e prenotazioni confirmed + pending_approval su entrambi i dialect, controllando anonimizzazione, cancellazione e risultato HTTP.

### D10 — P2 — Export prestiti privo delle date

**Stato:** confermato staticamente.

**Evidenza:** `backend/routes/gdpr.js:135` legge `l.startDate`/`l.endDate`; `backend/models/InstrumentLoan.js` definisce `fromDate`/`toDate`. JSON.stringify omette i valori undefined.

**Intervento/accettazione:** mappatura esplicita dei campi e test di contenuto con un prestito reale. L'attuale E2E export verifica che `instrumentLoans` sia un array, non che contenga le date corrette. Valutare separatamente la completezza dell'export: Monte Ore, waitlist, binding/chat e record soft-deleted non vengono esportati; audit limitato a 500 righe senza indicatore di troncamento.

### D11 — P1 — Foto profilo non rimossa dalla cancellazione account

**Stato:** confermato staticamente.

**Evidenza:** `backend/routes/gdpr.js:225` azzera `profilePhotoUrl` senza eliminare il file. Al contrario `backend/routes/auth.js:488` usa `tryDeleteOldPhoto` nella rimozione esplicita. `backend/app.js:265` serve pubblicamente `/storage`; Vite configura inoltre cache immagini di sette giorni.

**Scenario:** chi conserva l'URL può continuare a recuperare la foto dal server dopo la cancellazione dell'account. Azzerando il riferimento senza una coda di cleanup si perde anche l'associazione utile alla rimozione.

**Intervento/accettazione:** cleanup del file coordinato con il commit, verifiche su cache e inventario delle altre copie di dati. L'URL originario deve restituire assenza del file sul server dopo la conclusione del processo; trattare separatamente copie già scaricate e backup.

### D12 — P1 — Token pre-2FA non revocato dal cambio password/logout

**Stato:** confermato staticamente.

**Evidenza:** `backend/services/twoFa.js:137` firma soltanto `{ id, tfa: 'pre' }`, con TTL cinque minuti. `backend/routes/auth.js:690` verifica il token e carica l'utente, senza confrontare una versione della sessione; a `:743` firma il JWT usando la versione corrente. Cambio/reset password e logout incrementano `tokenVersion`, ma il token temporaneo non la contiene.

**Scenario:** ottenere tempToken, revocare le sessioni/cambiare password, completare entro il TTL con OTP o recovery valido: viene emesso un JWT nuovo nonostante la revoca. Il token temporaneo da solo non basta: resta necessario il secondo fattore.

**Intervento/accettazione:** legare challenge e tempToken a una versione/nonce revocabile. Dopo cambio password o logout il vecchio flusso pre-2FA deve fallire anche con OTP corretto. Controllare inoltre `isActive` prima dell'emissione: oggi l'API può emettere un JWT per un utente disabilitato, poi rifiutato da authenticate.

### D13 — P1 — OTP/recovery consumati senza atomicità

**Stato:** rischio di concorrenza.

**Evidenza:** `backend/routes/auth.js:699` legge User, confronta OTP/recovery e salva a `:743` senza lock, transazione o confronto condizionato. `twoFa.consumeChallenge` opera sull'oggetto letto. Due richieste possono verificare lo stesso valore prima che una lo cancelli; analogamente gli incrementi attempts possono sovrascriversi.

**Intervento/accettazione:** serializzare o consumare condizionalmente challenge/recovery, comprese verify, disable e recovery regeneration. Due verify simultanee dello stesso codice devono emettere al massimo una sessione; i tentativi errati concorrenti devono essere tutti conteggiati.

### D14 — P1 — Reset password e consumo token separati

**Stato:** confermato staticamente; race da riprodurre.

**Evidenza:** `backend/routes/auth.js:1133` legge il token non usato, aggiorna User e poi salva `row.usedAt` in una seconda operazione, senza transazione o lock.

**Scenario:** due reset concorrenti passano entrambi il controllo; l'ultimo modifica la password. Un errore nel salvataggio di usedAt lascia invece un token riutilizzabile dopo che la password è già cambiata.

**Intervento/accettazione:** consumo token, password e revoca sessioni in un'unica transazione con controllo atomico del token; un solo successo concorrente e nessuno stato parziale su fault injection.

### D15 — P1 — Sospensione Monte Ore modificata senza aggiornare la regola collegata

**Stato:** confermato staticamente.

**Evidenza:** `backend/routes/monteOre.js:1710` crea una BookingRuleException con date della sospensione e salva `bookingRuleExceptionId`. PATCH a `:1749` aggiorna soltanto MonteOreSuspension; non modifica la regola collegata. La DELETE considera invece esplicitamente il collegamento.

**Scenario:** spostare una sospensione dal giorno X al giorno Y. Il calendario Monte Ore usa Y, mentre la validazione delle prenotazioni ordinarie continua a bloccare X e non necessariamente Y.

**Intervento/accettazione:** aggiornamento atomico delle due rappresentazioni e dei relativi impatti; una modifica date deve dare risultati concordi in griglia, preview e API di prenotazione.

### D16 — P2 — Rimozione/riduzione sospensioni lascia slot bloccati

**Stato:** confermato staticamente.

**Evidenza:** `backend/services/monteOreCalendarUpdateService.js:19` considera solo slot attivi e, a `:61`, li rende inattivi e locked. DELETE sospensione/sessione esami in `backend/routes/monteOre.js:1284` e `:1770` distrugge la sospensione senza riconciliare gli slot. Ridurre l'intervallo non rivaluta quelli già inattivi. `validateCalendar` rifiuta comunque slot con `isLocked`.

**Impatto:** il calendario viene riaperto, ma i piani già coinvolti possono mantenere giorni non selezionabili finché non si esegue una rigenerazione/altro percorso amministrativo.

**Intervento/accettazione:** distinguere sblocco delle date e riattivazione delle lezioni, che richiede una decisione esplicita. Test aggiunta→spostamento→riduzione→rimozione sospensione su draft e generated; non riattivare automaticamente booking cancellati.

### D17 — P1 — Restore non coordinato con il cluster e non atomico su PostgreSQL

**Stato:** rischi strutturali confermati dal codice; prova distruttiva non eseguita.

**Evidenza:** `ecosystem.config.js` avvia tre worker. `backend/services/backupRestore.js:48` usa un booleano locale al processo; il restore non sospende globalmente scritture e scheduler. `backend/routes/backups.js:323` riavvia il solo PID che riceve la richiesta. Psql è invocato con `ON_ERROR_STOP=1`, ma senza transazione unica; un errore a metà dump non annulla automaticamente le istruzioni precedenti.

**Impatto:** restore concorrenti su worker diversi, traffico durante sostituzione dati, stato parzialmente ripristinato su errore, riavvio incompleto. Il backup preventivo è utile, ma non rende atomica l'operazione.

**Intervento/accettazione:** procedura di manutenzione e lock condiviso per l'intero ciclo, sospensione di tutti gli scrittori, restore validato, rollback e restart coordinato. Prove soltanto su clone sacrificabile con dump guasto, due richieste concorrenti e traffico in-flight.

### D18 — P1 — Restore SQLite ignora DB_STORAGE

**Stato:** confermato staticamente, condizionato all'uso di un path personalizzato.

**Evidenza:** `backend/config/database.js` usa `process.env.DB_STORAGE`; backupSqlite esegue VACUUM sulla connessione effettiva. `backend/services/backupRestore.js:246` ripristina sempre `backend/data/conservatory.sqlite`.

**Scenario:** installazione con DB_STORAGE personalizzato: restore restituisce successo, ma l'app continua a usare il database originale. Il servizio mantiene inoltre aperta la connessione durante la sostituzione e non coordina i sidecar WAL/SHM.

**Intervento/accettazione:** destinazione derivata dalla configurazione effettiva, chiusura delle connessioni e gestione dei file SQLite coerente. Test con path non standard e WAL attivo, verificando i dati dopo riavvio.

### D19 — P1 — Prenotazioni bot prive della garanzia transazionale della API

**Stato:** rischio di concorrenza.

**Evidenza:** `backend/services/messaging/intent.js:742` valida e `:783` crea la prenotazione in operazioni separate. `backend/services/messaging/index.js` serializza chat con una Map in memoria, quindi soltanto nel singolo worker. La normale API utilizza invece withSerializableRetry.

**Scenario:** bot e UI dello stesso utente prenotano aule diverse contemporaneamente: il vincolo EXCLUDE per aula non protegge quota utente e conflitto cross-aula. Webhook della stessa chat possono inoltre sovrascrivere lo stato se serviti da worker diversi.

**Intervento/accettazione:** servizio di scrittura condiviso e serializzazione/idempotenza distribuita delle chat; test bot+UI su PostgreSQL e due processi. Il controllo `requiresApproval` è presente nel bot e va preservato.

### D20 — P2 — Immagini caricate non raggiungibili nel dev server Vite

**Stato:** confermato staticamente nella configurazione standard.

**Evidenza:** `frontend/vite.config.ts:160` inoltra solo `/api`; le foto restituite dal backend sono URL relativi `/storage/...`, serviti da `backend/app.js:265`.

**Scenario:** SPA su :5173 e backend su :3000: l'upload riesce, ma img richiede `/storage` a Vite e non al backend. Produzione con stessa origine non presenta questa specifica divergenza.

**Intervento/accettazione:** rendere raggiungibili le risorse anche in sviluppo; verificare foto profilo, aule, strumenti e locandine nella topologia a due porte.

### D21 — P2 — Errore OAuth reindirizzato a login.html inesistente

**Stato:** confermato staticamente.

**Evidenza:** `backend/routes/auth.js:898` e `:901` inviano gli errori OAuth a `/login.html`; la SPA registra `/login`, non `/login.html`, e non è presente un file login.html in frontend/public.

**Intervento/accettazione:** allineare callback di errore e route frontend, mantenendo codice/messaggio. Test accesso OAuth negato, dominio non consentito e errore provider: deve apparire il login con errore, non NotFound.

### D22 — P2 — Guasto di rete interpretato come logout; callback può restare loading

**Stato:** confermato staticamente.

**Evidenza:** `frontend/src/contexts/AuthContext.tsx:84` cancella il token su qualunque errore di /me, inclusi offline/5xx. `setSessionToken` a `:135` imposta loading prima di /me senza cleanup nel ramo di errore. `backend/middleware/auth.js` converte inoltre in 401 anche errori DB catturati nel proprio try.

**Impatto:** un problema temporaneo infrastrutturale disconnette gli utenti. In callback OAuth un 5xx/rete può lasciare loading=true anche dopo la visualizzazione dell'errore, bloccando la pagina login protetta da PublicOnlyRoute.

**Intervento/accettazione:** separare credenziali invalide da indisponibilità e gestire sempre il termine del caricamento; fault test offline, 503 e errore DB, verificando anche il retry.

### D23 — P3 — Logger integrazioni importato in modo errato

**Stato:** confermato staticamente.

**Evidenza:** `backend/routes/integrations.js:13` usa `const { logger } = require('../lib/logger')`; `backend/lib/logger.js:151` esporta direttamente logger. Le chiamate `logger?.info?.`, `warn` ed `error` saltano silenziosamente i log.

**Intervento/accettazione:** allineare import/export e verificare che successi e fallimenti di apply producano eventi strutturati con contesto, senza registrare segreti o interi dataset personali.

### D24 — P3 — Localizzazioni incomplete

**Stato:** confermato dal confronto statico JSON.

**Evidenza:** `frontend/src/i18n/locales/it.json` contiene 1.873 chiavi foglia. Rispetto all'italiano mancano 20 chiavi in en e 94 in ciascuno di es/de/fr. Esempi: `auth.login.resend_setup_link`, `integrations.esse3.title`; es/de/fr mancano anche parti di `admin.ops`. I totali delle altre lingue possono comprendere chiavi extra, quindi non basta confrontare le sole dimensioni dei file.

**Intervento/accettazione:** inventario delle chiavi mancanti, traduzioni e controllo delle interpolazioni. Nessun fallback italiano inatteso nei flussi di login, import e operazioni delle quattro lingue secondarie.

## Incongruenze e verifiche aggiuntive

Questi punti non sono automaticamente equivalenti a un bug riprodotto e vanno tracciati separatamente dai D01–D24.

| ID / priorità        | Evidenza e valutazione                                                                                                                                                                                                                                                   | Verifica richiesta                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C01 / P2             | `backend/middleware/rateLimit.js` non configura uno store distribuito; la libreria installata usa MemoryStore come default. Con tre istanze, limiti IP/login sono per processo. Il lockout account offre una protezione distinta, non corregge il conteggio distribuito. | Test su tre worker e scelta di uno store condiviso o limite al proxy; documentare la soglia realmente garantita.                                                                                             |
| C02 / P2             | `/api/ready` in `backend/app.js:389` attende verify SMTP; il problema è definito non critico, ma non esiste un timeout breve applicativo. Il curl del deploy non specifica un tempo massimo.                                                                             | Simulare SMTP che non risponde: readiness DB e deploy devono concludersi entro un budget noto.                                                                                                               |
| C03 / P1 da decidere | Callback Google/Microsoft in `backend/routes/auth.js:909` e `:936` emettono direttamente JWT anche se twoFaEnabled. Non si vede verifica di attestazione MFA del provider.                                                                                               | Definire se OAuth debba soddisfare o saltare il secondo fattore locale. Se deve soddisfarlo, trattare il bypass come blocco release e coprire entrambi i provider.                                           |
| C04 / P2             | MonteOreSettings ha UNIQUE(instituteId, academicYear), ma `monteOreWorkflowService.loadPlan` cerca settings/sospensioni solo per anno; User non ha instituteId.                                                                                                          | Chiarire se l'installazione è deliberatamente mono-istituto; altrimenti provare due calendari nello stesso anno e progettare lo scope della proposta.                                                        |
| C05 / P2             | notifyNextOnSlot verifica disponibilità sull'intervallo della prenotazione cancellata e poi sceglie una richiesta sovrapposta, non verifica l'intero intervallo del candidato. Inoltre check+update della notifica non è atomico.                                        | Coda 10–12, cancellazione 10–11 e altra booking 11–12: non inviare una disponibilità impossibile. Verificare callback concorrenti e finestre di claim già aperte.                                            |
| C06 / P2             | maxDaysPerYear in `loanQuotaValidator.js` filtra `fromDate >= yearAgo` senza clipping dell'intervallo; il commento parla di intersezione. maxConcurrent conta anche richieste future non sovrapposte.                                                                    | Definire la semantica di quota annuale e contemporaneità; test prestito iniziato prima del limite annuale e prestiti futuri disgiunti.                                                                       |
| C07 / P2             | `emailService.loadConfig` sostituisce il transporter a TTL scaduto; solo invalidateCache chiude esplicitamente il vecchio pool.                                                                                                                                          | Soak SMTP in ambiente isolato: controllare connessioni/file descriptor e chiusura del transporter precedente.                                                                                                |
| C08 / P3             | Pagina `frontend/src/pages/Announcements.tsx` e card AnnouncementsCard esistono, ma la pagina non è registrata in App e la card non risulta montata nei sorgenti.                                                                                                        | Confermare se il feed personale è stato ritirato intenzionalmente; se ancora previsto, completarne la navigazione e i test. Non è stata osservata una card visibile rotta.                                   |
| C09 / P2             | Engine dichiarati: root >=20, backend >=18. I lockfile richiedono sqlite3 >=20.17, Vite ^20.19 o >=22.12, ESLint ^20.19 o ^22.13 o >=24.                                                                                                                                 | Allineare contratto runtime e installer alle dipendenze bloccate; CI usa Node 20 aggiornato ma non verifica il minimo dichiarato. Nessun guasto dedotto per la VPS, la cui versione non è stata controllata. |
| C10 / P3             | AGENTS.md descrive quattro job e format:check come gate; ci.yml contiene anche E2E, ma nessuno step format:check. SQLite effettivo: backend/data/conservatory.sqlite, diverso dal path documentato.                                                                      | Correggere documentazione e decidere il gate di formattazione. Root npm run e2e avvia solo la suite frontend; la suite e2e separata richiede il proprio comando.                                             |
| C11 / P2             | `deepCoverageBatch.test.js:377` accetta anche 400/429 per un test intitolato export 200; delete-request usa un admin e accetta molti esiti. Coverage alta non prova il flusso non-admin.                                                                                 | Asserzioni deterministiche, fixture non-admin e verifica dati finali, soprattutto su PostgreSQL per D09.                                                                                                     |

## Piano operativo della release

Il piano seguente è stato eseguito su autorizzazione successiva dell’utente. Stato, decisioni, test e limiti operativi sono riportati in [ESITO_DEBUG_RELEASE_1.20.md](ESITO_DEBUG_RELEASE_1.20.md). I rilievi sopra descrivono il codice al momento dell’analisi iniziale.

### Fase A — Sessioni, autorizzazioni e operazioni monouso

- [x] D01: isolare sessione, cache e richieste in-flight.
- [x] D02–D03: unificare la policy di approvazione nelle diverse operazioni di booking.
- [x] D12–D14: rendere revoca e consumo di OTP/reset coerenti e atomici.
- [x] Decidere C03 e verificare C01; completare D22 insieme alla gestione sessioni.
- [x] Test di accettazione: cambio account rapido, 401 tardivo, approval bypass, doppio consumo, revoca durante pre-2FA, indisponibilità DB/rete.

### Fase B — Integrità dei dati e recupero

- [x] D07–D08, D19: portare quote, stato prestito e prenotazioni bot dentro operazioni atomiche condivise.
- [x] D09–D11: correggere stato, mappatura export e cleanup foto; inventariare i dati mantenuti nelle tabelle correlate.
- [x] D17–D18: rendere il restore esclusivo e verificabile per PostgreSQL cluster e SQLite custom/WAL.
- [x] Test di accettazione su DB dedicati; nessun restore su produzione durante il debug.

### Fase C — Monte Ore e waitlist

- [x] D15–D16: sincronizzare sospensioni, regole ordinarie e lock degli slot, preservando audit e decisioni amministrative.
- [x] D04–D06: completare link email, idempotenza, rinuncia e dispatch bulk dopo commit.
- [x] C04–C06: chiarire scope istituto e quote; verificare disponibilità completa e concorrenza della coda.
- [x] Regressione su piani draft/submitted/generated, giorni passati/check-in, riduzione o cancellazione di sospensioni e conflitti di aula.

### Fase D — Esperienza utente, osservabilità e distribuzione

- [x] D20–D21: allineare risorse dev e route OAuth.
- [x] D23–D24: ripristinare log integrazioni e completare localizzazioni.
- [x] C02, C07–C11: readiness, SMTP, feed annunci, runtime supportato, documentazione e test meno permissivi.
- [x] Verificare PWA dopo cambio account, aggiornamento di release e cancellazione immagini: la cache delle API personali non deve essere introdotta per risolvere altri difetti.

## Matrice di regressione proposta

| Area           | Scenari minimi                                                                                                | Ambiente                     |
| -------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Auth           | credenziali, pre-2FA, recovery, reset, logout, token revocato, OAuth errore/successo, account disabilitato    | API isolate + browser        |
| Sessioni       | A→B nello stesso tab, due tab, rete offline, 503, risposta tardiva                                            | E2E browser                  |
| Booking        | creazione/modifica/ricorrenze/claim/bot con e senza approvazione; cross-aula; quote                           | SQLite + PostgreSQL          |
| Waitlist       | email→login→claim, rinuncia, DELETE ripetuta, bulk cancel, slot parzialmente occupato, due callback           | API + E2E + cluster          |
| Prestiti       | richieste su strumenti diversi, quota globale, approve/delete simultanei, export date                         | PostgreSQL concorrente       |
| Monte Ore      | pattern→slot→approvazione→booking; amendment; sospensione spostata/ridotta/rimossa; verifica passato/check-in | API + E2E, Europe/Rome e UTC |
| Dati personali | export valorizzato, cancellazione non-admin, pending_approval, foto, dati correlati                           | PostgreSQL + storage isolato |
| Import         | preview/apply, hash/token scaduto, errori parziali, audit/log, ripetizione richiesta                          | Dataset sintetici            |
| Backup         | custom path, WAL, dump guasto, concorrenza, riavvio tutti i worker, verifica contenuto ripristinato           | Clone sacrificabile          |
| UI/PWA         | immagini :5173, callback OAuth errore, cache tra utenti, aggiornamento SW, cinque lingue                      | Browser desktop/mobile       |
| Esercizio      | timeout readiness, failover scheduler, lease lungo, SMTP lento, limiti per cluster                            | Staging isolato              |

## Criteri di uscita

1. Tutti i P1 D01–D24 chiusi con una prova mirata o con una decisione esplicita e documentata sul relativo rischio; la sola esecuzione del lint non basta.
2. C03 deciso prima di approvare il comportamento 2FA/OAuth; C04 deciso prima di dichiarare supporto multi-istituto.
3. Regressione backend nei due fusi, casi PostgreSQL pertinenti, suite frontend ed entrambe le suite E2E pertinenti completate dopo le correzioni.
4. Build verificata con il runtime scelto per la release; nessuna dipendenza da asset generati da sorgenti diversi dal commit di rilascio. Verificare anche il percorso deploy --no-build, che copia la dist locale e può divergere dal ref archiviato.
5. Ripristino provato su clone sacrificabile prima di fare affidamento sul backup come piano di rollback.
6. Aggiornamento coerente della versione a 1.20 solo nell'attività di implementazione/rilascio, con changelog dei fix effettivamente verificati.

## Limiti e prossime analisi

Il piano non certifica assenza di altri bug. Restano da approfondire dinamicamente provider OAuth/Graph, SMTP e adapter esterni, PgBouncer, reverse proxy effettivo, hardware/browser kiosk, prestazioni e accessibilità. Non sono state interrogate risorse esterne né verificate vulnerabilità delle dipendenze su advisory aggiornati. I casi concorrenti e gli effetti PostgreSQL descritti richiedono conferma su fixture isolate; quelli condizionati alla configurazione non sono affermazioni sullo stato della produzione.

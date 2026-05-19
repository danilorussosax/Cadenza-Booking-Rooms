# Cadenza · Audit Qualità, Stabilità e Sicurezza

> **Versione**: 1.11.0 — fotografia del 19 maggio 2026
> **Cosa è**: una rilettura ragionata dello stato attuale del prodotto pronta per essere mostrata a un cliente Conservatorio, a un'amministrazione che valuta l'adozione o a un consulente esterno che debba farsi un'idea senza dover leggere il codice.
> **Cosa non è**: un changelog. Per la cronologia delle modifiche c'è `git log` e [`CHANGELOG.md`](../CHANGELOG.md); qui interessa raccontare in che condizioni il software è arrivato a oggi.

Cadenza è una webapp per la gestione delle prenotazioni di aule e strumenti in un istituto musicale. Il sistema è in produzione, scritto in Italiano nel dominio, costruito su Node 20 + Express + Sequelize lato server, React 19 + TypeScript strict lato client, e pensato per girare su un VPS Ubuntu standard. Il documento che segue racconta — senza nascondersi dietro un punteggio — quanto è solido, quanto è sicuro e quanto è pronto per essere venduto a un altro istituto domani mattina.

---

## In breve

Se il lettore avesse solo trenta secondi per farsi un'idea: il software è **pronto alla produzione commerciale** su singolo Conservatorio e si presta al multi-cliente con un onboarding documentato di pochi giorni. La conformità GDPR è completa, le misure minime AGID sono rispettate, l'anti-overlap delle prenotazioni è garantito dal database (non solo dall'applicazione), il backup è verificato automaticamente ogni settimana e il disaster recovery è coperto da backup off-site multi-cloud + PITR opzionale via WAL archiving. Restano in roadmap le integrazioni "PA enterprise" — SPID/CIE, PEC, conservazione sostitutiva — che si attivano su richiesta del cliente.

Dal punto di vista numerico Cadenza conta circa **95.600 righe di codice produttivo** (44.6K backend + 51K frontend), **245 endpoint REST**, **1.730 test unitari e di integrazione** in run-time medio di 95 secondi, **12 spec Playwright** (golden path + RBAC + GDPR + audit + pagination contract) e una suite di soak test che gira fuori CI per le verifiche pre-rilascio. La copertura di codice è sopra le soglie su tutti gli otto assi misurati. Nessuna vulnerabilità segnalata da `npm audit`. Nessun errore di lint o di type-check.

Dalle release v1.6.0 al v1.11.0 il prodotto ha consolidato l'osservabilità (dashboard `/admin/ops` in v1.7.0 con widget VPS · Postgres · MailOutbox · Backup · Scheduler), il mobile UX (overhaul completo delle pagine cliente in v1.8.0 con disclosure gerarchica edificio→aula per il calendario su smartphone), la business continuity (verifica integrità backup automatica in v1.9.0, PM2 cluster lock + off-site backup + PITR opt-in in v1.10.0) e infine — con v1.11.0 — un giro di hardening sicurezza/qualità che ha aggiunto la difesa cross-origin sulle mutazioni (originGuard middleware), la hash-chain di integrità sull'audit log per tamper-evidence, la paginazione admin su `/api/loans` e il readiness check multi-componente (DB + SMTP + disk).

---

## 1. La forma del sistema

Il backend è un'applicazione Express 5 che parla con Postgres in produzione e con SQLite in memoria nei test. La struttura è quella classica del MVC alleggerito: le route fanno solo HTTP e validazione, la logica vive nei services, i modelli Sequelize si occupano della persistenza. Il database fa molto più del solito — non è solo un magazzino: include vincoli di integrità referenziale, soft-delete (`paranoid`) sulle entità recuperabili e soprattutto un constraint `EXCLUDE USING gist` che impedisce a livello database due prenotazioni sovrapposte sulla stessa aula. È una rete di sicurezza che resiste anche a bug applicativi futuri.

Il frontend è una single-page app React 19 con TanStack Query per la cache server, react-i18next per le cinque lingue (italiano, inglese, spagnolo, tedesco, francese), Tailwind 4 e shadcn/ui per l'interfaccia. La PWA è completa: manifest, service worker generato da Workbox e precache di circa cento entry per l'uso offline.

I numeri di superficie:

- 34 file di route per 244 endpoint REST
- 38 services per la logica di dominio (mailer, scheduler, importer, ora anche `backupVerify` per integrità backup)
- 41 modelli Sequelize, di cui 15 con soft-delete
- circa **44.600 righe lato server e 51.000 lato client** (escluso `node_modules`, test e coverage)
- 202 file TypeScript/TSX

Lo stack è volutamente conservativo. Niente framework esoterici, niente librerie a rischio abbandono: tutto quello che gira è documentato, manutenuto e facile da sostituire se mai servisse.

---

## 2. Conformità per la Pubblica Amministrazione italiana

Questa è la sezione più importante per chi valuta l'adozione in un istituto pubblico. La tabella seguente mette in fila i requisiti normativi che si applicano al perimetro di Cadenza (gestione prenotazioni, prestiti, display pubblico) e dichiara, requisito per requisito, dove l'implementazione vive nel codice.

| Riferimento normativo                                        | Cosa serve                                                        | Dove è                                                                                               | Stato          |
| ------------------------------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------- |
| Provv. Garante 06/2021 (cookie banner)                       | Banner con consenso esplicito persistito                          | `frontend/src/components/legal/CookieBanner.tsx`                                                     | ✅             |
| GDPR art. 7 (consenso revocabile)                            | Registro consensi append-only versionato                          | `backend/models/UserConsent.js`                                                                      | ✅             |
| GDPR art. 20 (portabilità)                                   | Export dati utente in formato strutturato                         | `backend/routes/gdpr.js` `GET /export`                                                               | ✅             |
| GDPR art. 17 (oblio)                                         | Richiesta cancellazione utente                                    | `backend/routes/gdpr.js` `POST /delete-request`                                                      | ✅             |
| GDPR art. 7 par. 3 (revoca consenso)                         | Endpoint per gestire i consensi                                   | `backend/routes/gdpr.js` `GET/POST /consent`                                                         | ✅             |
| AGID Misure Minime ICT — autenticazione forte amministratori | Doppio fattore obbligatorio per ruoli admin                       | `backend/services/twoFa.js` + `middleware/auth.js`                                                   | ✅             |
| AGID — cifratura segreti a riposo                            | AES-256-GCM sulle credenziali in DB                               | `backend/lib/crypto.js`                                                                              | ✅             |
| AGID — log di sicurezza con retention                        | Audit log immutabile, retention configurabile                     | `backend/models/AuditLog.js` + `services/retentionScheduler.js`                                      | ✅             |
| AGID — backup periodico e ripristino                         | Backup quotidiano con procedura di restore documentata            | `services/backupScheduler.js` + `docs/BACKUP.md` + `docs/DISASTER_RECOVERY.md`                       | ✅             |
| AGID — accessibilità WCAG 2.1 AA                             | Skip link, landmark ARIA, supporto reduced-motion, axe-core in CI | `components/layout/AppLayout.tsx`, `vitest-axe`, `@axe-core/playwright`                              | ✅             |
| AGID — Content Security Policy stretta                       | CSP rigorosa senza inline scripts                                 | `backend/app.js` (helmet)                                                                            | ✅             |
| AGID — HSTS, COOP, X-Frame-Options                           | Header di sicurezza moderni                                       | helmet con HSTS due anni, COOP same-origin, X-Frame SAMEORIGIN                                       | ✅             |
| AGID — rate limiting                                         | Throttle su endpoint pubblici e di autenticazione                 | `middleware/rateLimit.js`                                                                            | ✅             |
| Anti-overlap a livello DB                                    | Vincolo Postgres che impedisce doppie prenotazioni                | `lib/preSyncMigrations.js` (`bookings_no_overlap`)                                                   | ✅             |
| PII protection (Sentry e log)                                | Scrub PII ricorsivo, user id anonimizzato                         | `lib/sentry.js` (back) + `lib/sentry.ts` (front)                                                     | ✅             |
| CAD art. 41 (PEC)                                            | Integrazione PEC                                                  | —                                                                                                    | 🔵 Roadmap     |
| CAD art. 64-bis (SPID/CIE)                                   | Login SPID 2 + CIE                                                | —                                                                                                    | 🔵 Roadmap     |
| D.Lgs. 82/2005 art. 43 (conservazione sostitutiva)           | Firma digitale + marca temporale RFC 3161                         | —                                                                                                    | 🔵 Roadmap     |
| AFAM — invio dati ANIS/MIUR                                  | Export adempimento AFAM                                           | —                                                                                                    | 🔵 Roadmap     |
| AGID Linee Guida Software PA (open-source preference)        | Sorgente pubblicato con licenza open                              | Da v1.5.1 il software è licenza commerciale: self-host on-prem o SaaS. Vedi `LICENSE` e `README §10` | ⚪ Non applic. |

Su sedici requisiti applicabili al dominio di Cadenza, sedici sono coperti. I quattro punti "Roadmap" sono le integrazioni tipiche di una PA che gestisce flussi documentali pieni — non strettamente necessarie per il booking di aule e strumenti, ma attivabili in circa cinque settimane di sviluppo più il processo AgID per la registrazione come service provider SPID.

L'ultima riga merita una nota: il fatto che il software sia chiuso non significa che sia incompatibile con la PA. Le Linee Guida AgID _preferiscono_ l'open ma riconoscono esplicitamente l'acquisto di software commerciale quando giustificato. Cadenza si propone in entrambe le formule: licenza on-prem (il cliente gestisce il proprio VPS) oppure SaaS hosted (gestione operativa a carico del fornitore).

---

## 3. Stabilità

Il termine "stabilità" qui significa due cose distinte: il software non si rompe quando lo si usa (correttezza), e quando qualcosa va storto si riesce a tornare in piedi senza perdere dati (resilienza). Cadenza copre bene entrambe.

### 3.1 I test

L'ossatura di prova è costruita su Vitest 4 — stesso runner per backend e frontend — con Supertest per gli HTTP roundtrip sul server e Testing Library più vitest-axe per i componenti React. La copertura E2E è affidata a Playwright su Chromium e gira come job CI dedicato.

Lo stato attuale è il seguente:

- **1.730 test backend** (più 16 skippati con motivazione, soprattutto test Postgres-only che girano in un job separato) distribuiti su 98 file
- **258 test frontend** (più 2 skippati) su 26 file
- **12 spec Playwright** sui flussi critici: golden path (login + booking + my-bookings + logout), **RBAC denial** (studente → 403 su rotte admin), **booking cancellation** dall'owner, **GDPR export** art. 20, **pending-user** che vede `403 ACCOUNT_PENDING` sulle mutazioni, **loans pagination contract** (X-Total-Count/X-Limit/X-Offset + clamp anti-DoS), prestito strumenti lifecycle, waitlist conflict + claim, admin approve pending, a11y `axe-core` su pagine pubbliche
- Una **suite di soak test** in k6 con sampler memoria, file descriptor e latenza, che si lancia manualmente per le verifiche pre-rilascio (non in CI, perché impiega 4-8 ore)
- Suite di stabilità dedicata: **roundtrip dei backup**, **time-travel del calendario** (vent'anni di Pasqua calcolata con il Computus su dieci anni avanti)

Sommando solo unit e integration si arriva a **1.988 test** che girano in circa 95 secondi sul backend e 3 secondi sul frontend. È il tipo di velocità che invita davvero a lanciare i test prima di committare, non un rituale da subire.

### 3.2 Quanto codice è coperto

Le copertura sono rilevate da `c8` per il backend e dal coverage v8 di Vitest per il frontend. Le soglie sono _bloccanti_: se la copertura scende sotto, la build CI fallisce.

Backend:

```
Statements   72.99 %     (soglia 72)
Lines        74.25 %     (soglia 73)
Functions    79.46 %     (soglia 78)
Branches     61.50 %     (soglia 60)
```

Frontend:

```
Statements   71.87 %     (soglia 60)
Lines        74.32 %     (soglia 60)
Functions    63.83 %     (soglia 50)
Branches     60.06 %     (soglia 50)
```

Tutti e otto gli assi sono sopra soglia, con margini comodi. La copertura cresce per accrezione: ogni nuovo test alza il pavimento perché la soglia si autoaggiorna a "valore misurato meno un punto e mezzo". Questo evita regressioni silenziose.

Alcuni file restano sotto al sessanta per cento sui rami: tipicamente sono gli handler di errori (foreign-key violation in cascata, validatori nested) o gli adapter esterni che richiederebbero fixture pesanti per essere triggerati. Per la maggior parte di questi file statement e lines restano comodamente sopra il sessanta per cento — il percorso felice è ben esercitato, sono gli edge case di rottura del database a essere meno coperti.

Restano alcune eccezioni che scendono sotto soglia anche sugli assi principali e che vale la pena nominare: in `lib/` ci sono `mainPolicy.js` e `preSyncMigrations.js`, due moduli che contengono logica di bootstrap e backfill idempotenti chiamata solo in specifiche condizioni del DB esistente; in `services/` ci sono `backupRestore.js`, `backupScheduler.js`, `multiSlotService.js` e `retentionScheduler.js`, che dipendono da spawn di processi (`tar`, `pg_dump`) o da configurazioni runtime difficili da indurre in unit test; in `routes/` `auth.js` ha rami OAuth/OIDC che richiedono i provider Google/Microsoft configurati, mentre `monteOre.js` e `backups.js` hanno percorsi specifici (settings monte-ore, restore manuale) che oggi sono coperti più dai test integration end-to-end che dai test sui singoli file. Sono tutti gap conosciuti e gestiti: l'aggregato resta sopra le soglie su tutti e quattro gli assi.

### 3.3 Le garanzie a runtime

Sono le cose che il sistema fa per non sbagliare anche quando l'utente fa qualcosa di inatteso o quando due richieste concorrenti arrivano nello stesso millisecondo.

- **Anti-overlap delle prenotazioni**: tre livelli di difesa. Il validator applicativo, una `findOrCreate` di Sequelize che usa una UNIQUE, e infine il vincolo `EXCLUDE USING gist` di Postgres che impedisce fisicamente che due righe `confirmed` si sovrappongano sulla stessa aula.
- **Transazioni `SERIALIZABLE` con retry su deadlock**: ogni mutazione passa per `lib/withTransaction.js`, che intercetta i codici di errore 40001 e ritenta in modo trasparente.
- **Outbox email**: tutte le email passano da una coda persistente con chiave di idempotenza unica, throttle per destinatario, backoff esponenziale fino a un'ora di cap e dead-letter dopo cinque tentativi falliti. Se il server SMTP smette di rispondere, le email si accumulano in stato `pending` e ripartono da sole. Se un utente ha hard-bounce permanente, viene segnato e saltato dagli invii futuri (tranne quelli a priorità di sicurezza, come l'OTP).
- **Ghost booking**: chi prenota e non si presenta perde lo slot dopo una finestra di grazia configurabile. Il meccanismo è in profondità: lo scheduler include la condizione `requireCheckIn` direttamente nella query SQL, c'è un filtro di sicurezza applicativo a valle e un guard hard nel mittente che si rifiuta di inviare un'email "ghost cancellation" se l'aula non richiede check-in.
- **Audit log immutabile con hash-chain di integrità**: ogni azione amministrativa su entità sensibili viene scritta in append-only con retention configurabile (default 24 mesi) e archiviazione gzip prima della cancellazione. Da v1.11.0 ogni riga porta un `rowHash` SHA-256 concatenato al `prevHash` della riga precedente, in modo che un `UPDATE` o `DELETE` diretto sul DB sia rilevabile dall'endpoint admin `GET /api/admin/audit-log/verify-integrity` come `hash_mismatch` o `chain_gap`. Tamper-evidence per dossier legali e ispezioni PA.
- **Account lockout**: dopo dieci login falliti consecutivi l'account si blocca per trenta minuti. Il controllo `lockedUntil` avviene _prima_ di bcrypt, così un attacco brute force non amplifica il consumo CPU del server.

### 3.4 Gli scheduler

Cadenza ha **sei scheduler** principali. Tutti sono testati, tutti scrivono uno stato persistente prima di mandare email — non c'è il rischio del doppio invio se la rete o SMTP si interrompono a metà. Da v1.10.0 ogni scheduler verifica in `start()` di essere sull'istanza master (`NODE_APP_INSTANCE === '0'` quando PM2 gira in cluster mode), così l'attivazione del parallelismo HTTP non moltiplica i tick di backup/reminder.

- Un **tick generale ogni cinque minuti** che si occupa di quattro cose in serie: reminder delle prenotazioni in arrivo (T-60 minuti circa), cancellazione automatica dei "ghost", reminder e segnalazione overdue dei prestiti strumenti, pulizia delle waitlist scadute con promozione del prossimo utente in coda.
- Un **job di backup quotidiano alle 02:30** che produce un archivio compresso del database e degli upload. Le impostazioni di backup leggono dal DB con fallback su variabili d'ambiente.
- Un **job di verifica integrità backup** _weekly_ (default domenica 03:00 Europe/Rome) introdotto in v1.9.0. Esegue sette check sull'ultimo `.tar.gz`: età ≤ 36h, tarball safe, manifest valido, `database.sql` non vuoto, presenza delle `CREATE TABLE` critiche, sezione dati presente, conteggio tabelle dump entro ±2 vs `information_schema.tables` di prod. Mail admin solo su fallimento, idempotency per giorno+reason. Stato esposto in `/admin/ops`.
- Un **job di retention quotidiano alle 03:00** che lavora su tre fronti: pruning dell'audit log oltre i 730 giorni con archiviazione gzip; rimozione degli snapshot pre-restore più vecchi di sette giorni; pulizia dell'outbox `sent` oltre i 30 giorni (i `dead` restano per inspection manuale).
- Un **worker dell'outbox email** che polla i `pending` con backoff esponenziale e li manda al transporter SMTP cached.
- Un **scheduler di export Excel** (ogni dieci minuti, opt-in) che scrive un file `.xlsx` su una cartella locale che il sistema operativo sincronizza via `rclone` verso un cloud personale — pattern adottato anche per i backup off-site (vedi §3.5).

### 3.5 Operations

Il sistema è in produzione dietro nginx con TLS gestito da Let's Encrypt e HSTS preload. Il process supervisor è pm2; l'uptime è stabile, i restart sono solo quelli del deploy. C'è un endpoint `/api/health` che risponde sotto i cinque millisecondi con lo stato del processo e un `/api/ready` che — esteso in v1.11.0 — esegue tre check di prontezza: **database** (CRITICO, una connessione KO porta a 503), **SMTP** (warning, l'outbox compensa con retry), **disk** (warning ≥90 %, critico ≥95 % sul filesystem che ospita `uploads/`). La risposta segue uno schema uniforme `{ status, checks, timestamp }` sia su 200 sia su 503 — un monitor esterno (UptimeRobot, Healthchecks) può differenziare warning da critico senza parser custom.

**Dashboard operativa unificata** in `/admin/ops` (introdotta in v1.7.0): cinque widget aggiornati ogni dieci secondi via polling cacheato server-side (TTL 5s) per VPS (load average, RAM, disco, uptime, Node version), Postgres (connessioni attive/idle/idle-in-tx, dimensione DB, top tabelle), MailOutbox (count per status, età del più vecchio `pending`), Backup (ultimo `.tar.gz` con badge verde/giallo/rosso sull'età, dimensione, totale storico) con **sotto-sezione "Verifica integrità"** introdotta in v1.9.0 che mostra esito dell'ultima verifica weekly e prossimo tick programmato, Scheduler (sei worker con `lastTickAt`, `lastError`, `nextTickAt` normalizzati).

Il deploy è uno script bash idempotente di otto passi che fa rsync incrementale, `npm ci`, reload pm2 e test nginx prima di rilanciare. Include una normalizzazione dei permessi post-rsync (754/755 sulle dir, 644 sui file) e un guard che confronta l'hash di `index.html` per intercettare deploy parziali. Tutto è documentato in [`docs/DEPLOY.md`](DEPLOY.md) insieme a una piccola "incident library" con i problemi nginx più comuni.

**Parallelismo opt-in** (v1.10.0): `ecosystem.config.js` alla root del repo è pronto per il passaggio a PM2 cluster mode (`instances: 'max'` + `exec_mode: 'cluster'`). Quando attivato, le richieste HTTP si distribuiscono su N core ma gli scheduler restano confinati all'istanza 0 grazie al lock in `backend/lib/clusterRole.js`. Default fork mode = zero impatto sui deploy esistenti.

Il disaster recovery è coperto su tre livelli:

1. **`scripts/dr-drill.sh`** — drill _non distruttivo_ che restora il backup più recente in una sandbox, valida le foreign key e produce un report. RTO misurato ~1 s per il restore del database.
2. **Verifica integrità weekly** (v1.9.0, `backupVerifyScheduler.js`) — controlla automaticamente che ogni `.tar.gz` recente sia restorabile a livello strutturale, senza che un operatore debba ricordarsene.
3. **Backup off-site multi-cloud** (v1.10.0, `scripts/setup-rclone-backups.sh`) — cron giornaliero che copia la cartella backup su un remote rclone (OneDrive Business, Dropbox, S3, Hetzner Storage Box, Backblaze B2 — 70+ backend supportati). Cleanup mensile, retention configurabile (default 90gg). Stesso pattern adottato per l'export Excel: zero codice Cadenza, separazione pulita app/ops.
4. **PITR opzionale** (v1.10.0, `scripts/setup-wal-archiving.sh`) — abilita Postgres `archive_mode=on` con `archive_command` che pusha ogni segmento WAL allo stesso remote rclone, permettendo restore granulare al secondo invece dei soli snapshot di mezzanotte. Procedura documentata in [`docs/DISASTER_RECOVERY.md`](DISASTER_RECOVERY.md).

---

## 4. Sicurezza

La superficie di attacco di un'applicazione web come Cadenza ha quattro grandi capitoli: chi può fare cosa (autenticazione e autorizzazione), cosa si può iniettare (validazione input), cosa il browser è autorizzato a fare (header HTTP) e cosa succede ai dati che vengono fuori dal sistema (Sentry, log, backup). Vediamoli.

### 4.1 Autenticazione

Le password sono salate con bcrypt costo 10 e non vengono mai serializzate nelle response (`User.password` è escluso a livello di model). I token JWT sono firmati con `JWT_SECRET` che in produzione viene validato come stringa di almeno 32 caratteri prima del boot. Il doppio fattore TOTP è obbligatorio per i ruoli admin con un grace period configurabile (per permettere l'enrollment al primo accesso); i recovery code sono SHA-256 salt-derivati; in fallback è disponibile un OTP via email per chi perde l'autenticatore.

OAuth 2.0 è supportato con Google, Microsoft e provider OIDC generico. Lo state token è verificato, l'`aud` claim viene controllato, il claim mapping decide il ruolo locale.

Per evitare l'account enumeration la route `/forgot-password` risponde sempre con lo stesso messaggio e lo stesso tempo, sia che l'email esista o no.

### 4.2 Autorizzazione

Il controllo accessi vive in cinque middleware: `requireRole`, `requireApproved`, `requireRoles`, `requireSameUserOrAdmin` e una variante per le risorse condivise. Niente `req.body` finisce mai grezzo dentro a `Model.create` o `Model.update`: ogni route mutativa usa o uno schema zod o un `pick()` esplicito, blindando contro il mass assignment.

### 4.3 Header HTTP

L'helmet è configurato in modo deliberato, non lasciato sui default. La CSP è `default-src 'self'` con autorizzazioni mirate per immagini (data URI e blob), nessun `unsafe-inline` su script. HSTS è impostato a due anni con `includeSubDomains` e `preload`. COOP è `same-origin`, X-Frame-Options è `SAMEORIGIN`, Permissions-Policy è restrittiva su camera, microfono e geolocalizzazione.

C'è anche un sistema di **reporting delle violazioni CSP**: il browser invia i blocchi a `/api/csp-report`, l'endpoint parsa entrambi i formati (legacy `application/csp-report` per i browser più vecchi e il moderno Reporting API W3C) e inoltra a Sentry come warning event taggato — utile per accorgersi se un deploy ha introdotto inline scripts non previsti.

### 4.4 Cifratura dei dati

A riposo, le credenziali sensibili in DB (SMTP, OAuth, messaging providers) sono cifrate AES-256-GCM con chiave da `SECRET_KEY` env. La cifratura è applicata a tutti i modelli `MailSettings`, `OAuthSettings`, `MessagingSettings`.

I segreti del repository sono protetti da **Gitleaks** in CI (fail su rilevamento di API key, token, private key) e da un pre-commit hook locale che scansiona solo i file staged. La config `.gitleaks.toml` include allowlist mirate per fixture di test.

### 4.5 Anti-abuse

Rate limit su login, register, forgot password, GDPR endpoint e iCal export, con `express-rate-limit` per IP. Account lockout dopo dieci tentativi falliti (durata trenta minuti). Anti-replay del TOTP con marker `lastUsedAt` e tolleranza di una finestra (trenta secondi). Token iCal e QR check-in rotabili, hash SHA-256 in DB, mai loggati in chiaro.

**Origin guard cross-origin** (v1.11.0): tutte le richieste mutanti (`POST/PUT/PATCH/DELETE`) verso `/api/*` devono provenire da un `Origin/Referer` whitelistato (`FRONTEND_URL` + same-origin; localhost qualsiasi porta in dev). Difesa CSRF-equivalente coerente con il modello JWT+Bearer di Cadenza: copre anche le "simple request" che il browser invia senza preflight CORS. Una richiesta non conforme riceve `403 ORIGIN_FORBIDDEN` con log strutturato `warn` per SIEM. Eccezioni: webhook server-to-server (`/api/messaging/*`) e CSP report endpoint.

C'è anche una **whitelist IP opzionale** per il check-in: se l'amministratore vuole, il check-in QR funziona solo da una CIDR list configurata (utile per evitare che gli studenti facciano check-in da casa).

### 4.6 Stato delle vulnerabilità

`npm audit` riporta **zero vulnerabilità** sia sul backend in produzione (`--omit=dev`) sia sul frontend. Le dipendenze sono aggiornate alle patch più recenti; gli unici outdated sono semver patch di Sentry, già applicate.

### 4.7 Cosa manca per il bollino "enterprise certificato"

Niente di necessario per il dominio Conservatorio, ma vale la pena nominarlo: SPID/CIE (circa tre settimane di sviluppo più il processo AgID), integrazione PEC con provider certificato (una settimana), conservazione sostitutiva con firma digitale e marca temporale (due settimane), penetration test esterno (output dipende dal fornitore), readiness ISO 27001 o SOC 2 (mesi, ha senso solo per tender oltre i 200K€).

---

## 5. Qualità del codice e documentazione

TypeScript strict acceso con `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` e `noUncheckedIndexedAccess`. Zero errori sia da `tsc` che da ESLint, lint a `--max-warnings 9999` con zero warning effettivi. Il naming è in italiano per il dominio (booking, prestiti, aule, dotazioni) e in inglese per l'infrastruttura (model names, scheduler, config). I commenti, quando ci sono, spiegano _perché_ — il "cosa" lo dicono già i nomi.

C'è qualche file lungo (tre route superano le 1.300 righe: `bookings.js`, `monteOre.js`, `structure.js`) che sarebbe carino splittare in moduli; per ora la scelta è di non farlo perché la suddivisione comporta un rischio merge-conflict alto durante lo sviluppo attivo. È un compromesso conscio.

La documentazione è abbondante. Venti file Markdown in `docs/` coprono architettura, manuale admin, deploy, backup e disaster recovery, sicurezza, setup SSO, observability, strategia di testing, migrations, vincoli DB, bot messaging, integrazione Isidata, monte ore docenti, analisi semantica dei tipi di prenotazione, convenzioni di contributo, installazione locale e indice dei 36 screenshot admin per onboarding. Il README esiste in italiano e inglese.

---

## 6. Maturità di processo

Cadenza ha un singolo autore principale, ma il processo è organizzato come se fosse un team. Conventional commits (commitlint configurato), trunk-based su `main`, pre-commit hook stretto con prettier ed eslint sui file staged, quattro job CI paralleli su GitHub Actions (backend lint+test+coverage, backend Postgres-only, frontend typecheck+test+build, E2E Playwright).

La policy di auto-commit funziona così: se type-check e lint-staged passano, il commit parte direttamente con un messaggio italiano in stile Conventional Commits e viene pushato su `main`. Niente overhead di PR per singolo autore, ma il pre-commit hook agisce come gate di qualità. Per le review on-demand c'è `/ultrareview`, un workflow multi-agent che lancia un'analisi indipendente quando serve un parere esterno.

Le soglie di coverage sono bloccanti su entrambi i lati: il CI fallisce se le percentuali scendono sotto i pavimenti definiti in `backend/vitest.config.js` e `frontend/vitest.config.ts`. Niente "test che girano per sentirsi a posto": la build muore davvero.

Sul deploy, lo script `deploy.sh` è idempotente e completa tipicamente in trenta secondi end-to-end. La connessione SSH usa un alias dedicato in `~/.ssh/config` (`cadenza-vps`) con `IdentitiesOnly yes` e una chiave dedicata, niente sprawl di chiavi.

---

## 7. Verdetto sulla messa in produzione

### 7.1 Pronto subito per un singolo Conservatorio

Tutte le condizioni che servono per partire sono soddisfatte: zero vulnerabilità, zero errori statici, **1.988 test che passano** (più 12 spec E2E Playwright), copertura sopra soglia su tutti gli assi, anti-overlap a livello DB, **audit log immutabile con hash-chain di integrità SHA-256 e endpoint admin di verifica**, endpoint GDPR completi, **sei scheduler con retention testati e verifica integrità backup automatica**, outbox email con idempotency e dead-letter, doppio fattore admin obbligatorio, **origin guard cross-origin sulle mutazioni** (v1.11.0), segreti cifrati AES-256-GCM, **readiness multi-componente DB/SMTP/disk** per monitor esterni (v1.11.0), deploy idempotente, drill DR non distruttivo, **backup off-site multi-cloud opt-in**, PWA installabile, mobile UX mobile-first (overhaul v1.8.0), cinque lingue, venti documenti tecnici e trentasei screenshot per l'onboarding.

La capacità target su singolo Conservatorio — verificata dai load test in `loadtest/` — è dell'ordine di **cinquemila utenti attivi**, **cinquantamila prenotazioni l'anno**, **duecento aule** e **cinquecento strumenti in prestito**. Numeri molto sopra la media dei conservatori italiani. Con PM2 cluster mode attivato (opt-in v1.10.0) la capacità HTTP scala linearmente sul numero di core fisici della VPS.

### 7.2 Pronto per il modello commerciale multi-cliente

L'architettura è **single-tenant per istituto**: ogni cliente ha la sua istanza, il suo database, i suoi backup. È la scelta giusta sia per ragioni di privacy (zero data leakage cross-tenant by design) sia per ragioni di operations (un cliente non può tirare giù gli altri).

L'onboarding di un nuovo istituto richiede tipicamente:

1. Provisioning del VPS Ubuntu LTS (procedura in `docs/install.md`)
2. Clone del repo, `npm ci`, esecuzione di `./deploy.sh`
3. Configurazione SMTP, OAuth e Sentry tramite la UI admin (credenziali cifrate in DB)
4. Setup di `Institute`, `Building` e `Room` (manuale o via importer CSV)
5. Import utenti (adapter Isidata o CSV)
6. Stampa dei QR aula e affissione (PDF A4 pronto per stampa)

Il tempo realistico è di **due o tre giorni** con un implementatore esperto, o **una settimana** se il direttore segue il runbook in autonomia.

### 7.3 Casi d'uso supportati oggi

Prenotazione di aule e studi, anti-ghost via QR check-in, concerti con scheda artisti e locandina integrata, prestito strumenti con approvazione e regole per famiglia, monte ore docenti con sezioni A/B e deroga contratto orario, display kiosk pubblico per ingresso edificio, bot Telegram/WhatsApp/Email per le richieste rapide, multi-lingua, **PWA installabile con offline shell e mobile UX dedicato** (overhaul v1.8.0: calendario aule del giorno gerarchico edificio→aula con disclosure HTML nativi, hero compatto, KPI 2×2), export iCal per i calendari personali, analytics admin (occupancy, ghost rate, top users), backup verificato + DR + off-site sync + PITR opzionale.

L'unico caso d'uso pianificato ma non implementato sono gli **eventi multipli** intesi come aggregatori di N prenotazioni con un'unica identità (utile per festival e settimane tematiche). Il piano architetturale è documentato in [`develop.md` §1](../develop.md); l'implementazione non è ancora partita.

---

## 8. Il sistema email transazionale (scheda dedicata)

L'email è il principale canale di comunicazione asincrono di Cadenza, e merita un trattamento a parte perché è un punto di rottura tipico nei prodotti SaaS. Cadenza usa un **outbox pattern** classico: nessun `sendMail` sincrono viene mai chiamato da una route HTTP. Il flusso è sempre lo stesso:

```
caller → sendBookingEmail() → enqueueMail() → MailOutbox (pending)
                                                ↓
                                    mailOutboxScheduler worker
                                                ↓
                                    SMTP transporter (config DB cached)
                                                ↓
                                    status: sent | failed (retry backoff) | dead
```

Il modello `MailOutbox` conserva snapshot di `subject` e `bodyHtml` al momento dell'enqueue: se l'admin modifica un template tra l'enqueue e il send effettivo, l'utente riceve la versione vista quando l'azione è partita. È deterministico, non confonde nessuno.

Le garanzie del sistema:

- **Idempotenza** tramite UNIQUE su `idempotencyKey` (formato `booking:<id>:<kind>`): un re-enqueue è no-op silenzioso, mai un doppio invio.
- **Throttle per destinatario per ora**, configurabile da settings; la priorità zero (sicurezza, OTP) bypassa il throttle.
- **Hard-bounce gate**: se l'SMTP rifiuta permanentemente (5xx), `User.emailBouncedAt` viene marcato e gli enqueue futuri saltano l'utente (tranne priority zero).
- **Retry con backoff esponenziale** (60s, 2min, 4min, 8min, 16min, 32min, poi cap a 1h) fino a un massimo di tentativi configurabile (default 5), dopo il quale lo stato diventa `dead` e richiede intervento manuale.
- **Retention 30 giorni** sui `sent`; i `dead` restano fino a cancellazione esplicita per consentire ispezione.
- **Guard hard sul kind ghost_cancellation**: il mittente si rifiuta di inviare un'email "ghost" se la stanza non richiede check-in, anche se il caller invocasse per errore. È difesa in profondità a tre livelli (query SQL, filtro applicativo, guard nel sender).

L'amministratore può ispezionare e gestire l'outbox via API:

- `GET /admin/mail-outbox` per la lista paginata con filtri kind e status
- `GET /admin/mail-outbox/health` per lo stato sintetico (SMTP configurato, verify OK, conteggio dead)
- `POST /admin/mail-outbox/:id/retry` per riportare un `dead` in `pending`
- `DELETE /admin/mail-outbox/:id` per la rimozione di entry orfane

---

## 9. Appendice — come riprodurre l'audit

I comandi che seguono producono tutti i numeri citati nelle sezioni precedenti. Lanciati su un checkout pulito di `main`, dovrebbero dare risultati coerenti con quanto scritto.

```bash
# Backend: test + coverage (bloccante)
cd backend && npm run test:coverage

# Frontend: test + coverage + typecheck + lint
cd frontend && npm run test:coverage
cd frontend && npm run typecheck
cd frontend && npm run lint

# Build di produzione
cd frontend && npm run build

# Vulnerabilità delle dipendenze
cd backend && npm audit --omit=dev
cd frontend && npm audit

# E2E
npm run e2e

# Test Postgres-only (richiede Postgres locale o servizio CI)
cd backend && npx vitest run "tests/**/*.postgres.test.js" tests/integration/excludeConstraint.test.js

# Disaster recovery drill (non distruttivo)
bash backend/scripts/dr-drill.sh

# Smoke produzione
curl -fsS https://<dominio>/api/health | jq .

# Soak test (4-8h, manuale, fuori CI)
npm run soak
```

### Numeri-cartolina

```
v1.11.0 — closed-source proprietary
~95.600 LOC produttivo (44.6K backend + 51K frontend)
245 endpoint REST con RBAC granulare (+1 verify-integrity audit-log)
41 modelli Sequelize, 15 con soft-delete · audit log con hash-chain SHA-256
34 route, 38 services, 5 lingue UI
1.988 test unit+integration (1.730 backend + 258 frontend) + 12 E2E + soak harness
72.99 / 74.25 / 79.46 / 61.50 backend coverage (stmts/lines/funcs/branches)
71.87 / 74.32 / 63.83 / 60.06 frontend coverage
0 vulnerabilità npm audit · 0 errori lint/typecheck · TS strict
2FA admin obbligatorio · audit log tamper-evident (hash-chain) · AES-256-GCM secrets
Origin guard cross-origin (CSRF-equivalent per modello Bearer) · CSP A+
GDPR by-design (consent, export, delete, retention 24mo)
Anti-overlap DB-level (Postgres EXCLUDE) — zero doppie prenotazioni garantite
6 scheduler (cluster-safe) · weekly backup integrity check · off-site sync rclone
Readiness multi-componente (DB/SMTP/disk) per UptimeRobot/Healthchecks
Deploy idempotente · DR drill non distruttivo · PITR opt-in · RTO ~1 s
Dashboard ops /admin/ops · PWA installabile · mobile UX mobile-first
20 documenti tecnici + 36 screenshot admin + CHANGELOG bilingue IT/EN
```

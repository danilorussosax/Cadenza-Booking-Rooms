# Changelog

Tutte le modifiche significative al progetto Cadenza sono documentate in
questo file. Il formato segue il principio "human readable" (non strict
Keep-a-Changelog) per leggibilità a clienti e direttori di Conservatorio.

Le versioni seguono [Semantic Versioning](https://semver.org/lang/it/):

- **MAJOR**: cambi incompatibili con installazioni esistenti
- **MINOR**: nuove feature backward-compatible
- **PATCH**: bug fix e ottimizzazioni interne

## [1.6.0] — 14 maggio 2026

Versione "consolidamento e onboarding": chiude i pezzi mancanti per portare
un nuovo Conservatorio in produzione senza intervento manuale dell'amministratore,
e rinforza la robustezza del sistema su fusi orari e hosting diversi.

### Nuove feature

#### Onboarding studenti / docenti

- **Magic-link "primo accesso" dopo import Isidata** ([`#isidata`](docs/INTEGRATIONS-ISIDATA.md))
  Dopo l'apply dell'import Isidata, l'admin può inviare in bulk una mail di
  benvenuto a tutti i nuovi utenti con un link per impostare la propria
  password. Niente più CSV con password in chiaro, niente più "non riesco
  ad accedere" via Segreteria. Token monouso, scadenza configurabile
  (default 14 giorni, range 1-90).
- **Bulk-invio magic-link da pagina Utenti**
  Stessa azione disponibile come bulk action su righe selezionate
  (utile per rimandare il link a chi l'ha perso).
- **Pagina di login con CTA "Rinvia link di benvenuto"**
  Quando un utente Isidata prova a loggare prima di completare il setup
  (code `PASSWORD_NOT_SET`), vede un messaggio chiaro + bottone self-service
  per richiedere un nuovo link.
- **Manuale studente in-app** ([`docs/MANUALE_STUDENTE.md`](docs/MANUALE_STUDENTE.md))
  ~340 righe dedicate agli studenti. Guard per ruolo: docenti vedono solo
  il manuale docente, studenti solo il manuale studente, admin tutti e tre
  con switcher.

#### Import anagrafica multi-provider

- **Wizard import esteso a ESSE3 (Suite Studenti CINECA)**
  Stesso wizard di Isidata parametrizzato su `source`, con storico
  separato. Logo identitario per ogni provider (`IsidataLogo`, `Esse3Logo`)
  visibile in card, dialog e header.
- **Whitelist domini email** per il login OAuth Google/Microsoft.

#### Vista dashboard "tutti vedono"

- **Tutte le prenotazioni visibili a ogni ruolo** (admin, docente, studente)
  con distinzione visiva: proprie con anello oro, altrui senza.
- **Click su prenotazione altrui** → dialog read-only con informazioni
  non sensibili (chi, dove, quando), niente email/matricola.
- **Pagina /booking** allineata alla stessa logica.

#### Pagine pubbliche

- **Pagina "OAuth non disponibile"** stilizzata col logo del provider
  (Google a 4 colori o Microsoft a 4 quadrati) quando l'admin non ha
  ancora configurato la strategia. Sostituisce il vecchio JSON 503 nudo.

### Fix di sostanza

- **Audit timezone completo**: ~10 punti corretti dove il codice leggeva
  `hour/minute/day` senza convertire in `Europe/Rome`, con conseguenze su
  generazione ricorrenze Monte Ore, expander RRULE, scheduler reminder,
  analytics heatmap, widget kiosk, file backup, email. Su VPS UTC alcune
  date persistite nascevano sfasate di 1-2h; ora il sistema è
  TZ-coerente ovunque.
- **TZ-aware `exceptionOverlapService`** (filtro day-of-week e finestra
  oraria delle eccezioni in ora italiana).
- **`fix(booking)`**: Europe/Rome nel check finestra oraria delle regole
  (no off-by-2h su VPS UTC).
- **`fix(monte-ore)`**: le sospensioni inibiscono giorni e settimane
  qualunque sia il `kind`.

### Ottimizzazioni performance

- Eliminato N+1 in `GET /buildings/checkin-defaults` (era 2N+1 → 2 query).
- Refetch ridondante rimosso dal `reminderScheduler.tickLoans`.
- Bulk update degli orphan slots in `monteOreService` (singola query SQL).
- **Indici DB compositi**: `announcements_active_feed_idx`,
  `monte_ore_schedules_proposal_day_idx`, `integration_sync_runs_*`.
  Sostituiscono 8 indici single-column con 4 mirati alle query reali.

### Pulizia tecnica

- Rimosse dipendenze inutilizzate: `mysql2`, `express-session`,
  `passport.session()`. `SESSION_SECRET` non più richiesto in prod.
- Refactor degli import utenti in pipeline unificata (CSV admin +
  Isidata + ESSE3).
- Pagine Studente/Docente allineate a `max-w-7xl` (come Dashboard) per
  coerenza visiva su tutto il navigato non-admin.
- Documento "Audit Qualità / Stabilità / Sicurezza" riscritto in tono
  narrativo accessibile a un cliente non tecnico.

### CI / DevOps

- **Matrice TZ sul job backend**: ogni run gira la suite due volte, una
  con `TZ=Europe/Rome` e una con `TZ=UTC`. Regressioni TZ-naive vengono
  intercettate prima del merge.
- Gitleaks scan su ogni push e PR (era già attivo, confermato in matrice).

### Documentazione

- **Nuovo**: `docs/MANUALE_STUDENTE.md`, `CHANGELOG.md`.
- **Aggiornato**: `docs/AUDIT_QUALITA_PRODUZIONE.md` riscritto da zero
  in stile narrativo. Manuale Admin con sezione "Cosa c'è di nuovo in v1.6.0".
- **Piano**: `~/Desktop/import-isidata.md` documento operativo del flusso
  magic-link (lavoro completato).

### Numeri-cartolina

```
1.913 test unit+integration (1.698 backend + 258 frontend) — invariato come obiettivo
73 / 74 / 79 / 62 coverage backend — invariato sopra soglia
0 vulnerabilità npm audit · 0 errori lint/typecheck · TS strict end-to-end
TZ-coerente: identici i risultati su Europe/Rome e UTC
```

## [1.5.1] — pre-changelog (audit del 14 maggio 2026)

Versione storica documentata in [`docs/AUDIT_QUALITA_PRODUZIONE.md`](docs/AUDIT_QUALITA_PRODUZIONE.md)
e nella sezione "Cosa c'è di nuovo" del manuale admin.

Tra le feature consolidate prima del versionamento changelog:

- Macro pagina admin "Gestione prenotazioni" (3 tab: Regole / Tipi /
  Approvazioni) con redirect dai vecchi URL.
- Isidata con mapping UI guidata, soglie di sicurezza pre-apply,
  import `contractType`, diff "ultimi 2 run".
- Eccezioni con scope per aula (BookingRuleException).
- 2FA email mandatory per ruoli admin.
- Audit log append-only con retention configurabile + archivio gzip.
- AES-256-GCM su credenziali in DB.
- Backup giornaliero + DR drill non distruttivo.
- 5 lingue UI (IT/EN/ES/DE/FR).
- PWA mobile-first con service worker offline.
- iCal export utente con token rotabile.
- Display kiosk pubblico per ingressi edificio.
- Bot Telegram/WhatsApp/Email.
- 36 screenshot admin indicizzati per onboarding.

Licenza: da v1.5.1 il software è **proprietary closed-source** (LICENSE
all rights reserved). Distribuibile in self-host on-prem oppure SaaS hosted.

---

_Cambiamenti tracciati a partire da v1.6.0. Per la cronologia git completa:
[github.com/danilorussosax/Cadenza-Booking-Rooms](https://github.com/danilorussosax/Cadenza-Booking-Rooms/commits/main)._

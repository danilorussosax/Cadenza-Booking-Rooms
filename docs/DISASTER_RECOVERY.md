# Cadenza · Disaster Recovery Runbook

> **Stato**: ✅ DR test eseguito 2026-04-30 — RTO misurato **0.99s** (DB) su archivio 280 KB.
> **Cadenza raccomandata DR drill**: 1 volta a trimestre + dopo ogni release maggiore.
> **Documento**: questo file è il runbook unico — chi è on-call lo apre, lo esegue, ne firma il footer.

---

## 1. Obiettivi (RPO / RTO)

| Obiettivo                                  | Target                                       | Come si misura                                                                                                                                                                |
| ------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RPO** (Recovery Point Objective)         | ≤ 24h (default) / ≤ 1 min con PITR (v1.10.0) | Backup giornaliero automatico alle 02:30 locali. Con WAL archiving (`setup-wal-archiving.sh`) ogni transazione e' archiviata, RPO scende all'`archive_timeout` (default 60s). |
| **RTO database** (Recovery Time Objective) | ≤ 5 min                                      | Tempo per ripristinare il DB da archivio. **Misurato 2026-04-30: 0.99s** su archivio 280 KB / 629 prenotazioni.                                                               |
| **RTO completo (DB + uploads + servizio)** | ≤ 30 min                                     | Include: provisioning VPS (se total loss), restore, riavvio backend, smoke test admin.                                                                                        |
| **MTTR** (Mean Time To Restore)            | ≤ 15 min                                     | In caso di restore senza re-provisioning (server vivo, solo DB corrotto).                                                                                                     |

> Per Conservatori con > 5.000 utenti/anno o > 100k prenotazioni storiche, considerare RPO ≤ 6h aumentando la frequenza dello scheduler (vedi `BACKUP_TICK_HOUR`/`BACKUP_TICK_MINUTE` in `docs/BACKUP.md`) oppure attivare PITR via WAL archiving (vedi §5.6).

---

## 2. Architettura DR (cosa abbiamo già)

```
┌─────────────────────────────────────────────────────────────────┐
│  SERVER PRODUZIONE (Cadenza)                                    │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐         │
│  │ Backend Node │──▶│  Postgres    │   │ uploads/     │         │
│  │  (systemd)   │   │              │   │ (logo+SVG)   │         │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘         │
│         │ scheduler 02:30  │                  │                 │
│         ▼                  ▼                  ▼                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  backups/backup-YYYY-MM-DD-HHmm.tar.gz                  │    │
│  │   ├─ database.sql         (pg_dump --clean --if-exists) │    │
│  │   ├─ uploads/                                           │    │
│  │   └─ manifest.json                                      │    │
│  │  Rotazione: 30 daily + 12 weekly + 12 monthly           │    │
│  └────────────────────┬────────────────────────────────────┘    │
└───────────────────────┼─────────────────────────────────────────┘
                        ▼
            ┌─────────────────────────┐
            │  STORAGE OFFSITE        │  ← raccomandato (vedi BACKUP.md cap.7):
            │  S3 / B2 / rclone /     │     - rclone su Backblaze/B2 ($0.005/GB/mese)
            │  rsync su Storage Box   │     - Hetzner Storage Box (€3.20/TB/mese)
            └─────────────────────────┘     - GPG encryption pre-upload
```

**Componenti già implementati**:

- ✅ `backend/scripts/backup.js` — `pg_dump --no-owner --no-acl --clean --if-exists` + tar gzippato
- ✅ `backend/scripts/restore.js` — restore interattivo CLI con conferma `RESTORE`
- ✅ Scheduler in-process (`backupScheduler.js`) — daily a 02:30 con tracking `lastRun.ok`
- ✅ UI admin `/admin/backups` — lista, download, restore, upload archivi esterni
- ✅ Snapshot pre-restore: il DB attuale viene rinominato `<name>.pre-restore-<timestamp>` prima della sostituzione
- ✅ Audit log `audit_log` append-only per ogni operazione (chi, quando, quale archivio)
- ✅ Manifest JSON per detection automatica del dialect (sqlite/postgres)

**Componenti aggiunti in v1.9.0**:

- ✅ `backupVerifyScheduler.js` — verifica strutturale weekly dell'ultimo backup (default domenica 03:00). 7 check, alert silent-on-success, idempotency per giorno+reason. Vedi `docs/BACKUP.md` §"Verifica integrità automatica".
- ✅ Widget "Verifica integrità" in `/admin/ops` con esito ultima verifica e prossimo tick.

**Componenti aggiunti in v1.10.0 (opt-in)**:

- ✅ `scripts/setup-rclone-backups.sh` — cron giornaliero che copia i `.tar.gz` su un remote rclone (OneDrive/Dropbox/S3/B2/…). Cleanup mensile, retention configurabile (default 90gg). Vedi `docs/BACKUP.md` §"Upload remoto · Setup automatico via script".
- ✅ `scripts/setup-wal-archiving.sh` — abilita Postgres `archive_mode=on` con `archive_command` che pusha ogni WAL allo stesso remote rclone, sbloccando il PITR (vedi §5.6).
- ✅ PM2 cluster mode + scheduler lock (`backend/lib/clusterRole.js` + `ecosystem.config.js`) — scheduler attivi solo sull'istanza master in modo opt-in da `pm2 start ecosystem.config.js`.

**Cosa manca per DR enterprise** (decisioni operative del Conservatorio):

- ⚠ Hot-standby Postgres con failover automatico (Patroni / pg_auto_failover) — utile solo per SLA enterprise, non per Conservatori
- ⚠ Crittografia archivi pre-upload (GPG) se off-site è cloud pubblico — opzionale via `rclone crypt:` come remote intermedio
- ⚠ Test di restore reale con cadenza definita (questo documento, §8)

### 2.1 Continuità operativa durante un downtime (Excel mirror)

Indipendente dal restore — copre la finestra "Cadenza è giù MA serve sapere chi ha l'aula 12 alle 14".

```
┌──────────────┐  ogni 10 min  ┌─────────────────────┐  cron rclone   ┌──────────┐
│ Cadenza      │ ─────────────▶│ /var/cadenza/sync/  │ ──────────────▶│ OneDrive │
│ scheduler    │  scrive .xlsx │ cadenza-prenotaz.   │  ogni 10 min   │ Dropbox  │
│              │               │     xlsx            │                │ pCloud…  │
└──────────────┘               └─────────────────────┘                └────┬─────┘
                                                                          │
                                                                          ▼
                                                              📱 app cloud sul telefono
                                                                 della portineria
```

- Componente backend: `services/excelExporter.js` + `excelExportScheduler.js`. Una tab per ogni edificio con celle colorate per tipo (replica del Display kiosk) + tab "Prenotazioni" lista flat + tab "Info sync" con timestamp ultimo export
- Sync verso cloud personale via `rclone` + cron OS — separato dal backend: se Cadenza crasha durante un sync, l'ultima copia integra resta nel cloud
- **Direzione unidirezionale** (Cadenza → file, mai il contrario): le modifiche manuali al foglio durante un crash NON vengono importate al ripristino — niente conflict resolution complessa, niente bug oscuri. Procedura manuale: foglio separato "Prenotazioni manuali (offline)" da trascrivere a mano nella UI quando Cadenza torna online
- Setup completo passo-passo: [docs/EXCEL_SYNC.md](EXCEL_SYNC.md)
- Test: l'amministratore apre `/admin/server-settings → Servizi → Export Excel` e clicca "Scarica ora" per verifica visiva del file

**RTO durante downtime**: 0 (la portineria continua a operare dal foglio cloud). **RPO operativo**: max `EXCEL_EXPORT_TICK_MIN` minuti di staleness (default 10).

---

## 3. Scenari di disastro coperti

| #     | Scenario                                                      | Probabilità                               | Procedura                                        | RTO atteso |
| ----- | ------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------ | ---------- |
| **A** | Corruzione DB (crash, blackout, FS error)                     | Media                                     | §5.1 — Restore in-place                          | 5 min      |
| **B** | Cancellazione accidentale tabelle / dati (errore admin)       | Bassa                                     | §5.1 — Restore in-place dall'ultimo backup utile | 5–15 min   |
| **C** | Total loss del server (incendio, ransomware, dismissione VPS) | Molto bassa                               | §5.2 — Provisioning + restore offsite            | 30–60 min  |
| **D** | Migrazione tra versioni di Postgres (es. 16→18)               | Pianificata                               | §5.3 — Dump/restore controllato                  | 15 min     |
| **E** | Migrazione cross-dialect SQLite → Postgres                    | Pianificata (singolo evento per istituto) | §5.4 — Export+adapt+import                       | 30–60 min  |
| **F** | Compromissione (intrusione, furto credenziali)                | Molto bassa                               | §5.5 — Forensic + restore + key rotation         | 2–4h       |

Scenari **non coperti** in questo runbook (rimandati a documenti dedicati):

- Failover automatico hot-standby (Cadenza è single-instance per design — un Conservatorio = una istanza)
- Replica streaming Postgres (per RPO < 1h, da valutare se richiesto dall'istituto)

---

## 4. Pre-requisiti per il DR

Prima di iniziare qualsiasi operazione di restore, l'operatore deve avere:

- [ ] **Accesso SSH al server** con sudo o utente che può `systemctl restart cadenza`
- [ ] **Credenziali Postgres** del DB (`DB_USER`, `DB_PASSWORD` da `/etc/cadenza.env` o systemd `EnvironmentFile`)
- [ ] **Accesso al backup**: in locale `<project>/backups/` o offsite (`rclone`, `aws s3`, `rsync`)
- [ ] **Strumenti** sul server: `tar`, `gzip`, `psql`, `pg_dump` (preinstallati su Ubuntu/Debian standard)
- [ ] **Comunicazione utenti**: bozza messaggio "manutenzione in corso" pronta (Telegram bot, email, banner)
- [ ] **Approvazione**: per scenario C+F serve OK del DPO/Direttore prima di toccare i dati

---

## 5. Procedure operative

### 5.1 Scenario A/B — Corruzione DB o cancellazione accidentale (in-place)

> **Quando applicarlo**: il server è vivo, Postgres è raggiungibile, ma i dati sono corrotti o cancellati.

```bash
# 1. STOP del backend (evita writes durante il restore)
sudo systemctl stop cadenza

# 2. Snapshot di sicurezza del DB attuale (anche se corrotto: utile per forensics)
PGPASSWORD=$DB_PASSWORD pg_dump -h $DB_HOST -U $DB_USER -d $DB_NAME \
  --no-owner --no-acl -f /tmp/cadenza-pre-restore-$(date +%Y%m%d-%H%M).sql
# In alternativa: rinominare la cartella uploads prima del restore
sudo mv /opt/cadenza/backend/uploads /opt/cadenza/backend/uploads.pre-restore-$(date +%Y%m%d-%H%M)

# 3. Scegliere il backup da ripristinare (l'ultimo "buono" — non quello DOPO l'incidente!)
ls -lht /opt/cadenza/backups/ | head
# Pick: backup-2026-04-29-0230.tar.gz (ultimo prima dell'incidente)

# 4. Restore via CLI (richiede conferma "RESTORE")
cd /opt/cadenza/backend
node scripts/restore.js /opt/cadenza/backups/backup-2026-04-29-0230.tar.gz
# digitare: RESTORE

# 5. Riavvio
sudo systemctl start cadenza
sudo journalctl -u cadenza -f --since '1 min ago'
# Atteso: "boot ok", "DB connesso", nessun errore di schema

# 6. Smoke test (vedi §6)
```

**Tempo atteso**: 5 min su DB ≤ 100 MB. Su DB più grandi conta ~10 sec ogni 50 MB di dump.

### 5.2 Scenario C — Total loss del server

```bash
# 1. Provisioning del nuovo VPS (Ubuntu 22.04 o 24.04, 2 vCPU / 4 GB RAM minimo)
#    Se hai un'immagine cloud-init pre-fatta, usala. Altrimenti:
sudo apt update && sudo apt install -y postgresql nodejs npm git tar gzip

# 2. Recupero archivio offsite (esempio: rclone da Backblaze B2)
rclone copy b2:cadenza-backups/backup-YYYY-MM-DD-HHmm.tar.gz /tmp/
#  Se cifrato GPG:
gpg --decrypt /tmp/backup-*.tar.gz.gpg > /tmp/backup-*.tar.gz

# 3. Bootstrap del repo applicativo
cd /opt
git clone https://github.com/... cadenza
cd cadenza
npm ci --workspaces

# 4. Configurazione env (DB_*, JWT_SECRET, SENTRY_*)
sudo cp deploy/cadenza.env.template /etc/cadenza.env
sudo nano /etc/cadenza.env   # incollare i secrets dal password manager

# 5. Creazione DB vuoto + restore
sudo -u postgres createdb -E UTF8 -l C -T template0 aulabook
node backend/scripts/restore.js /tmp/backup-YYYY-MM-DD-HHmm.tar.gz --yes

# 6. systemd unit + start
sudo cp deploy/cadenza.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cadenza

# 7. Smoke test (§6) + comunicazione "servizio ripristinato"
```

**Tempo atteso**: 30 min se cloud-init pronto + offsite raggiungibile. 60 min se setup manuale.

### 5.3 Scenario D — Upgrade Postgres (es. 16 → 18)

```bash
# Su server vivo, con doppia installazione PG 16 + PG 18
sudo systemctl stop cadenza
PGPASSWORD=$DB_PASSWORD /usr/lib/postgresql/16/bin/pg_dump \
  -h localhost -p 5432 -U cadenza -d aulabook --no-owner --no-acl --clean --if-exists \
  -f /tmp/migration.sql

sudo -u postgres /usr/lib/postgresql/18/bin/createdb -E UTF8 -l C -T template0 aulabook_v18
PGPASSWORD=$DB_PASSWORD /usr/lib/postgresql/18/bin/psql \
  -h localhost -p 5433 -U cadenza -d aulabook_v18 -f /tmp/migration.sql

# Aggiorna DB_PORT in /etc/cadenza.env, restart
sudo systemctl start cadenza
```

### 5.4 Scenario E — Migrazione SQLite → Postgres

Esecuzione: l'app gestisce automaticamente la creazione del nuovo schema su Postgres tramite Sequelize. Per migrare i dati:

1. Backup SQLite tramite UI admin (o `npm run backup`)
2. Setup nuovo Postgres + DB vuoto con encoding/locale come §5.2 step 5
3. Cambiare `DB_DIALECT=postgres` in `.env`, avviare il backend con `DB_SYNC_MODE=safe` → crea schema vuoto
4. Caricare i dati via script di import dedicato (vedi `docs/MIGRATIONS.md`) — **non** usare `psql -f` su un dump SQLite (dialetti incompatibili)

### 5.5 Scenario F — Compromissione

```
1. ISOLARE il server (chiudere porte 22/80/443 dal firewall, NON spegnere — perderesti volatile state per forensics)
2. SNAPSHOT del filesystem (LVM snapshot o dd dell'intero disco) → archivio offline
3. NOTIFICARE DPO entro 72h (GDPR art. 33) anche se il leak è solo "potenziale"
4. Provisioning di un server pulito (§5.2)
5. Restore SOLO da backup precedenti alla compromissione (verificare timeline tramite audit_log)
6. ROTAZIONE delle credenziali (MANDATORIA):
   - JWT_SECRET (forza logout di tutti gli utenti — desiderato)
   - DB_PASSWORD
   - Tutti i password admin → reset forzato + 2FA enabled
   - Token OAuth Google/Microsoft (revoca da console provider)
   - SENTRY_DSN se sospetti che sia stato esfiltrato (riemetti su sentry.io)
7. Forensics: analisi audit_log, log Nginx/Apache, journalctl backend
8. Comunicazione utenti se confermato data breach (entro tempo dettato dal GDPR)
```

> Cadenza è già provvisto di audit log append-only con anonimizzazione SHA-256 (vedi `docs/SECURITY.md`). In caso di breach, audit_log è la fonte di verità per ricostruire l'attività dell'attaccante.

### 5.6 PITR — Restore granulare al secondo (v1.10.0)

**Quando**: utile per scenari A/B (corruzione DB / cancellazione accidentale) quando il backup di mezzanotte è troppo vecchio rispetto al momento dell'incidente. Esempio classico: alle 14:32 un admin scrive `DELETE FROM bookings` senza WHERE; con PITR puoi tornare alle 14:31:55 e perdere solo 5 secondi di lavoro invece di 14 ore.

**Pre-requisito**: WAL archiving abilitato in produzione tramite `scripts/setup-wal-archiving.sh` (v1.10.0). Verificabile con:

```bash
sudo -u postgres psql -c "SHOW archive_mode;"       # deve dire "on"
sudo -u postgres psql -c "SELECT archived_count, failed_count, last_archived_time FROM pg_stat_archiver;"
```

Se `archive_mode = off`, il PITR non è disponibile per quel periodo — segui §5.1 (restore standard al backup precedente) e attiva WAL archiving per il futuro.

**Procedura PITR sintetica** (per il completo: pgBackRest o Barman raccomandati):

```bash
# 1. Identifica il timestamp target (poco PRIMA dell'incidente)
#    Esempio: incidente alle 14:32:18 → target = 14:31:55
TARGET="2026-05-15 14:31:55+02"

# 2. Identifica il backup full piu' vicino PRIMA del target
ls -la /home/cadenza/backups/ | grep "2026-05-15"     # cerca quello delle 02:30

# 3. Crea una recovery dir vuota (NON sovrascrivere $PGDATA finche' non sei sicuro)
sudo mkdir -p /var/lib/postgresql/recovery
sudo chown postgres:postgres /var/lib/postgresql/recovery

# 4. Ferma Postgres
sudo systemctl stop postgresql

# 5. Restore del backup full (extract + import)
cd /tmp
sudo -u postgres tar -xzf /home/cadenza/backups/backup-2026-05-15-0230.tar.gz
sudo -u postgres psql -d postgres -c "DROP DATABASE IF EXISTS cadenza_recovery;"
sudo -u postgres createdb cadenza_recovery
sudo -u postgres psql -d cadenza_recovery -f database.sql

# 6. Configura recovery_target_time in postgresql.conf temporaneamente:
#    restore_command = 'rclone copyto <remote>:Cadenza/wal/%f %p'
#    recovery_target_time = '2026-05-15 14:31:55+02'
#    recovery_target_action = 'promote'

# 7. Avvia Postgres in modalita' recovery, lasciagli applicare i WAL fino al target
sudo systemctl start postgresql

# 8. Verifica che il DB sia tornato al timestamp target
sudo -u postgres psql -d cadenza_recovery -c "SELECT MAX(created_at) FROM bookings;"

# 9. Se OK, swap di nome (rinominare cadenza_recovery -> cadenza) e riavvio backend
```

**Strumenti consigliati per setup mature**: `pgBackRest` (gestisce base + WAL + retention + integrity check in un solo tool), `Barman` (focus su orchestrazione enterprise). Per Cadenza scale (singolo Conservatorio) la procedura manuale sopra è sufficiente.

**RPO con PITR attivo**: pari ad `archive_timeout` (default 60s) — i WAL vengono flushati al remote anche se la transazione corrente non riempie un segmento intero. **RTO**: stesso del restore standard + tempo di apply dei WAL fra l'ultimo full e il target (~secondi per ogni 16MB di WAL).

---

## 6. Smoke test post-restore (5 minuti)

Eseguire **sempre** dopo ogni restore, prima di considerare il servizio "live":

| #   | Cosa testare                      | Come                                              | Atteso                        |
| --- | --------------------------------- | ------------------------------------------------- | ----------------------------- |
| 1   | Backend risponde                  | `curl https://cadenza.example.it/api/health`      | `200 OK`                      |
| 2   | DB raggiungibile dal backend      | `curl https://cadenza.example.it/api/health/db`   | `{ ok: true }`                |
| 3   | Login admin funziona              | login con admin via UI                            | dashboard caricata            |
| 4   | Lista prenotazioni recenti        | `/admin/bookings`                                 | conteggio coerente con backup |
| 5   | Lista utenti                      | `/admin/users`                                    | conteggio coerente            |
| 6   | Audit log accessibile             | `/admin/audit`                                    | ultime entry visibili         |
| 7   | Anti-overlap funziona             | tentare doppia prenotazione in stessa aula/orario | rifiuto con errore esplicito  |
| 8   | Uploads (loghi istituto) caricano | `/admin/institutes`                               | logo visibile                 |
| 9   | Scheduler backup attivo           | `/admin/backups`                                  | "prossimo run" valorizzato    |
| 10  | Sentry riceve eventi              | `POST /api/admin/_sentry/test` (se DSN attivo)    | `eventId` su sentry.io        |

Se uno qualunque dei 10 test fallisce: **non dichiarare il servizio ripristinato** — investigare prima.

---

## 7. Esercitazione DR (drill) — risultati

### 7.1 Drill 2026-04-30 (baseline)

**Obiettivo**: validare che da un archivio backup è possibile ricostruire un DB Postgres funzionante e self-consistent, e misurare RTO.

**Procedura**: restore non-distruttivo in DB sandbox separato (`cadenza_dr_sandbox`), nessun impatto su prod.

```bash
# Setup
LATEST=$(ls -t backups/backup-*.tar.gz | head -1)   # backup-2026-04-30-0714.tar.gz (280 KB)
STAGING=$(mktemp -d)

# Phase 1: estrazione
tar -xzf "$LATEST" -C "$STAGING"

# Phase 2: creazione sandbox DB (encoding/locale come prod)
psql -d postgres -c "CREATE DATABASE cadenza_dr_sandbox WITH ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;"

# Phase 3: restore
psql -d cadenza_dr_sandbox -f "$STAGING/database.sql"

# Phase 4: validazione conteggi
psql -d cadenza_dr_sandbox -c "SELECT count(*) FROM bookings;"
# … etc per tutte le tabelle critiche

# Phase 5: integrità FK (loop su tutti i FK constraint, conta orphans)
# (vedi script completo in §7.2)

# Phase 6: cleanup
psql -d postgres -c "DROP DATABASE cadenza_dr_sandbox;"
```

**Risultati misurati 2026-04-30 07:14**:

| Metrica                                                 | Valore                                                          |
| ------------------------------------------------------- | --------------------------------------------------------------- |
| Archivio testato                                        | `backup-2026-04-30-0714.tar.gz` (280 KB)                        |
| Phase 1 — extract tar.gz                                | **0.03s**                                                       |
| Phase 2 — CREATE DATABASE                               | **0.37s**                                                       |
| Phase 3 — psql -f restore (5252 righe SQL)              | **0.33s**                                                       |
| Phase 4 — validazione conteggi                          | **0.06s**                                                       |
| Phase 5 — FK integrity (34 constraint × loop)           | **0.20s**                                                       |
| **RTO totale (DB-only)**                                | **0.99s**                                                       |
| Tabelle ripristinate                                    | 37/37 ✓                                                         |
| Indici ripristinati                                     | 122 ✓                                                           |
| FK constraint ripristinate                              | 34 ✓                                                            |
| FK violation rilevate                                   | **0** ✓                                                         |
| CHECK constraint ripristinate                           | 278 ✓                                                           |
| EXCLUDE constraint anti-overlap (`bookings_no_overlap`) | preservata ✓                                                    |
| Conteggio righe (snapshot)                              | users:2 · institutes:1 · rooms:41 · bookings:629 · audit_log:19 |

**Esito**: ✅ **PASS** — il backup è restorable, integro, self-consistent. RTO < 1s su archivio piccolo lascia margine ampio per istituti con migliaia di prenotazioni.

**Considerazioni**:

- Il campione testato è piccolo (280 KB, 629 prenotazioni). Su istituti con storia di 5 anni e ~100k prenotazioni, l'archivio sarà 50–100 MB e l'RTO atteso è ~10–30s — comunque sotto i target di 5 min.
- Phase 2 (createdb) ha richiesto specificare `ENCODING UTF8 LC_COLLATE C LC_CTYPE C` perché il cluster di test aveva default `it_IT.ISO8859-15`. **Lezione**: il runbook §5.2 (total loss) deve riportare esattamente quegli args, già aggiornato.
- L'archivio contiene 7 file uploads + manifest + dump = struttura conforme alla specifica `backup.js`.

### 7.2 Script di drill riutilizzabile

Implementato in [`backend/scripts/dr-drill.sh`](../backend/scripts/dr-drill.sh):

```bash
# Drill sull'ultimo backup disponibile (default)
bash backend/scripts/dr-drill.sh

# Drill su un archivio specifico
bash backend/scripts/dr-drill.sh /opt/cadenza/backups/backup-2026-04-29-0230.tar.gz

# Drill mantenendo il sandbox DB per ispezione manuale (debug)
bash backend/scripts/dr-drill.sh --keep-sandbox
```

Lo script:

1. Estrae l'archivio in `/tmp` staging
2. Crea il DB sandbox `cadenza_dr_sandbox` (encoding UTF8, locale C — compatibile con dump di prod)
3. Esegue il restore via `psql -f`
4. Valida conteggi tabelle, indici, FK constraint, CHECK constraint
5. Loop su tutti i FK constraint per verificare 0 orphan rows
6. Verifica che l'EXCLUDE constraint anti-overlap (`bookings_no_overlap`) sia preservato
7. Stampa l'RTO misurato per fase + totale
8. **Droppa automaticamente il sandbox** al termine (anche su errore, via `trap EXIT`)

Exit code: `0` se PASS, `1` se ci sono FK violation. **Non tocca mai il DB di produzione**: il sandbox è un DB separato con nome dedicato.

Il drill può essere schedulato in CI o cron come "canary" del backup:

```cron
# crontab — drill mensile, alert se fallisce
30 3 1 * * cd /opt/cadenza && bash backend/scripts/dr-drill.sh > /var/log/cadenza-dr-drill.log 2>&1 || mail -s "DR drill FAIL" admin@conservatorio.it < /var/log/cadenza-dr-drill.log
```

---

## 8. Cadenza ricorrente del DR drill

| Trigger                                                     | Cosa fare                                             | Chi                       |
| ----------------------------------------------------------- | ----------------------------------------------------- | ------------------------- |
| **Trimestrale** (1°/4°/7°/10° mese, ogni 15)                | Drill sandbox §7.2 + verifica RTO ancora < target     | Admin di sistema          |
| **Dopo release maggiore** (cambio schema DB)                | Drill + smoke test §6                                 | Admin + sviluppo          |
| **Dopo cambio infrastruttura** (upgrade VPS, migrazione PG) | Drill + scenario D                                    | Admin                     |
| **Annuale**                                                 | Drill scenario C completo (total loss) su VPS staging | Admin + Direttore (firma) |

> Suggerimento operativo: schedulare un evento ricorrente nel calendario del Direttore (o un task ricorrente sul gestionale del Conservatorio) il **15 di gennaio/aprile/luglio/ottobre**.

---

## 9. Comandi rapidi (cheat-sheet)

```bash
# Vedere ultimi backup disponibili
ls -lht /opt/cadenza/backups/ | head

# Verificare integrità di un archivio (senza estrarre)
gzip -t backup-YYYY-MM-DD-HHmm.tar.gz

# Vedere il manifest di un archivio
tar -xzOf backup-YYYY-MM-DD-HHmm.tar.gz manifest.json

# Restore CLI (interattivo)
cd /opt/cadenza/backend && node scripts/restore.js <archivio>

# Stop / start backend
sudo systemctl stop cadenza
sudo systemctl start cadenza
sudo systemctl status cadenza

# Tail logs
sudo journalctl -u cadenza -f

# Lista DB Postgres
sudo -u postgres psql -c "\l"

# Snapshot manuale del DB live
PGPASSWORD=$DB_PASSWORD pg_dump -h localhost -U $DB_USER -d $DB_NAME \
  --no-owner --no-acl -f /tmp/snap-$(date +%Y%m%d-%H%M).sql
```

---

## 10. Riferimenti

- Backup setup: [`docs/BACKUP.md`](./BACKUP.md)
- Schema migrations: [`docs/MIGRATIONS.md`](./MIGRATIONS.md)
- Sicurezza: [`docs/SECURITY.md`](./SECURITY.md)
- Sentry monitoring: [`docs/SENTRY_SETUP.md`](./SENTRY_SETUP.md)
- Backup script: [`backend/scripts/backup.js`](../backend/scripts/backup.js)
- Restore script: [`backend/scripts/restore.js`](../backend/scripts/restore.js)
- Postgres docs `pg_dump`: https://www.postgresql.org/docs/current/app-pgdump.html

---

## 11. Footer del drill

Ogni volta che esegui il drill, aggiorna questa sezione:

| Data       | Operatore    | Scenario                               | Esito   | RTO misurato | Note                                         |
| ---------- | ------------ | -------------------------------------- | ------- | ------------ | -------------------------------------------- |
| 2026-04-30 | Danilo Russo | Drill sandbox §7 (scenario A simulato) | ✅ PASS | 0.99s        | Baseline; archivio 280 KB / 629 prenotazioni |
|            |              |                                        |         |              |                                              |
|            |              |                                        |         |              |                                              |

---

_Cadenza · Disaster Recovery Runbook v1.0 · 30 aprile 2026 · Danilo Russo_

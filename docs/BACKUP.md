# Cadenza · Backup & Restore

> Procedura di backup automatico del database e dei file caricati
> (logo istituto e altri uploads) con strategia di rotazione,
> **scheduler interno**, **interfaccia admin per restore** e
> upload remoto opzionale.

## Sommario

- [Cosa viene salvato](#cosa-viene-salvato)
- [Scheduler interno (default)](#scheduler-interno-default)
- [Interfaccia admin](#interfaccia-admin)
- [Esecuzione manuale](#esecuzione-manuale)
- [Schedulazione esterna (alternativa)](#schedulazione-esterna-alternativa)
  - [cron Linux/macOS](#cron-linuxmacos)
  - [systemd timer](#systemd-timer)
  - [launchd macOS](#launchd-macos)
- [Restore](#restore)
- [API admin](#api-admin)
- [Strategia di rotazione](#strategia-di-rotazione)
- [Upload remoto](#upload-remoto)
  - [Amazon S3 / S3-compatible (Backblaze B2, MinIO, Wasabi)](#amazon-s3--s3-compatible-backblaze-b2-minio-wasabi)
  - [Hetzner Storage Box (rsync su SSH)](#hetzner-storage-box-rsync-su-ssh)
  - [Dropbox / Google Drive / OneDrive (rclone)](#dropbox--google-drive--onedrive-rclone)
  - [Crittografia con GPG](#crittografia-con-gpg)
- [Best practice](#best-practice)

---

## Cosa viene salvato

Ogni backup è un singolo archivio `backups/backup-YYYY-MM-DD-HHmm.tar.gz` che contiene:

| File / cartella                  | Origine                                                     | Note                               |
| -------------------------------- | ----------------------------------------------------------- | ---------------------------------- |
| `conservatory.sqlite` _(SQLite)_ | snapshot atomico via `VACUUM INTO`                          | sicuro anche con app in esecuzione |
| `database.sql` _(Postgres)_      | output di `pg_dump --no-owner --no-acl --clean --if-exists` | importabile con `psql -f`          |
| `uploads/`                       | `backend/uploads/`                                          | logo istituto e altri upload       |
| `manifest.json`                  | metadata: dialect, createdAt, app version                   | usato dal restore per detection    |

L'archivio è **gzippato** (livello default 6). Su un'istanza dimostrativa ~60 KB, in produzione tipicamente 1-50 MB.

## Scheduler interno (default)

Dalla versione corrente il backend include uno **scheduler in-process** che esegue automaticamente `performBackup()` una volta al giorno, **senza richiedere cron / systemd / launchd esterni**. È sufficiente che il backend sia in esecuzione (o riavviato dal process manager). Lo scheduler:

- Si avvia in `server.js` insieme a `retentionScheduler`.
- Calcola al boot il prossimo orario pianificato (default **02:30** locali) e schedula il primo `setTimeout`.
- Dopo ogni run pianifica il successivo a +24h.
- È **single-flight**: un nuovo tick è ignorato se uno è ancora in corso.
- Tracking dell'ultimo esito (`lastRun.ok` / `lastRun.error`) esposto via `/api/admin/backups/scheduler-status` e nel banner della pagina admin.

### Variabili d'ambiente

| Variabile              | Default | Significato                                                                                   |
| ---------------------- | ------- | --------------------------------------------------------------------------------------------- |
| `BACKUP_AUTO_ENABLED`  | `true`  | Imposta `false` per disabilitare lo scheduler interno (utile se usi cron esterno)             |
| `BACKUP_TICK_HOUR`     | `2`     | Ora locale in cui eseguire il backup quotidiano (0–23)                                        |
| `BACKUP_TICK_MINUTE`   | `30`    | Minuto                                                                                        |
| `AUTO_RESTART_ENABLED` | `false` | Se `true`, abilita l'endpoint `/api/admin/backups/restart` (richiede process manager esterno) |

> Se hai un process manager (systemd/pm2) che riavvia il backend in automatico, puoi tranquillamente esporre l'endpoint `restart` per applicare uno schema aggiornato dopo il restore.

## Interfaccia admin

La pagina **`/admin/backups`** (solo ruolo `admin`) consente di gestire interamente il backup dal browser:

- **Stato scheduler**: attivo/disabilitato, prossimo run, ultimo esito (file + dimensione + timestamp, oppure errore).
- **Backup adesso**: crea un archivio sincrono on-demand (utile prima di interventi rischiosi).
- **Lista backup disponibili**: file, data, dimensione; per ciascuno azioni download / ripristina / elimina.
- **Carica backup esterno**: upload `.tar.gz` (≤ 200 MB) per portare in admin un archivio creato altrove.
- **Restore con conferma esplicita**: dialog di conferma con stringa `RESTORE`, **snapshot di sicurezza pre-restore** automatico, poi sostituzione di DB + cartella `uploads/`.
- **Riavvio backend** _(opzionale, se `AUTO_RESTART_ENABLED=true`)_: terminazione del processo per consentire al process manager di rilanciare con il DB ripristinato.

> Tutte le operazioni sono tracciate in `audit_log` (rotta admin, append-only).

## Esecuzione manuale

```bash
cd backend
npm run backup
```

Output di esempio:

```
[backup] inizio · destinazione: /…/conservatory-app/backups
[backup] ✓ backup-2026-04-25-2358.tar.gz (0.06 MB · 0.2s)
[backup] rimossi 0 file obsoleti dalla rotazione
```

### Variabili d'ambiente opzionali

| Variabile                         | Default             | Significato                           |
| --------------------------------- | ------------------- | ------------------------------------- |
| `BACKUP_DIR`                      | `<project>/backups` | Cartella destinazione                 |
| `BACKUP_KEEP_DAILY`               | `30`                | Quanti backup giornalieri mantenere   |
| `BACKUP_KEEP_WEEKLY`              | `12`                | Quanti backup settimanali             |
| `BACKUP_KEEP_MONTHLY`             | `12`                | Quanti backup mensili                 |
| `DB_DIALECT`                      | `sqlite`            | `sqlite` o `postgres` (autodetection) |
| `DB_HOST/PORT/USER/PASSWORD/NAME` | —                   | Solo per Postgres                     |

## Schedulazione esterna (alternativa)

> Lo **scheduler interno** descritto sopra è il default e **basta a sé stesso** in quasi tutti i casi. Le ricette qui sotto sono utili solo se vuoi disabilitare lo scheduler interno (`BACKUP_AUTO_ENABLED=false`) e gestire la pianificazione fuori dal processo Node — ad esempio per centralizzare logging in `journalctl`, integrare con `healthchecks.io`, o per chi non lascia il backend sempre acceso.

### cron (Linux/macOS)

Esegui un backup giornaliero alle 03:00 (ora locale del server):

```bash
crontab -e
```

Aggiungi:

```cron
# Cadenza — backup giornaliero alle 03:00
0 3 * * * cd /path/to/conservatory-app/backend && /usr/bin/npm run backup >> /var/log/cadenza-backup.log 2>&1
```

Verifica che `node` e `npm` siano nel PATH del cron:

```cron
PATH=/usr/local/bin:/usr/bin:/bin
```

oppure usa percorsi assoluti:

```cron
0 3 * * * cd /path/to/conservatory-app/backend && /usr/local/bin/node scripts/backup.js >> /var/log/cadenza-backup.log 2>&1
```

### systemd timer

Crea due unit file (più moderno di cron):

`/etc/systemd/system/cadenza-backup.service`

```ini
[Unit]
Description=Cadenza backup giornaliero

[Service]
Type=oneshot
WorkingDirectory=/srv/cadenza/backend
ExecStart=/usr/bin/node scripts/backup.js
User=cadenza
Environment=NODE_ENV=production
Environment=BACKUP_DIR=/var/backups/cadenza
StandardOutput=journal
StandardError=journal
```

`/etc/systemd/system/cadenza-backup.timer`

```ini
[Unit]
Description=Cadenza — esegui backup giornalmente alle 03:00

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

Attivazione:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cadenza-backup.timer
sudo systemctl list-timers cadenza-backup.timer
sudo journalctl -u cadenza-backup.service --since today
```

### launchd (macOS)

`~/Library/LaunchAgents/local.cadenza.backup.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>local.cadenza.backup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/npm</string>
    <string>run</string>
    <string>backup</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/me/conservatory-app/backend</string>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>/Users/me/Library/Logs/cadenza-backup.log</string>
  <key>StandardErrorPath</key><string>/Users/me/Library/Logs/cadenza-backup.log</string>
</dict></plist>
```

Carica:

```bash
launchctl load ~/Library/LaunchAgents/local.cadenza.backup.plist
launchctl list | grep cadenza
```

---

## Restore

Sono disponibili **due flussi** equivalenti:

### A) Restore da interfaccia admin (consigliato)

1. Vai a **`/admin/backups`** come amministratore.
2. Individua il backup nella lista (oppure caricane uno con **Carica backup esterno**).
3. Clicca **Ripristina** → conferma scrivendo `RESTORE` nel dialog.
4. Il backend esegue **prima** uno _snapshot pre-restore_ di sicurezza, **poi** sostituisce DB + `uploads/`.
5. Una card di esito mostra il nome dello snapshot pre-restore (per rollback) e un pulsante **Riavvia il backend** (se `AUTO_RESTART_ENABLED=true`).

> Lo snapshot pre-restore viene salvato come backup normale: in caso di errore puoi ripristinarlo immediatamente dalla stessa lista.

### B) Restore da CLI (fallback / disaster recovery)

⚠ **Ferma il backend prima di eseguire il restore CLI.**

```bash
cd backend
npm run restore -- /path/to/backup-2026-04-25-0300.tar.gz
```

Lo script:

1. Estrae l'archivio in una cartella temporanea
2. Legge `manifest.json` per riconoscere il dialect (sqlite/postgres)
3. Chiede conferma esplicita (digita `RESTORE`); per saltarla aggiungi `--yes`
4. Rinomina il DB attuale come `conservatory.sqlite.pre-restore-<timestamp>` (rollback safety)
5. Sostituisce DB + cartella `uploads/`

Per Postgres serve `psql` nel PATH e le stesse env del backup.

## API admin

Tutte le rotte sono protette da `requireRole('admin')` e lasciano traccia in `audit_log`.

| Metodo   | Path                                    | Risposta / Note                                                                        |
| -------- | --------------------------------------- | -------------------------------------------------------------------------------------- |
| `GET`    | `/api/admin/backups`                    | `{ backups: [{file, sizeBytes, createdAt, modifiedAt}], backupDir, scheduler: {...} }` |
| `GET`    | `/api/admin/backups/scheduler-status`   | Solo lo stato dello scheduler (per polling leggero)                                    |
| `POST`   | `/api/admin/backups/now`                | `{ file, sizeBytes, dialect, kept, deleted }` (sincrono)                               |
| `POST`   | `/api/admin/backups/upload`             | `multipart/form-data` con field `file` (`.tar.gz`, ≤ 200 MB)                           |
| `GET`    | `/api/admin/backups/:filename/download` | streaming download                                                                     |
| `DELETE` | `/api/admin/backups/:filename`          | `{ ok: true }`                                                                         |
| `POST`   | `/api/admin/backups/:filename/restore`  | richiede `body.confirm === 'RESTORE'`; crea snapshot pre-restore + ripristina          |
| `POST`   | `/api/admin/backups/restart`            | `503` se `AUTO_RESTART_ENABLED!=='true'`; altrimenti `process.exit(0)` con delay 500ms |

Esempio test:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@conservatorio.it","password":"Admin123!"}' \
  | jq -r .token)

# Crea backup on-demand
curl -s -X POST http://localhost:3000/api/admin/backups/now \
  -H "Authorization: Bearer $TOKEN" | jq

# Stato scheduler
curl -s http://localhost:3000/api/admin/backups/scheduler-status \
  -H "Authorization: Bearer $TOKEN" | jq

# Restore con conferma esplicita (CAUTION!)
curl -s -X POST http://localhost:3000/api/admin/backups/backup-2026-04-25-0300.tar.gz/restore \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"confirm":"RESTORE"}' | jq
```

---

## Strategia di rotazione

Ad ogni esecuzione, dopo aver creato il nuovo file, lo script **mantiene**:

- Un backup **per ogni giorno**, per gli ultimi `BACKUP_KEEP_DAILY` (default 30)
- Un backup **per ogni settimana ISO**, per le ultime `BACKUP_KEEP_WEEKLY` (default 12)
- Un backup **per ogni mese**, per gli ultimi `BACKUP_KEEP_MONTHLY` (default 12)

Tutti gli altri vengono eliminati. Tipicamente con backup giornaliero rimangono ~30 + alcuni weekly/monthly distinti = **~50-55 file** stabili a regime.

> Se esegui più backup nello stesso minuto, il file più recente sostituisce il precedente (stesso filename `backup-YYYY-MM-DD-HHmm.tar.gz`).

---

## Upload remoto

Il modo più semplice è eseguire `npm run backup` e **subito dopo** sincronizzare la cartella `backups/` su uno storage remoto.

### Amazon S3 / S3-compatible (Backblaze B2, MinIO, Wasabi)

Con `awscli` v2 (funziona su qualunque endpoint S3-compatible passando `--endpoint-url`):

```bash
# Setup credenziali
aws configure        # (oppure variabili AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)

# Sync (incrementale, elimina i file rimossi localmente)
aws s3 sync /var/backups/cadenza/ s3://my-bucket/cadenza/ --delete \
  --storage-class STANDARD_IA
```

**Backblaze B2** (compatibile S3):

```bash
aws s3 sync /var/backups/cadenza/ s3://my-b2-bucket/cadenza/ \
  --endpoint-url=https://s3.eu-central-003.backblazeb2.com \
  --delete
```

**MinIO** (self-hosted):

```bash
aws s3 sync /var/backups/cadenza/ s3://my-bucket/cadenza/ \
  --endpoint-url=https://minio.mio-server.it
```

Esegui dopo il backup con un wrapper:

```cron
0 3 * * * cd /srv/cadenza/backend && npm run backup && aws s3 sync /var/backups/cadenza/ s3://my-bucket/cadenza/ --delete >> /var/log/cadenza-backup.log 2>&1
```

### Hetzner Storage Box (rsync su SSH)

Hetzner Storage Box supporta SFTP/rsync nativamente.

```bash
# Genera una chiave SSH dedicata
ssh-keygen -t ed25519 -f ~/.ssh/hetzner_storagebox -N ""
# Carica la chiave su Storage Box (UI o ssh-copy-id)
ssh-copy-id -i ~/.ssh/hetzner_storagebox.pub -p 23 u123456@u123456.your-storagebox.de

# Sync
rsync -av --delete -e "ssh -i ~/.ssh/hetzner_storagebox -p 23" \
  /var/backups/cadenza/ \
  u123456@u123456.your-storagebox.de:./cadenza/
```

In cron:

```cron
0 3 * * * /srv/cadenza/scripts/backup-and-push.sh >> /var/log/cadenza-backup.log 2>&1
```

dove `backup-and-push.sh` è:

```bash
#!/usr/bin/env bash
set -e
cd /srv/cadenza/backend
npm run backup
rsync -av --delete -e "ssh -i ~/.ssh/hetzner_storagebox -p 23" \
  /var/backups/cadenza/ u123456@u123456.your-storagebox.de:./cadenza/
```

### Dropbox / Google Drive / OneDrive (rclone)

[rclone](https://rclone.org/) è uno strumento universale che supporta 50+ provider cloud con la stessa CLI.

```bash
# Installazione (Linux/macOS)
curl https://rclone.org/install.sh | sudo bash

# Setup interattivo (una tantum, configura "remote" per ogni provider)
rclone config
#   n) New remote
#   name> cadenza-dropbox    (o cadenza-gdrive, cadenza-onedrive)
#   Storage> dropbox          (o drive, onedrive)
#   …segue OAuth nel browser
```

Sync verso ciascuno:

```bash
# Dropbox
rclone sync /var/backups/cadenza/ cadenza-dropbox:Backup/Cadenza --transfers=4

# Google Drive
rclone sync /var/backups/cadenza/ cadenza-gdrive:Backup/Cadenza

# OneDrive
rclone sync /var/backups/cadenza/ cadenza-onedrive:Backup/Cadenza
```

Aggiungi `--bwlimit 5M` per limitare la banda, `-v` per verbose.

In cron, con upload a 3 destinazioni in parallelo:

```bash
#!/usr/bin/env bash
set -e
cd /srv/cadenza/backend && npm run backup
rclone sync /var/backups/cadenza/ cadenza-dropbox:Backup/Cadenza &
rclone sync /var/backups/cadenza/ cadenza-gdrive:Backup/Cadenza &
rclone sync /var/backups/cadenza/ cadenza-onedrive:Backup/Cadenza &
wait
```

### Crittografia con GPG

Il backup contiene il DB completo: nomi utente, email, hash password (bcrypt), prenotazioni. Se carichi su cloud terzi è **buona pratica cifrare** prima dell'upload.

Setup:

```bash
gpg --gen-key      # crea chiave RSA con passphrase
# Esporta la public key per usarla anche su altri server
gpg --export -a "Backup Cadenza" > backup-pubkey.asc
```

Wrapper di backup + cifratura + upload:

```bash
#!/usr/bin/env bash
set -e
cd /srv/cadenza/backend
npm run backup
LATEST=$(ls -t /var/backups/cadenza/backup-*.tar.gz | head -1)
gpg --encrypt --recipient "Backup Cadenza" --output "${LATEST}.gpg" "$LATEST"
rclone sync /var/backups/cadenza/ cadenza-gdrive:Backup/Cadenza --include "*.gpg"
```

Per il restore:

```bash
gpg --decrypt backup-2026-04-25-0300.tar.gz.gpg > backup-2026-04-25-0300.tar.gz
npm run restore -- backup-2026-04-25-0300.tar.gz
```

> **Conserva la passphrase GPG fuori dal server**, ad esempio in un password manager o in cassaforte. Senza quella, i backup sono illeggibili.

---

## Best practice

- **Test periodico del restore**: una volta al mese, ripristina su un ambiente di staging e verifica che l'app si avvii e i dati siano coerenti. Un backup non testato non è un backup.
- **3-2-1 rule**: 3 copie dei dati, su 2 supporti diversi, di cui 1 off-site (cloud).
- **Monitoring**: in caso di errore, fai uscire un alert (`mailx`, healthchecks.io, ntfy, ecc.). Esempio:
  ```bash
  npm run backup || curl -fsS -m 10 --retry 5 \
    https://hc-ping.com/your-uuid/fail -d "$(tail -50 /var/log/cadenza-backup.log)"
  ```
- **Ritenzione cloud**: configura cycle policy lato cloud per mantenere ulteriori snapshot oltre la rotazione locale (es. su B2 mantieni anche le versioni eliminate per 30 giorni).
- **Backup separati per ambienti diversi**: dev / staging / prod su bucket distinti, con prefissi nei nomi file.
- **Mai versionare la cartella `backups/` in git**: già ignorata in `.gitignore`.

---

_Documento per Cadenza · © 2026 Danilo Russo_

# Export Excel + sync verso cloud personale (business continuity)

> Obiettivo: se Cadenza è inaccessibile (server giù, deploy fallito, rete in
> downtime), la portineria apre dal telefono un foglio Excel sempre
> aggiornato con le prenotazioni della settimana.

## Architettura — un'occhiata veloce

```
┌──────────────┐   ogni 10 min   ┌─────────────────────┐   cron + rclone   ┌──────────────┐
│   Cadenza    │ ───────────────▶│  /var/cadenza/sync  │ ────────────────▶ │   OneDrive   │
│   backend    │  scrive .xlsx   │   (cartella VPS)    │   sync 10 min     │   (cloud)    │
└──────────────┘                 └─────────────────────┘                   └──────────────┘
                                                                                  │
                                                                                  ▼
                                                                          📱 app sul telefono
                                                                             della portineria
```

**Direzione: solo Cadenza → file**. Le modifiche manuali al foglio sul cloud
NON tornano in Cadenza. Se l'app è giù e serve registrare a mano una
prenotazione, usa un foglio separato chiamato `Prenotazioni manuali (offline)`
e poi trascrivi nelle tab di Cadenza al ripristino. Niente conflict resolution
automatica = niente bug oscuri al ritorno.

---

## Setup passo-passo

### 1. Backend (Cadenza) — abilita l'export

Sul VPS, in `backend/.env`:

```bash
EXCEL_EXPORT_ENABLED=true
EXCEL_EXPORT_PATH=/var/cadenza/sync/cadenza-prenotazioni.xlsx
EXCEL_EXPORT_TICK_MIN=10
EXCEL_EXPORT_LOOKAHEAD_DAYS=30
```

Riavvia il backend:

```bash
pm2 restart cadenza-backend
```

Verifica che lo scheduler sia partito:

```bash
pm2 logs cadenza-backend --lines 30 --nostream | grep -i excel
```

Dovresti vedere: `[excelExportScheduler] Scheduler avviato: tick ogni 10 min`.

### 2. Installa rclone (una volta sola)

```bash
curl https://rclone.org/install.sh | sudo bash
rclone version
```

### 3. Configura il remote cloud

> ⚠️ **Importante**: il config rclone va creato sotto l'utente che
> eseguirà il cron (default: `cadenza`), non sotto root. Altrimenti il
> cron non troverà il config (sta in `~/.config/rclone/rclone.conf`
> dell'utente).

```bash
sudo -u cadenza rclone config
```

Procedura guidata interattiva. Sintesi delle scelte:

1. `n` → New remote
2. Nome remote: **`cadenza-cloud`** (scegli tu, ricordatelo per dopo)
3. Storage type:
   - **OneDrive** (consumer, 5 GB gratis): `onedrive`
   - **Dropbox** (consumer, 2 GB gratis): `dropbox`
   - **pCloud** (10 GB gratis): `pcloud`
   - **Box**, **Google Drive**, ecc. funzionano tutti — vedi `rclone config`
4. Per OneDrive/Dropbox: lascia `client_id` e `client_secret` vuoti (uso "rclone test")
5. Account: `personal` (consumer) — non Workspace/Business
6. Auto-config:
   - Se sul server **hai un browser disponibile** → `y` (apre la pagina di login)
   - Se sei in SSH headless → `n` (vedi sotto, "Headless")

#### Headless (server senza browser)

Quando rclone chiede `Use auto config?` rispondi `n`. Ti darà un comando
tipo:

```
rclone authorize "onedrive"
```

Esegui quel comando **sul tuo PC** (dove rclone è installato e c'è un
browser). Si aprirà la pagina di login Microsoft/Dropbox. Dopo
l'autorizzazione il comando stampa un blob JSON. Copia-incolla quel blob
sulla console del server quando rclone te lo chiede.

### 4. Verifica il remote

Sempre come utente `cadenza`:

```bash
sudo -u cadenza rclone listremotes
# deve mostrare:  cadenza-cloud:

sudo -u cadenza rclone lsd cadenza-cloud:
# deve listare le cartelle root del tuo OneDrive/Dropbox (anche vuota va bene)
```

### 5. Setup cartella locale + cron sync

Esegui lo script (lo trovi in `scripts/setup-rclone-sync.sh` del repo):

```bash
sudo bash scripts/setup-rclone-sync.sh cadenza-cloud CadenzaBackup
```

Lo script:

- Crea `/var/cadenza/sync/` (owner `cadenza`, mode 750)
- Verifica che `cadenza-cloud:` sia raggiungibile
- Crea `/etc/cron.d/cadenza-rclone-sync` che ogni 10 min esegue
  `rclone sync /var/cadenza/sync/ cadenza-cloud:CadenzaBackup/`
- Esegue un sync di prova immediato

Output atteso:

```
✓ Cartella locale: /var/cadenza/sync (owner cadenza, mode 750)
✓ Remote raggiungibile.
✓ Cron installato: /etc/cron.d/cadenza-rclone-sync (ogni 10 min)
✓ Sync di prova OK.
```

### 6. Genera il primo file da admin

Apri:

```
https://il-tuo-dominio/admin/server-settings?tab=servizi&sub=excel-export
```

- Badge dovrebbe essere **"In attesa primo export"** (verde dopo il primo tick).
- Clicca **"Rigenera ora"** → 2-3 secondi → toast verde.
- Clicca **"Scarica ora"** per scaricarlo subito sul browser, oppure aspetta
  10 min e controlla che compaia nel cloud.

### 7. Apri il file dall'app mobile

- **OneDrive**: app OneDrive → cartella `CadenzaBackup` → `cadenza-prenotazioni.xlsx`
- **Dropbox**: app Dropbox → cartella `CadenzaBackup`
- L'app mostra l'anteprima xlsx nativa (3 fogli: Prenotazioni / Griglia oggi / Info sync).

---

## Cosa contiene il file

| Foglio           | Contenuto                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Prenotazioni** | Lista flat di tutte le booking `confirmed` dei prossimi N giorni (default 30). Una riga per prenotazione: Aula, Edificio, Utente, Inizio, Fine, Tipo, Stato. |
| **Griglia oggi** | Matrice aule × slot 30 min (07:00–23:00) del giorno corrente. Comoda per la portineria: "chi c'è in aula 12 alle 15:00?". Mostra il cognome del prenotante.  |
| **Info sync**    | Quando è stato fatto l'ultimo export, durata, conteggio righe, versione.                                                                                     |

## Frequenza vs freschezza

| `EXCEL_EXPORT_TICK_MIN` | Freschezza   | Carico server | Quando                                          |
| ----------------------- | ------------ | ------------- | ----------------------------------------------- |
| **5**                   | 5 min stale  | basso         | conservatorio molto attivo, modifiche frequenti |
| **10** (default)        | 10 min stale | bassissimo    | uso normale                                     |
| **30**                  | 30 min stale | nullo         | poche prenotazioni al giorno                    |

Il sync rclone è separato (in cron OS): se vuoi sync rclone ogni 5 min
e export ogni 10, va bene. Il limite di freschezza nel cloud sarà
`max(EXCEL_EXPORT_TICK_MIN, CRON_EVERY)`.

## Costi e quote cloud

- **OneDrive personale**: 5 GB gratis. Il file pesa ~30-200 KB (1000 booking → 200 KB), zero impatto.
- **Dropbox**: 2 GB gratis. Idem.
- Nessun account aziendale o Workspace serve.

## Sicurezza

- Il file contiene cognome+nome+ruolo dei prenotanti — è dato personale. Tieni
  l'account cloud privato (non condiviso).
- `chmod 750` sulla cartella locale assicura che solo l'utente `cadenza` e il
  gruppo root possano leggerla.
- L'endpoint `/api/admin/excel-export/download` è protetto da `requireRole('admin')`.

## Disattivare l'integrazione

```bash
# Backend (smette di generare il file)
sed -i 's/^EXCEL_EXPORT_ENABLED=true/EXCEL_EXPORT_ENABLED=false/' backend/.env
pm2 restart cadenza-backend

# Sync rclone (smette di caricare sul cloud)
sudo rm /etc/cron.d/cadenza-rclone-sync

# Cancella i file accumulati sul cloud (opzionale)
rclone purge cadenza-cloud:CadenzaBackup
```

## Troubleshooting

**Il file non compare nel cloud.**

1. `pm2 logs cadenza-backend --lines 50 --nostream | grep excel` — verifica che lo scheduler giri.
2. `ls -la /var/cadenza/sync/` — il file `cadenza-prenotazioni.xlsx` esiste?
3. `tail -50 /var/log/cadenza-rclone-sync.log` — errori di rclone?
4. `sudo crontab -u cadenza -l` oppure `cat /etc/cron.d/cadenza-rclone-sync` — cron installato?

**`exceljs` non trovato al boot.**
Esegui `cd backend && npm ci --omit=dev` sul VPS. Il modulo è in lazy-load,
quindi anche senza exceljs il backend parte: l'errore appare solo quando
clicchi "Rigenera ora" (pannello admin).

**rclone "remote not found".**
`rclone config` non è stato eseguito o il nome del remote nel cron non
combacia con quello configurato. Riesegui `rclone listremotes` per
verificare.

**Permessi negati su /var/cadenza/sync.**
Il processo PM2 gira come utente `cadenza` ma la cartella ha owner `root`.
Esegui `sudo chown -R cadenza:cadenza /var/cadenza/sync`.

---

## Vedi anche

- [`backend/services/excelExporter.js`](../backend/services/excelExporter.js) — codice export
- [`backend/services/excelExportScheduler.js`](../backend/services/excelExportScheduler.js) — cron interno
- [`scripts/setup-rclone-sync.sh`](../scripts/setup-rclone-sync.sh) — installer automatico

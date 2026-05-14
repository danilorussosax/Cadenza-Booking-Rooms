# Soak test (test di stabilità a lunga durata)

Un **soak test** è un load test a basso volume ma molto lungo (tipicamente
4–8 ore) il cui scopo NON è misurare la capacità di picco — per quello ci
sono già `kiosk-public.js`, `auth-read.js`, `booking-write.js`, `mixed.js`
nel `README.md`. Il soak serve a stanare le classi di bug che emergono
solo dopo ore di esercizio continuo:

- **leak di memoria** nel processo Node (heap che cresce monotono)
- **leak di file descriptor** (socket/file non chiusi)
- **esaurimento del pool Sequelize** o dei prepared statement Postgres
- **drift di latenza** in funzione del tempo (event-loop saturation che
  emerge solo dopo che la GC ha lavorato a lungo, o autovacuum Postgres
  che parte)

## Componenti dell'harness

| File             | Cosa fa                                                                    |
| ---------------- | -------------------------------------------------------------------------- |
| `soak.sh`        | Driver bash: orchestra k6 + sampler + tail log, poi aggrega il report      |
| `soak.js`        | Scenario k6 `constant-arrival-rate` read-heavy, durata e RPS configurabili |
| `sampler.js`     | Sampler Node: ogni 30s scrive memoria/CPU/FD/latenza ready su JSONL        |
| `soak-report.js` | Aggregatore: legge il JSONL e produce report Markdown con grafici ASCII    |

## Pre-requisiti

Sul **Mac (o macchina di test)** che lancia il soak:

```bash
brew install k6                      # iniettore di carico
node --version                       # >= 16 (per sampler + report)
```

Sul **target** (VPS o localhost dev):

- Backend in piedi su `http://localhost:3001` (default) o URL custom.
- **PM2 opzionale**: se il backend gira sotto `pm2 start ecosystem.config.js`
  con name `cadenza-backend`, il sampler raccoglie anche memoria RSS e
  CPU %. Se pm2 non c'è, raccoglie solo latenza `/api/ready` e FD count
  via `lsof` (richiede PID — solo se backend è locale e accessibile).
- **Rate limit** non è un problema: il soak gira a 5 RPS, ben sotto i
  300 req/min/IP di default. Niente bisogno di `preflight.sh on`.

## Come lanciare

```bash
cd loadtest

# Default: 4 ore vs http://localhost:3001
./soak.sh

# 1 ora vs staging
./soak.sh 1 http://staging.example.com

# 8 ore vs prod (attenzione: traffico reale aggiunto a quello degli utenti)
./soak.sh 8 http://82.165.110.193:3000

# Smoke ~36s per verificare che l'harness sia funzionante
./soak.sh 0.01
```

Variabili ambiente opzionali:

| Var               | Default           | Effetto                             |
| ----------------- | ----------------- | ----------------------------------- |
| `RPS`             | `5`               | Arrival rate costante (req/s)       |
| `SAMPLE_INTERVAL` | `30`              | Intervallo sampler in secondi       |
| `PM2_NAME`        | `cadenza-backend` | Nome del processo pm2 da monitorare |

## Output

Tutti i file vengono scritti in `loadtest/` con timestamp:

- `soak-metrics-<TS>.jsonl` — righe JSON con metriche di sistema (1 per sample)
- `soak-k6-<TS>.json` — summary k6 esportato (`--summary-export`)
- `soak-errors-<TS>.log` — righe di `pm2 logs` filtrate (`error|warn|exception|timeout|...`)
- `soak-report-<TS>.md` — report finale leggibile

Aggiungili al `.gitignore` o cancellali a fine analisi — non vanno committati.

## Come interpretare il report

Il report ha 3 sezioni chiave.

### 1. Stabilità del processo backend

Per ogni metrica vedi `min / max / Δ %`:

- **Δ < 15%** → ✓ stabile, nessun leak macroscopico
- **15% ≤ Δ ≤ 30%** → ⚠ borderline, vale la pena rilanciare un soak più lungo
- **Δ > 30%** → ⚠️ sospetto leak, investiga

### 2. Latenza `/api/ready`

Probe sintetica che tocca il DB (`SELECT 1`). Se `p95` o `p99` degradano
nel tempo (visibile dallo sparkline) e la curva è monotona crescente,
significa che il backend perde reattività con l'uso: tipicamente
event-loop saturato o pool DB stretto.

### 3. Grafici ASCII

Tre sparkline (memoria, FD, ready ms) lungo tutto il run. Cerca:

- Pattern **piatto/oscillante**: workload stabile, GC funziona, OK.
- Pattern **monotono crescente** senza ritorno: leak. Da profilare.
- **Picchi isolati**: probabile job batch (export, backup); guarda gli
  orari nel JSONL grezzo per correlare.

## Cosa fare se trovi un leak

Se la memoria cresce monotona:

```bash
# 1. Trova il PID del backend
pm2 jlist | jq -r '.[] | select(.name=="cadenza-backend") | .pid'

# 2. Profila live con clinic.js doctor (npm install -g clinic)
clinic doctor --on-port 'pm2 restart cadenza-backend' -- node backend/server.js
# poi lancia di nuovo soak.sh in parallelo, clinic aggrega la flamegraph
```

Se l'FD count cresce monotono:

```bash
# Snapshot 1
lsof -p $PID > /tmp/fd-t0.txt

# ... aspetta 30 min sotto soak ...

# Snapshot 2
lsof -p $PID > /tmp/fd-t1.txt

# Diff: i FD nuovi che NON si chiudono mai sono il leak
diff <(awk '{print $9}' /tmp/fd-t0.txt | sort -u) \
     <(awk '{print $9}' /tmp/fd-t1.txt | sort -u)
```

I sospetti più comuni in Cadenza:

- `fs.createReadStream` in export Excel/CSV senza `.close()` su errore
- `axios`/`fetch` verso Sentry/Slack con socket pool non riusato
- Sequelize che apre nuove connessioni invece di riusare il pool (verifica
  `pool.max`, `pool.acquire`, `pool.idle` in `config/database.js`)

## Limiti noti

- **Soak da una singola macchina su Internet**: i numeri di latenza
  includono RTT. Per misurare il puro server, lancia `soak.sh` dal VPS
  stesso (via SSH), così il sampler raccoglie anche memoria via pm2.
- **Niente scritture per default**: il soak è read-heavy per non sporcare
  lo stato. Se vuoi soak con `POST /api/bookings`, modifica `pickEndpoint()`
  in `soak.js` (servirà auth — vedi `lib/auth.js`).
- **`lsof` su macOS** può essere lento la prima invocazione (~1s). Il
  sampler usa un intervallo da 30s di default, quindi non impatta.
- **k6 dropped iterations**: se in coda al run vedi `dropped_iterations > 0`,
  significa che il backend non sta tenendo nemmeno 5 RPS — c'è qualcosa
  di rotto **prima** del problema di leak. Indaga quello per primo.

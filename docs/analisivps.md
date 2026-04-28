# Analisi VPS per Aula Book

Stima realistica della capacità di carico di Aula Book (backend Node.js +
Postgres co-residenti, frontend React servito come dist statica) su due
tagli VPS comuni. Le stime sono basate sulla forma reale dell'app:

- carico **prevalentemente read-only** (dashboard, display kiosk pubblico)
- write **bursty** (creazione/cancellazione prenotazioni in orari di punta)
- task background leggeri (reminder ogni 5 min, retention sweep notturno,
  backup notturno, scheduler waitlist)
- frontend è una PWA con service worker → asset statici praticamente
  azzerati come traffico verso il backend dopo il primo load.

---

## 1. VPS 2 vCPU / 4 GB RAM

### Memoria — budget

| Componente                                                  | RSS tipico           |
| ----------------------------------------------------------- | -------------------- |
| Node.js (Express + Sequelize + pool DB)                     | 250–400 MB           |
| Postgres (default `shared_buffers=128MB`, work_mem default) | 250–500 MB           |
| OS + sshd + cron + logger                                   | 200–300 MB           |
| **Baseline a riposo**                                       | **~700 MB – 1.2 GB** |
| Headroom per cache, sessioni, query work                    | **~2.5–3 GB**        |

Con `shared_buffers` alzato a 1 GB hai un Postgres molto più reattivo per
le query analytics e la weekly agenda.

### Capacità lavoro (dimensionato sui pattern reali dell'app)

| Profilo                     | OK              | Stressato | Da scalare |
| --------------------------- | --------------- | --------- | ---------- |
| Utenti registrati (DB)      | < 3 000         | 5 000     | 10k+       |
| Utenti attivi simultanei    | 80–150          | 300–500   | 800+       |
| Prenotazioni create / ora   | 100–300         | 500–800   | 1500+      |
| Richieste API totali / s    | 30–80 sustained | 150–250   | 400+       |
| Admin PDF export concurrent | 2–3             | 5–6       | >8         |

### Kiosk — display pubblico

Ogni kiosk carica `/display` una sola volta (static SPA con SW PWA → cache
locale) e poi fa polling:

| Endpoint                         | Cadenza    |
| -------------------------------- | ---------- |
| `/api/public/agenda?weekStart=…` | ogni 60 s  |
| `/api/public/stats`              | ogni 30 s  |
| `/api/public/concerts`           | ogni 5 min |
| `/api/public/announcements`      | ogni 60 s  |
| `/api/public/display-config`     | ogni 5 min |

≈ **3–4 richieste/min per kiosk**. Sono query Postgres con index su
`bookings(start_time, room_id)` quindi 5–20 ms ciascuna.

| Numero kiosk | Carico      | Note                                                                                   |
| ------------ | ----------- | -------------------------------------------------------------------------------------- |
| **20–40**    | comodo      | margine ampio per picchi e admin attivi                                                |
| **60–80**    | sostenibile | aggiungi index review e considera caching in-memory dell'agenda settimanale (TTL 30 s) |
| **100+**     | al limite   | introdurre Redis per cache `/api/public/*` e CDN per asset statici                     |

### Bottleneck residui (ordine di apparizione)

1. **Generazione PDF** (`/api/admin/analytics/export.pdf`) — pdfkit gira
   in-process, CPU-bound. Se 5+ admin esportano contemporaneamente,
   l'event loop si impalla per qualche secondo. → spostare in worker
   thread quando inizia a darti fastidio.
2. **Query `/api/admin/analytics`** — usa `EXTRACT(DOW/HOUR)` su tutto il
   set di prenotazioni del periodo. Per dataset grandi (≥ 500k bookings)
   considera materialized view aggiornata oraria.
3. **PG connection pool** — default Sequelize è 5 connessioni. Con 50
   utenti attivi va alzato a 15–25 (`pool: { max: 20 }` in
   `config/database.js`). Senza, vedrai errori
   `SequelizeConnectionAcquireTimeoutError` sotto picco.
4. **Service worker su kiosk** — già presente, riduce il traffico verso
   il server quasi azzerando le richieste static (chunk JS/CSS, immagini).

### Tuning concreti

```ini
# postgresql.conf
shared_buffers = 1GB
effective_cache_size = 2GB
work_mem = 16MB
max_connections = 80
```

```js
// backend/config/database.js
pool: { max: 20, min: 2, acquire: 10000, idle: 5000 }
```

```js
// app.js — gzip + http cache header per /assets/*
app.use(compression());
app.use('/assets', express.static(..., { maxAge: '1y', immutable: true }));
```

Aggiunta facoltativa per scalare kiosk:

- Cache in-memory delle response `/api/public/agenda` con TTL 30 s
  (un Map + setTimeout basta, niente Redis necessario sotto i 100 kiosk).

### Verdetto sintetico

Per un **conservatorio medio (~1500 utenti, 30–50 aule, 30 kiosk)** quel
VPS è **dimensionato bene** con margine. Rischi di stress reali partono
solo se simultaneamente: > 80 kiosk + > 500 utenti loggati + admin che
fanno export PDF in massa. Realisticamente non succede mai
contemporaneamente.

---

## 2. VPS 4 vCPU / 8 GB RAM

Rispetto al taglio precedente raddoppi CPU e RAM, ma il guadagno effettivo
non è lineare ovunque (Node è single-thread per l'app code; Postgres
invece parallelizza bene).

### Memoria — budget

| Componente                                  | RSS tipico      |
| ------------------------------------------- | --------------- |
| Node.js (Express + Sequelize)               | 300–500 MB      |
| Postgres con `shared_buffers=2GB`           | 1.8–2.5 GB      |
| OS + sshd + cron + logger                   | 200–300 MB      |
| **Baseline a riposo**                       | **~2.3–3.3 GB** |
| Headroom per cache PG, sessioni, query work | **~5 GB**       |

`work_mem` può salire a 32–64 MB → query analytics complete in metà tempo.

### Capacità lavoro

| Profilo                     | OK      | Stressato | Da scalare |
| --------------------------- | ------- | --------- | ---------- |
| Utenti registrati (DB)      | < 8 000 | 15 000    | 25k+       |
| Utenti attivi simultanei    | 200–400 | 700–1000  | 1500+      |
| Prenotazioni create / ora   | 300–800 | 1500–2000 | 3000+      |
| Richieste API / s sustained | 100–250 | 400–600   | 800+       |
| Admin PDF export concurrent | 5–8     | 12–15     | >20        |

### Kiosk — display pubblico

Stesso pattern di polling (~3–4 req/min per kiosk).

| Numero kiosk | Carico      | Note                                                                                                            |
| ------------ | ----------- | --------------------------------------------------------------------------------------------------------------- |
| **60–100**   | comodo      | margine ampio anche con admin attivi e backup notturni                                                          |
| **150–200**  | sostenibile | conviene aggiungere cache in-memory delle response `/api/public/*` con TTL 30 s                                 |
| **300+**     | al limite   | passare a Redis condiviso + CDN per gli asset statici, valutare cluster Node a 2 worker (PM2 con `instances=2`) |

### Cosa cambia rispetto al 2 vCPU / 4 GB

1. **PDF analytics** → puoi servire 5–8 export simultanei senza far
   balbettare l'event loop. La generazione resta single-thread per
   richiesta, ma il SO può schedularne 4 in parallelo (1 per core).
2. **Cluster mode**: con 4 core ha **senso** lanciare 2 worker Node via
   `pm2 start server.js -i 2`. Sticky session non serve (JWT stateless).
   Throughput API quasi raddoppia.

   ```bash
   pm2 start server.js -i 2 --name aulabook
   pm2 save && pm2 startup
   ```

3. **Postgres tuning** più generoso:

   ```ini
   # postgresql.conf
   shared_buffers = 2GB
   effective_cache_size = 5GB
   work_mem = 32MB
   maintenance_work_mem = 256MB
   max_connections = 150
   max_parallel_workers_per_gather = 2
   max_parallel_workers = 4
   ```

4. **Pool Sequelize**: alzalo coerentemente:

   ```js
   // backend/config/database.js
   pool: { max: 30, min: 4, acquire: 10000, idle: 5000 }
   ```

   Con 2 worker × 30 = max 60 connessioni — sotto i 150 di Postgres,
   va bene.

### Bottleneck residui (ordine di apparizione)

1. **Disk I/O della VPS** — più importante della CPU per query analytics
   su grandi dataset. Verifica che il disco sia SSD/NVMe (la quasi
   totalità dei VPS moderni lo è).
2. **`/api/admin/analytics` su dataset > 1M bookings** — `EXTRACT(DOW/HOUR)`
   con `GROUP BY` può diventare lenta. Mitigation: materialized view
   rinfrescata ogni ora.
3. **Banda di rete** — se i kiosk sono molti e in fullscreen (immagini
   concerti pesanti), 100 Mbps possono bastare ma controlla. Una
   locandina concerto da 500 KB × 60 kiosk × refresh 5 min = ~600 MB/h.
4. **Backup notturni** — il job alle 02:30 fa `pg_dump` + tar uploads.
   Su 8 GB c'è tutto lo spazio per buffer in RAM, ma su disco lascia
   almeno 20 GB liberi per il rolling backup.

### Verdetto sintetico

Per un **conservatorio grande (3000–5000 utenti, 80–120 aule, 4–6 sedi,
50–80 kiosk)** questo taglio è **abbondantemente dimensionato** con
margine per picchi (sessioni d'esame, iscrizioni). Stress reale solo
oltre 200 kiosk simultanei o 1000+ utenti loggati nello stesso momento.

Differenza pratica vs 2 vCPU/4 GB: **~2.5–3× la capacità sostenuta** (non
2× lineare grazie a `pm2 -i 2` + Postgres con più cache + `work_mem` più
alto), e tanto più stabilità sotto picchi grazie all'headroom RAM.

---

## 3. App server + Postgres su macchina separata

Configurazione "split tier": Node.js gira su una VPS, Postgres su un'altra
istanza (VPS dedicata oppure managed DB tipo DigitalOcean Managed
Postgres, AWS RDS, Aiven, Crunchy Bridge). Approccio standard quando si
vuole **isolare le risorse** ed evitare che la pressione su uno dei due
componenti degradi l'altro.

### 3.1 Vantaggi della separazione

1. **Tutta la RAM dell'app server è libera** per Node, gzip, log buffer e
   eventuale cache in-memory. Su 4 GB di app server hai ~3.3 GB
   utilizzabili (vs ~3 GB con Postgres co-residente sullo stesso taglio).
2. **Postgres tunable senza compromessi**: `shared_buffers` può
   tranquillamente essere il 30–50% della RAM dell'host DB; `work_mem`
   aggressivo per le query analytics.
3. **Scaling indipendente**: se il bottleneck è il DB (tipico con dataset
   > 1M booking) upgrade solo il DB; viceversa se è l'app (molti kiosk
   > simultanei) upgrade solo l'app server.
4. **Failure isolation**: un OOM di Node non porta giù il DB e viceversa.
5. **Backup nativi del provider** (managed Postgres) con PITR — niente
   `pg_dump` notturno da gestire.

### 3.2 Costo aggiuntivo: latenza di rete

Ogni query Node→Postgres aggiunge un round-trip di rete:

| Topologia                                                                               | Latenza tipica     |
| --------------------------------------------------------------------------------------- | ------------------ |
| Stessa rete privata, stessa region (DigitalOcean VPC, AWS VPC, Hetzner private network) | **0.3 – 1 ms**     |
| Region diversa stesso continente                                                        | 5–15 ms            |
| Region diversa transcontinentale                                                        | 50–150 ms          |
| Internet pubblico (sconsigliato)                                                        | 10–50 ms variabile |

Per Aula Book contano:

- **Endpoint normali** (1–3 query): impatto trascurabile (~1–3 ms in più).
- **Endpoint analytics** (10+ query in serie): impatto cumulato 10–30 ms.
  Niente di drammatico se sotto 1 ms per round-trip.
- **Endpoint che ciclano in JS** (es. `validateBooking` con loop su
  exception rules): se ogni iterazione fa una query, la latenza si
  somma → conviene rivedere quei loop in batch (`Op.in`).

**Regola d'oro**: app e DB **devono** stare nella stessa VPC / private
network del provider. Mai esporre Postgres su Internet pubblico.

### 3.3 Sizing consigliato

#### Variante A — small split (deployment economico)

| Macchina             | CPU    | RAM  | Disco     |
| -------------------- | ------ | ---- | --------- |
| App server (Node.js) | 2 vCPU | 4 GB | 25 GB SSD |
| DB server (Postgres) | 2 vCPU | 4 GB | 50 GB SSD |

#### Variante B — medium split (sweet spot per istituti medi)

| Macchina             | CPU    | RAM  | Disco      |
| -------------------- | ------ | ---- | ---------- |
| App server (Node.js) | 2 vCPU | 4 GB | 25 GB SSD  |
| DB server (Postgres) | 4 vCPU | 8 GB | 100 GB SSD |

#### Variante C — large split (multi-sede / kiosk > 100)

| Macchina                                   | CPU    | RAM  | Disco      |
| ------------------------------------------ | ------ | ---- | ---------- |
| App server (Node.js, PM2 cluster 2 worker) | 4 vCPU | 8 GB | 25 GB SSD  |
| DB server (Postgres)                       | 4 vCPU | 8 GB | 200 GB SSD |

### 3.4 Capacità per ciascuna variante

| Profilo                     | Var. A (2+2/4+4) | Var. B (2+4/4+8) | Var. C (4+4/8+8) |
| --------------------------- | ---------------- | ---------------- | ---------------- |
| Utenti registrati           | < 5 000          | < 10 000         | < 20 000         |
| Utenti attivi simultanei    | 150–250          | 300–500          | 500–1000         |
| Prenotazioni create / ora   | 200–500          | 500–1200         | 1200–2500        |
| Richieste API / s sustained | 60–150           | 150–350          | 350–700          |
| Kiosk comodi                | 40–60            | 80–120           | 150–250          |
| Kiosk sostenibili           | 80–100           | 150–200          | 250–400          |
| PDF export concurrent       | 3–5              | 6–10             | 10–18            |

**Notebene**: rispetto ai tagli "tutto in uno" della stessa CPU/RAM
totale, lo split tier guadagna **~20–40%** di capacità sostenibile per
via dell'eliminazione della contention RAM/CPU tra Node e Postgres.

### 3.5 Tuning Postgres su host dedicato

Su un DB server dedicato puoi usare la "regola del 25–50%":

```ini
# postgresql.conf — 4 GB RAM dedicato
shared_buffers = 1GB                  # 25% RAM
effective_cache_size = 3GB            # 75% RAM
work_mem = 32MB                       # per backend, ricorda × max_connections
maintenance_work_mem = 256MB
max_connections = 100
max_parallel_workers_per_gather = 2
max_parallel_workers = 2
random_page_cost = 1.1                # SSD/NVMe
checkpoint_completion_target = 0.9
wal_buffers = 16MB
```

```ini
# postgresql.conf — 8 GB RAM dedicato
shared_buffers = 2GB                  # 25% RAM
effective_cache_size = 6GB
work_mem = 64MB
maintenance_work_mem = 512MB
max_connections = 200
max_parallel_workers_per_gather = 4
max_parallel_workers = 4
random_page_cost = 1.1
checkpoint_completion_target = 0.9
wal_buffers = 32MB
```

E in `pg_hba.conf` aprire solo l'IP privato dell'app server:

```conf
# CIDR della rete privata del provider (es. DO VPC, AWS VPC)
hostssl  aulabook  aulabook  10.116.0.0/20  scram-sha-256
```

### 3.6 PgBouncer fortemente raccomandato

Con app server separato dal DB e workload bursty (login mattutino,
generazione QR di check-in, esami), aprire/chiudere connessioni TCP a
ogni richiesta sprecherebbe latenza. **PgBouncer in transaction mode**
risolve:

```ini
# pgbouncer.ini (sull'app server o su un mini-host laterale)
[databases]
aulabook = host=10.116.0.5 port=5432 dbname=aulabook

[pgbouncer]
listen_addr = 127.0.0.1
listen_port = 6432
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
max_client_conn = 500
default_pool_size = 25
reserve_pool_size = 5
server_reset_query = DISCARD ALL
```

Sequelize si connette a `127.0.0.1:6432` invece che al DB diretto:

```env
DATABASE_URL=postgres://aulabook:secret@127.0.0.1:6432/aulabook
```

```js
// backend/config/database.js
pool: { max: 30, min: 2, acquire: 10000, idle: 5000 }
// con PgBouncer transaction mode il pool Sequelize è poco rilevante:
// PgBouncer multipla 500 client → 25 backend reali al DB.
```

**Limiti**: in transaction mode niente prepared statements server-side e
niente `LISTEN/NOTIFY` o session GUC. Aula Book non li usa, quindi va
bene. Se in futuro userai notify (es. realtime via PG channels), passa
a session mode con pool più piccolo.

### 3.7 Quando preferire managed Postgres

Provider tipici (DO Managed PG, AWS RDS, Crunchy, Aiven, Neon, Supabase):

**Pro**:

- Backup automatici + PITR senza gestire `pg_dump`
- Failover replica integrato
- Aggiornamenti minor version automatici in finestra di manutenzione
- Monitoring e alerting già pronti
- Connection pooler integrato (RDS Proxy, DO Connection pool, ecc.)

**Contro**:

- Costo per GB e per ora **2–4×** un VPS self-managed equivalente
- Latenza più alta se il managed è in region diversa dall'app
- Meno controllo sui parametri (`shared_buffers`, estensioni custom)
- Alcune extension del progetto possono non essere disponibili
  (`btree_gist` usato in `bookings_no_overlap` è universalmente
  supportato — ✓ ok su tutti i big provider)

**Quando ha davvero senso**: oltre i 5000 utenti attivi o quando il team
non ha competenze sysadmin Postgres. Sotto, un VPS dedicato con backup
automatici già configurati dall'app (`backups` scheduler alle 02:30) è
più economico.

### 3.8 Bottleneck specifici dello split tier

1. **Saturazione banda private network**: rara. 1 Gbps interno DO/AWS
   regge migliaia di QPS. Da monitorare solo se trasferisci grandi blob
   (concert posters?) — in genere serviti dall'app server, non dal DB.
2. **Connection storm a freddo**: se l'app server riavvia, Sequelize apre
   `pool.max` connessioni in burst. PgBouncer le ammortizza; senza,
   alza `max_connections` PG.
3. **DNS lookup ripetuto**: usa l'IP privato direttamente in
   `DATABASE_URL` (non il hostname DNS) per evitare risoluzioni a
   ogni reconnect.
4. **TLS handshake**: con `hostssl` ogni connessione iniziale paga ~10 ms
   di handshake. PgBouncer mantiene il pool caldo e maschera il costo.

### 3.9 Verdetto

Lo split tier ha senso **a partire dalla Variante B** (DB con 8 GB) per
istituti medio-grandi. Sotto, il "tutto in uno" 4 vCPU / 8 GB del
capitolo precedente è più semplice e altrettanto performante per
1500–3000 utenti.

**Numeri di riferimento (rispetto al monolite 4 vCPU/8 GB)**:

- Variante A (split 2+2 / 4+4): **simile** capacità, costa più ma
  fail-isolation migliore. Sceglierla solo se vuoi managed PG.
- Variante B (split 2+4 / 4+8): **+30–40%** capacità sostenuta, ottimo
  rapporto costo/beneficio.
- Variante C (split 4+4 / 8+8 con PM2 cluster): **+100–150%** capacità,
  pronto per multi-sede e oltre 200 kiosk.

## 4. Scelta sintetica

| Scenario                                                                | Taglio consigliato                                                     |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Conservatorio piccolo: < 1000 utenti, < 20 aule, < 20 kiosk             | **2 vCPU / 4 GB monolite**                                             |
| Conservatorio piccolo/medio: < 1500 utenti, < 30 aule, < 30 kiosk       | **2 vCPU / 4 GB monolite**                                             |
| Conservatorio medio: 1500–3000 utenti, 30–60 aule, 30–60 kiosk          | **4 vCPU / 8 GB monolite**                                             |
| Conservatorio medio/grande: 3000–5000 utenti, 60–100 aule, 60–100 kiosk | **Split B**: 2+4 vCPU / 4+8 GB                                         |
| Multi-sede o > 100 kiosk e > 500 concurrent                             | **Split C**: 4+4 vCPU / 8+8 GB con PM2 cluster                         |
| > 200 kiosk e > 1000 concurrent                                         | App **8 vCPU / 16 GB** cluster + **managed Postgres** dedicato + Redis |

In tutti i casi: **SSD/NVMe**, banda ≥ 100 Mbps (1 Gbps per split tier),
snapshot periodici della VPS oltre ai backup applicativi nightly.

## 5. Pattern di traffico kiosk (riferimento)

Polling per kiosk (riepilogo):

```
agenda           ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  ogni 60 s
stats            ┄┄┄┄┄┄┄┄┄┄┄┄         ogni 30 s
concerts         ┄┄┄┄┄                ogni 5  min
announcements    ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  ogni 60 s
display-config   ┄┄┄┄┄                ogni 5  min
```

Throughput aggregato:

| Kiosk | req/min totali | req/s | Note                        |
| ----- | -------------- | ----- | --------------------------- |
| 10    | ~30–40         | < 1   | trascurabile                |
| 30    | ~100–120       | ~2    | trascurabile                |
| 60    | ~200–240       | ~4    | leggero                     |
| 100   | ~340–400       | ~6    | leggero, valutare cache     |
| 200   | ~680–800       | ~12   | medio, cache consigliata    |
| 300   | ~1000–1200     | ~18   | medio-alto, cache + cluster |

## 6. Hot endpoint da monitorare in produzione

| Endpoint                              | Tipo           | Costo                            | Mitigazione              |
| ------------------------------------- | -------------- | -------------------------------- | ------------------------ |
| `GET /api/public/agenda`              | read           | medio (join + week filter)       | cache TTL 30 s           |
| `GET /api/admin/analytics`            | read aggregato | alto (full scan + EXTRACT)       | materialized view oraria |
| `GET /api/admin/analytics/export.pdf` | CPU-bound      | alto (pdfkit render)             | worker thread / coda     |
| `POST /api/bookings`                  | write          | basso (transazione SERIALIZABLE) | nulla, già ottimizzato   |
| `POST /api/bookings/:id/checkin`      | write          | basso                            | nulla                    |

## 7. Comandi rapidi di osservabilità

```bash
# CPU / RAM live
htop

# Connessioni Postgres aperte
psql -c "SELECT count(*) FROM pg_stat_activity WHERE state='active';"

# Top 10 query più lente (richiede pg_stat_statements abilitato)
psql -c "SELECT query, calls, total_exec_time, mean_exec_time
         FROM pg_stat_statements
         ORDER BY mean_exec_time DESC LIMIT 10;"

# Backend log live (script di restart già usato dal progetto)
tail -f /tmp/aulabook-backend-$USER.log

# Health check
curl -s http://localhost:3000/api/health

# Latenza app→DB (split tier): se > 2 ms in private network c'è un problema
psql -h <DB_PRIVATE_IP> -c "SELECT 1" -At -W \
  | xargs -I{} echo "ok"; \
  time psql -h <DB_PRIVATE_IP> -c "SELECT 1" >/dev/null

# Stato pool PgBouncer
psql -h 127.0.0.1 -p 6432 pgbouncer -c "SHOW POOLS;"
psql -h 127.0.0.1 -p 6432 pgbouncer -c "SHOW STATS;"

# Buffer hit ratio Postgres (target > 99%)
psql -c "SELECT
   sum(heap_blks_read) AS reads,
   sum(heap_blks_hit) AS hits,
   round(100.0 * sum(heap_blks_hit) / NULLIF(sum(heap_blks_hit + heap_blks_read), 0), 2) AS hit_ratio
 FROM pg_statio_user_tables;"
```

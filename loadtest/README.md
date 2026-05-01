# Load test k6 per Cadenza

Quattro scenari indipendenti calibrati sulle tre fasce dell'analisi VPS
(`docs/analisivps.md`):

| File               | Cosa stressa                               | Auth | Side-effect                         |
| ------------------ | ------------------------------------------ | ---- | ----------------------------------- |
| `kiosk-public.js`  | `/api/public/*` polling kiosk              | no   | nessuno (read-only)                 |
| `auth-read.js`     | Utenti loggati in lettura                  | sì   | nessuno (read-only)                 |
| `booking-write.js` | `POST + DELETE /api/bookings` end-to-end   | sì   | bookings creati e cancellati subito |
| `mixed.js`         | I tre scenari sopra in parallelo (70/25/5) | sì   | come booking-write                  |

## 1. Prerequisiti

Sul **Mac che lancia il test**:

```bash
brew install k6
```

Sul **VPS bersaglio**, una volta sola, prima della finestra di test:

1. **Account utente di test approvato e SENZA 2FA**. NON usare account
   reali — l'audit log si riempirebbe di rumore. Crealo via UI admin
   (es. `loadtest@conservatorio.it` / password lunga).
2. **Aula bookable senza `requiresApproval`** — serve l'`id` (intero).
   Lo trovi in `/admin/structure` cliccando sull'aula. Per il test
   dedica una stanza fittizia ("Aula Loadtest") in modo da non
   inquinare il calendario reale anche se qualcosa scappa.
3. **Rate limit aumentato per la durata del test**. Il default è
   300 req/min/IP (`backend/middleware/rateLimit.js:79`); con k6 da una
   sola macchina arrivi a >> di questo. Aggiungi al `backend/.env` sul
   VPS:
   ```bash
   RATE_LIMIT_API_PER_MIN=200000
   ```
   poi `pm2 restart cadenza-backend --update-env`. **Rimettilo al
   default appena finito.** Lo script `loadtest/preflight.sh` lo fa per te.

## 2. Esecuzione

### Smoke test (read-only, sicuro in produzione)

```bash
k6 run --env BASE_URL=http://82.165.110.193:3000 \
       --env TIER=low \
       loadtest/kiosk-public.js
```

3 minuti, 15 req/s sui pubblici. Se questo fallisce, c'è un problema
base (Postgres giù, Express non risponde, rate limit non rilassato).

### Stress kiosk

```bash
k6 run --env BASE_URL=http://82.165.110.193:3000 --env TIER=high \
       loadtest/kiosk-public.js
```

7 minuti, 130 req/s. Equivale a **~80 kiosk reali** in polling continuo.

### Stress utenti loggati

```bash
export USER_EMAIL=loadtest@conservatorio.it
export USER_PASSWORD='password-molto-lunga'
k6 run --env BASE_URL=http://82.165.110.193:3000 --env TIER=medium \
       --env USER_EMAIL=$USER_EMAIL --env USER_PASSWORD=$USER_PASSWORD \
       loadtest/auth-read.js
```

### Stress scrittura prenotazioni

```bash
k6 run --env BASE_URL=http://82.165.110.193:3000 --env TIER=low \
       --env USER_EMAIL=$USER_EMAIL --env USER_PASSWORD=$USER_PASSWORD \
       --env ROOM_ID=42 \
       loadtest/booking-write.js
```

Mantieni `TIER=low` o `medium` per la write — la fascia `high` (8 req/s
sostenute di POST + DELETE = 16 req/s di scrittura) è il limite teorico
del VPS e va spinta solo se vuoi davvero rompere il pool DB.

### Workload misto realistico (consigliato)

```bash
k6 run --env BASE_URL=http://82.165.110.193:3000 --env TIER=medium \
       --env USER_EMAIL=$USER_EMAIL --env USER_PASSWORD=$USER_PASSWORD \
       --env ROOM_ID=42 \
       loadtest/mixed.js
```

Esegue i tre scenari in parallelo con il mix 70% kiosk / 25% utenti
loggati / 5% scritture. **È il test che meglio approssima un orario di
punta vero.**

## 3. Lettura dei risultati

Le tre metriche da guardare per prime, in ordine:

1. **`dropped_iterations`** — se > 0, il VPS NON sta tenendo il rate
   richiesto. k6 ha provato a iniettare ma non aveva VU disponibili.
   È il segnale netto di saturazione.
2. **`http_req_duration{group:public}` p95** — soglia 400 ms. Sopra,
   l'esperienza kiosk degrada visibilmente (refresh visibile).
3. **`http_req_failed`** — soglia 2%. Sopra, c'è qualcosa di rotto
   (5xx, OOM, pool DB esaurito).

Le soglie SLO sono in `lib/thresholds.js` — k6 esce con codice 99 se
fallisce un threshold, utile per pipeline CI.

### Esempio di output sintetico

```
✓ status 200
✓ body non vuoto
✗ http_req_duration{group:public}................: avg=180ms p(95)=380ms p(99)=720ms
  http_req_failed{expected:true}..................: rate=0.18%
  vus_running.....................................: avg=42 max=58
  dropped_iterations..............................: 0
```

→ p95=380 ms sotto soglia → kiosk ok, no drop, fail rate trascurabile → tier `medium` superato.

## 4. Misurare lato VPS in parallelo al test

Su una shell separata SSH'ata sul VPS:

```bash
# CPU + RAM in tempo reale
ssh cadenza@82.165.110.193 'top -b -d 5 -n 100' | tee top-during-test.log

# Connessioni Postgres
ssh cadenza@82.165.110.193 'watch -n 2 "psql -U cadenza -d cadenza -c \"SELECT count(*), state FROM pg_stat_activity GROUP BY state;\""'

# Pool Sequelize via log applicativo
ssh cadenza@82.165.110.193 'pm2 logs cadenza-backend --lines 0 --nostream' &
```

Se vedi:

- `pm2 logs` con `SequelizeConnectionAcquireTimeoutError` → alza `pool.max`
- `state=idle in transaction` > 5 in pg_stat_activity → query lente / lock
- `top` con Node fisso al 100% di un core → CPU-bound (PDF? loop sync?)
- `top` con Postgres > 2 GB RSS → riduci `shared_buffers`

## 5. Pulizia post-test

Anche con DELETE inline, residui di crash possono restare. Verifica:

```sql
SELECT count(*) FROM bookings WHERE purpose LIKE 'loadtest k6%';
-- atteso: 0
DELETE FROM bookings WHERE purpose LIKE 'loadtest k6%';
```

E **rimetti il rate limit al default** rimuovendo `RATE_LIMIT_API_PER_MIN`
dal `.env` e `pm2 restart`.

## 6. Limiti noti

- **Una singola macchina k6** può iniettare fino a ~3000 req/s
  affidabili (oltre, k6 stesso diventa il bottleneck). Per noi i 200
  req/s del tier `high` sono comodi anche da MacBook.
- **Loadtest da Internet pubblico** misura anche RTT verso il VPS
  IONOS (~30-80 ms da una connessione FTTC italiana). I numeri di
  latenza sono "user-perceived"; per misurare il puro server lancia
  k6 dal VPS stesso (`ssh cadenza@... && k6 run ...`) — sottrae il
  RTT internet ma include la self-load del client.
- **2FA**: se attivi 2FA sull'utente di test, il login restituisce
  `needsTwoFa: true` e `lib/auth.js` aborta. Disattivalo per quell'account.
- **OAuth-only**: utenti senza password (login solo Google/Microsoft)
  non funzionano per il test. Crea un utente locale dedicato.

# Database migrations — Cadenza

## Stato attuale

L'app sta attraversando una **transizione** dal modello "schema-as-sync" al
modello "schema-as-migrations" gestito da `sequelize-cli`.

| Sistema                                   | Stato                        | Ruolo                                                                                                                                 |
| ----------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `sequelize.sync({safe})` (in `server.js`) | **attivo**                   | Crea tabelle/indici mancanti per i model definiti. Su DB già allineato è no-op.                                                       |
| `lib/preSyncMigrations.js`                | **attivo (compat layer)**    | ALTER TABLE idempotenti per le colonne aggiunte storicamente. Resta attivo per **3-6 mesi** finché tutti gli ambienti sono allineati. |
| `migrations/` + `sequelize-cli`           | **attivo per nuove feature** | Da ora in poi, **ogni nuova modifica di schema** passa qui con `up`/`down`.                                                           |

Quando tutti gli ambienti hanno applicato le migration storicamente fatte
da `preSyncMigrations.js`, quel file potrà essere svuotato (mantenendo
solo la registrazione "0000-initial-baseline" in `SequelizeMeta`).

## Layout dei file

```
backend/
├── .sequelizerc                 # paths CLI (config, migrations, models, seeders-cli)
├── config/
│   └── sequelize-cli.js         # config DB letta dal CLI (riusa env del runtime)
├── migrations/
│   ├── 0000-initial-baseline.js # marker no-op per DB esistenti
│   ├── _template-feature.js.example
│   └── <timestamp>-<descrizione>.js  # le tue migration future
├── seeders-cli/                 # seeder gestiti dal CLI (separati da seeders/initial.js)
└── scripts/
    └── db-mark-baseline.js      # one-shot: registra baseline su DB esistente
```

`models/index.js` e `seeders/initial.js` restano custom — il CLI è
configurato per non toccarli.

## Setup iniziale (su un DB già esistente)

Per allineare un DB **già popolato** al nuovo sistema senza rompere nulla:

```bash
cd backend
npm run db:cli:mark-baseline   # registra 0000-initial-baseline in SequelizeMeta
npm run db:cli:status          # verifica: dovresti vedere "0000-initial-baseline" UP
```

Dopo questo passo, il DB è "in pari" col CLI: future migration partono da 0001.

## Workflow per nuove feature

```bash
# 1. Genera scheletro
npm run db:cli:generate -- add-user-phone

# 2. Modifica il file generato in migrations/<timestamp>-add-user-phone.js
#    Implementa up() e down(). Vedi _template-feature.js.example.

# 3. Test locale
npm run db:cli:migrate

# 4. Verifica stato
npm run db:cli:status

# 5. (Se serve) rollback
npm run db:cli:undo

# 6. Commit + push: la CI eseguirà db:cli:migrate prima di npm start
```

## Buone pratiche per le migration

1. **Usa solo `queryInterface`**, non importare i model. Le migration sono
   immutabili; i model evolvono. Importarli causa drift quando un model
   futuro cambia schema.
2. **`up` e `down` sempre presenti.** Anche se "non penso mai di rollare
   indietro", il CLI lo richiede per `db:migrate:undo` e per i test in
   ambiente staging.
3. **Idempotenza dove possibile.** `addColumn` non è idempotente, ma puoi
   precedere con un check `describeTable`. Per produzione, è meglio essere
   idempotenti se la stessa migration potrebbe essere applicata su DB
   diversamente sincronizzati.
4. **Una migration = un cambiamento atomico.** Se una feature aggiunge 3
   colonne + 1 indice + 1 trigger, è UN file con tutto in una transazione.
5. **Transazione esplicita** per multi-step:
   ```js
   await queryInterface.sequelize.transaction(async (t) => {
     await queryInterface.addColumn(..., { transaction: t });
     await queryInterface.addIndex(..., { transaction: t });
   });
   ```
6. **Backfill dati pesanti**: separa la migration di schema (veloce, low-lock)
   dalla migration di backfill (lunga, batched). I backfill su tabelle con
   milioni di righe vanno scritti come "loop with limit + sleep".
7. **Niente `models.sync()` dentro migration.** Mai. Sync e migration sono
   sistemi paralleli; mescolarli causa schema drift.

## Comandi utili

```bash
npm run db:cli:migrate          # applica tutte le migration pending
npm run db:cli:status           # mostra UP/DOWN per ogni file
npm run db:cli:undo             # annulla l'ultima migration
npm run db:cli:undo-all         # annulla tutte (pericoloso, dev only)
npm run db:cli:generate -- nome # genera scheletro <timestamp>-nome.js
npm run db:cli:mark-baseline    # one-shot: marca baseline su DB esistente
```

## CI/CD

In produzione, gli step del deploy sono:

```bash
1. npm ci --omit=dev
2. npm run db:cli:migrate     # applica nuove migration (atomico, fail-fast)
3. systemctl restart cadenza  # riavvio servizio (sync resta come safety-net)
```

Il `sync({safe})` interno a `server.js` resta attivo come compat: in caso di
rollout parziale (alcune istanze hanno migrato, altre no), il sync continua
a creare il NECESSARIO mancante senza alterare ciò che le migration hanno
gestito esplicitamente. **Quando tutto sarà migrato**, sync potrà essere
disabilitato impostando `DB_SYNC_MODE=none`.

## Quando rimuovere `preSyncMigrations.js`

Criteri per rimuoverlo:

1. Tutti gli ambienti (dev, staging, prod) hanno il marker `0000-initial-baseline`
   in `SequelizeMeta`.
2. Tutte le ALTER TABLE che oggi sono in `preSyncMigrations.js` sono
   ridondanti (cioè le colonne sono già nello schema di tutte le istanze).
3. Sono passati almeno 3 mesi dal rollout della prima migration sequelize-cli
   senza problemi.

Quando i 3 criteri sono soddisfatti, in `lib/preSyncMigrations.js` rimuovere
i body delle funzioni e tenere solo lo skeleton vuoto come stub di
backward-compat (il file è importato in `server.js`).

## Troubleshooting

### "ENOENT: no such file or directory, open .sequelizerc"

Stai eseguendo `sequelize-cli` da una directory diversa dalla `backend/`.
Sposta il cwd: `cd backend && npx sequelize-cli ...`.

### "SequelizeMeta does not exist"

Esegui prima `npm run db:cli:mark-baseline` (crea la tabella + inserisce
la riga baseline).

### "Migration <X> already pending"

Hai due migration con lo stesso timestamp. Rinomina una con un timestamp
posteriore (ts incrementali, no orari sovrapposti).

### "ER_DUP_FIELDNAME / column already exists"

La migration sta provando ad aggiungere una colonna che `preSyncMigrations.js`
o `sync()` ha già creato. Fix: aggiungi un check `describeTable` prima
dell'addColumn:

```js
const desc = await queryInterface.describeTable('users');
if (!desc.phone) {
  await queryInterface.addColumn('users', 'phone', ...);
}
```

In transizione, gli ALTER idempotenti sono la norma — le migration future
"pure replay-able" potranno smettere di esserlo dopo i 3-6 mesi.

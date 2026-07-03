# Migrazione backend Cadenza → TypeScript (ESM + runtime tsx)

## Contesto

Le altre due app della suite (Opera, Fermata) sono TypeScript; Cadenza no — ma solo nel
**backend** (`/backend`, Express + Sequelize, **CommonJS puro**). Il frontend di Cadenza è
già TS ^6 + ESM. L'obiettivo immediato non è cambiare ORM (decisione: **NON** migrare a
Prisma ora — vedi nota sotto) ma portare il backend a **TypeScript** per: type-safety,
allineamento di filosofia/tooling con la suite, e rendere un'eventuale futura migrazione a
Prisma molto più sensata.

Decisioni prese:

- **Sistema di moduli: ESM completo** (`type: module`), non CommonJS.
- **Runtime in produzione: `tsx`** (transpile a runtime, **nessun** artefatto `dist/`), in
  linea con l'approccio runtime-transpile dei sibling (Bun) e a deploy invariato.
- ORM: **resta Sequelize** (44 modelli, PgBouncer transaction-pooling, transazioni
  SERIALIZABLE con retry — setup maturo, non debito tecnico).

> Nota: Opera/Fermata sono app **Next.js full-stack**, non backend Express. Il loro
> `tsconfig` (jsx, `moduleResolution: bundler`, noEmit Next) **non è copiabile**. Allineiamo
> _filosofia e tooling_ (strict, typescript-eslint, alias `@/*`), non il config letterale.

## Vincoli architetturali rilevanti (emersi dall'esplorazione)

- **Backend = CommonJS** (`require`/`module.exports`, factory model `module.exports =
(sequelize) => …`), niente `tsconfig`, niente `typescript`/`tsx` nei dep. JSDoc ricco
  ovunque → grande aiuto alla tipizzazione.
- **Vitest** già transpila TS via esbuild → basta includere i `.test.ts`, nessun runner extra.
- **~145 file runtime** da convertire: ~25 `lib/`, ~5 `config/`, `middleware/`, ~36–54
  `services/`, ~40 `routes/`, ~44 `models/`, `server.js`/`app.js`.
- **ESM landmines** (mappati con grep):
  - `__dirname`/`__filename` in 30 file (16 runtime + 14 in `scripts/`/`tests/`).
  - `require()` lazy/in-funzione: mount route in `app.js`; deferred require in `server.js`
    (schedulers, seeder, passport, `@sentry/node`) — funzione `start()` già `async`;
    lazy-require anti-ciclo in `middleware/audit.js:174`; lazy-require anti-crash al boot
    per deps opzionali dietro feature flag (Telegram/Signal/WhatsApp/PDF) — **da preservare
    come `await import()` dentro le funzioni, mai hoistati in testa**.
  - **sequelize-cli** (`.sequelizerc` → `config/sequelize-cli.js`, `migrations/`,
    `seeders-cli/`, `models/`): usa `require()`, mal sopporta `type: module`.

## Strategia

**Incrementale, app sempre avviabile a ogni commit.** Chiave dell'approccio ESM con `tsx`:

1. **Tenere `package.json` in CommonJS (type non impostato) per quasi tutta la migrazione.**
   `tsx` esegue i `.ts` ESM e gestisce l'interop con i `.js` CJS residui; Vitest (esbuild)
   idem. Si **flippa a `type: module` come ultimo passo**, quando tutto il runtime è `.ts` ESM.
2. **Convertire top-down** (entry/app → routes → services → middleware/lib → models per
   ultimi): un ESM convertito può importare CJS, ma un CJS residuo non può `require()` in
   modo sincrono un modulo ESM puro. Convertire prima i "consumatori" minimizza l'attrito.
3. **Codemod-assistito + fix a mano**: trasformazione automatica `require→import` /
   `module.exports→export` per batch (es. `cjstoesm`/`lebab`), poi fix manuale di
   `__dirname`, lazy-import, e isola sequelize-cli. Test dopo ogni batch.
4. **Strict in salita**: partire `strict: false`/`noImplicitAny: false` per arrivare verde
   in fretta, poi alzare per area alla fine.

## Fasi

### Fase 0 — Setup tooling (nessuna conversione di file runtime)

- Aggiungere dep: `tsx` (in **dependencies**, serve in prod), `typescript`, `@types/node`,
  `@types/express`, `@types/passport`, `@types/bcryptjs`, ecc. + `typescript-eslint` (la
  versione ^8 è già nel workspace via frontend) in **devDependencies**.
- Creare `backend/tsconfig.json` (vedi sotto). `allowJs: true` così `.js` e `.ts` coesistono.
- `package.json` scripts: `dev: "tsx watch server.ts"` (per ora resta `nodemon server.js`
  finché l'entry non è convertito), `typecheck: "tsc --noEmit"`. Lasciare `start` su
  `node server.js` finché non si flippa a ESM.
- `.gitignore`: nessun `dist/` (runtime tsx). Aggiungere `*.tsbuildinfo`.
- Vitest: includere `tests/**/*.test.ts` accanto ai `.test.js`; estendere i glob coverage a
  `**/*.ts`.
- ESLint: portare `eslint.config.js` a typescript-eslint (parser TS per i `.ts`, mantenere
  le regole `eslint-plugin-n`/`security` per i `.js` residui). Il file config userà
  `export default` (ESM) o rinominato `.mjs`.
- **Verifica**: app gira ancora come prima (`npm run dev` JS), `npm test` verde,
  `npm run typecheck` passa sul codebase tutto-JS con settings larghi.

### Fase 1 — Isola sequelize-cli in `.cjs` (resta CommonJS per sempre)

- Rinominare `config/sequelize-cli.js` → `.cjs`; `migrations/*.js` → `.cjs`; aggiornare
  `.sequelizerc` (può restare `module.exports`, file senza estensione caricato come CJS) per
  puntare ai path `.cjs` e impostare il pattern file migration su `.cjs`.
- Verificare che `seeders-cli/` (se presente) resti CJS. I **`models/`** restano nel flusso
  e diventeranno ESM: confermare che `db:cli:migrate/status/undo` NON carichino i modelli
  (lo fa solo `model:generate`, non usato nel deploy) → conversione modelli sicura.
- Riscrivere gli script inline CJS-dipendenti in `package.json`: `db:reset` (usa
  `node -e "...require('./models')..."`) e `seed` (`node seeders/initial.js`) → versioni
  `tsx` (`tsx seeders/initial.ts`) o piccolo script dedicato.
- **Verifica**: `npm run db:cli:status` funziona; migrazioni applicabili su un DB sqlite di prova.

### Fase 2 — Conversione runtime top-down (il grosso)

Per ciascun batch: codemod → fix `__dirname` → fix lazy-import → rinomina `.js`→`.ts` →
tipi minimi → `npm test` + `npm run typecheck` → commit (segue la convenzione auto-commit
quando type-check/lint passano).

- **2a — entry & app**: `app.js`→`app.ts`, `server.js`→`server.ts`.
  - `app.js`: i `app.use('/api/...', require('./routes/x'))` → `import` in testa (banale).
  - `server.ts`: `require('dotenv').config()` → `import 'dotenv/config'`; deferred require
    in `start()`/shutdown → `await import()` (start è già `async`); **`@sentry/node`**:
    hoist a import statico in testa (è già inizializzato a startup), niente `await import`
    dentro l'error handler.
  - Da qui `dev`/`start` passano a `tsx`.
- **2b — routes/** (~40): conversione + tipi `Request/Response/NextFunction`. Fix
  `__dirname` in `routes/{appIcons,auth,bookings,docs,instruments,structure}.ts` con
  `const __dirname = path.dirname(fileURLToPath(import.meta.url))`.
- **2c — services/** (~36–54): conversione. **Audit dedicato dei lazy-require anti-boot**
  (deps opzionali dietro feature flag): convertire in `await import()` _dentro la funzione_,
  rendendo `async` solo dove necessario, **senza** spostarli in testa.
- **2d — middleware/ + lib/** (~25): `lib/preSyncMigrations.js` è runtime (importato da
  server) → ESM. `middleware/audit.ts`: lazy-require anti-ciclo → `await import()` o
  ristrutturazione.
- **2e — models/** (~44) per ultimi: convertire le factory `module.exports = (sequelize) =>`
  in `export default (sequelize: Sequelize) => …`. **Tipizzazione pragmatica**: prima tipare
  l'aggregatore `models/index.ts` e l'oggetto `db` (così i consumatori hanno i tipi), poi —
  in un secondo momento, non bloccante — irrobustire i singoli modelli con
  `InferAttributes`/`InferCreationAttributes`. `seeders/initial.js`→`.ts`.

### Fase 3 — Flip a ESM e irrobustimento

- Impostare `"type": "module"` in `backend/package.json` (ora tutto il runtime è `.ts` ESM;
  l'isola sequelize-cli è `.cjs`). Verificare boot completo + schedulers + seeder.
- Alzare la severità: `strict: true`, `noImplicitAny: true` per area, correggere i tipi.
  Sostituire eventuali `any` residui con tipi reali dove a basso costo.
- Aggiungere `typecheck` al gate CI / lint-staged (la convenzione auto-commit deve includere
  `tsc --noEmit`).
- `scripts/` e `tests/`: convertibili a TS opzionalmente, in coda (non bloccanti per il runtime).

## File/config chiave

**`backend/tsconfig.json`** (orientato a Node + tsx, `moduleResolution: Bundler` per import
senza estensione, coerente con esbuild/tsx e con la filosofia dei sibling):

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowJs": true,
    "checkJs": false,
    "noEmit": true, // runtime via tsx: niente emit, solo type-check
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "strict": false, // ramp → true in Fase 3
    "noImplicitAny": false, // ramp → true in Fase 3
    "types": ["node"],
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] }, // alias opzionale, allineato ai sibling
  },
  "include": ["**/*.ts", "**/*.js"],
  "exclude": ["node_modules", "coverage", "**/*.cjs"],
}
```

> Tradeoff esplicito: `moduleResolution: Bundler` lega il runtime a `tsx`/esbuild. Un
> eventuale passaggio futuro a `node` nativo richiederebbe estensioni `.js` esplicite negli
> import — accettabile data la scelta tsx.

**`package.json`** (estratto target):

```jsonc
{
  "type": "module", // impostato in Fase 3
  "scripts": {
    "start": "tsx server.ts",
    "dev": "tsx watch server.ts",
    "typecheck": "tsc --noEmit",
    "seed": "tsx seeders/initial.ts",
  },
}
```

## Verifica end-to-end

- **Unit/integration**: `npm test` (Vitest, 109 file, soglia coverage 72/73/78/60) verde dopo
  ogni batch e a fine migrazione. È la rete di sicurezza principale.
- **Type-check**: `npm run typecheck` (`tsc --noEmit`) pulito a fine Fase 3.
- **Boot reale**: `npm run dev` → l'app parte, connette al DB, gira preSyncMigrations + sync +
  seeder + bootstrap anno accademico + **tutti gli scheduler** (reminder/retention/mail/
  backup/excel/verify) e risponde su `:3000`.
- **sequelize-cli**: `npm run db:cli:status` e una migrate/undo su DB sqlite di prova.
- **Deps opzionali**: avviare con i feature flag OFF (Telegram/Signal/WhatsApp assenti) per
  confermare che i `await import()` lazy **non** crashino il boot (regressione critica da
  evitare).
- **E2E**: i 14 spec Playwright girano invariati contro il backend TS (stesse API REST).
- **Lint**: `npm run lint` con typescript-eslint pulito.

## Effort & rischio

Percorso ESM completo + tsx, incrementale: realisticamente **3–5 settimane part-time**, app
sempre funzionante. Rischio concentrato su: flip `type: module`, isola sequelize-cli,
lazy-import anti-boot. Mitigato dalla copertura test alta e dalla conversione a batch
testati. Nessun valore utente-facing diretto: è investimento su DX, type-safety e coerenza
di suite.

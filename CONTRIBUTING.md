# Contributing — Aula Book

Linee guida per sviluppatori che lavorano sul codebase. Le pre-commit hook applicano automaticamente la maggior parte di queste regole; questo doc spiega il "perché" e cosa fare quando un controllo fallisce.

---

## Setup iniziale

Dopo il clone:

```bash
cd conservatory-app
npm install                      # root devDeps + husky install via prepare
npm install --prefix backend
npm install --prefix frontend
npm install --prefix e2e         # opzionale, solo se lavori sugli E2E
```

`npm install` a root attiva automaticamente husky (`prepare` script). Le hook `.husky/pre-commit` e `.husky/commit-msg` vengono installate al primo install.

---

## Convenzioni dei commit (Conventional Commits)

Ogni commit deve seguire il formato:

```
<type>(<scope opzionale>): <descrizione breve in minuscolo>

<corpo opzionale>

<footer opzionale, es. BREAKING CHANGE:>
```

**Type ammessi** (vedi `commitlint.config.cjs`):

| Type       | Quando usarlo                                           |
| ---------- | ------------------------------------------------------- |
| `feat`     | Nuova funzionalità visibile all'utente                  |
| `fix`      | Bug fix                                                 |
| `docs`     | Solo documentazione (README, docs/, JSDoc)              |
| `style`    | Formattazione, spazi, virgole — niente logica           |
| `refactor` | Ristrutturazione senza cambio di comportamento          |
| `perf`     | Ottimizzazione performance                              |
| `test`     | Aggiunta/modifica test                                  |
| `build`    | Build system, dipendenze (npm, vite, postcss)           |
| `ci`       | CI/CD (GitHub Actions, husky, lint-staged)              |
| `chore`    | Varie ed eventuali (release, version bump)              |
| `revert`   | Revert di un commit precedente                          |
| `security` | Hardening, dipendenze vulnerabili patchate              |
| `gdpr`     | Modifiche legate a privacy / GDPR (consensi, retention) |

**Esempi**:

```
feat(bookings): aggiungi waitlist auto-claim entro 30 minuti
fix(auth): TOKEN_REVOKED dopo cambio password senza re-login
docs(install): aggiungi modalità IP-only senza dominio
gdpr(profile): consenso marketing toggle nel profilo utente
security(auth): bcrypt cost 10 → 12 + JWT 7d → 2h
ci(pre-commit): attiva ESLint + prettier sui file modificati
```

**Vincoli automatici** (commitlint):

- `type` deve essere uno di quelli sopra (errore altrimenti)
- header massimo 100 caratteri (errore se più lungo)
- niente case enforcement sull'oggetto (puoi scrivere in italiano normalmente)

Se commitlint blocca il commit, leggi il messaggio e correggi:

```
✖   subject may not be empty [subject-empty]
✖   type may not be empty [type-empty]
```

---

## Pre-commit hook (lint-staged)

Su ogni `git commit`, husky lancia `lint-staged` SOLO sui file in stage. Cosa succede:

| Pattern                   | Azione                                                          |
| ------------------------- | --------------------------------------------------------------- |
| `frontend/**/*.{ts,tsx}`  | `prettier --write` + `eslint --fix`                             |
| `frontend/**/*.{js,jsx}`  | `prettier --write`                                              |
| `backend/**/*.js`         | `prettier --write` (no ESLint — backend non ha config dedicata) |
| `**/*.{json,md,yml,yaml}` | `prettier --write`                                              |

I file modificati dalle correzioni automatiche vengono ri-aggiunti allo stage automaticamente. Se ESLint trova errori non auto-fixabili, il commit viene **bloccato** e devi sistemare a mano.

**Bypass di emergenza** (solo se hai un valido motivo, es. WIP commit privato):

```bash
git commit --no-verify -m "feat: WIP"
```

> Sconsigliato: lo usi sentito di averlo fatto, e CI ti mostrerà il problema dopo.

---

## ESLint — frontend

Config: `frontend/eslint.config.js`. Si basa su:

- `@eslint/js` `recommended`
- `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked` (regole strict, type-aware)
- `eslint-plugin-react-hooks` (rules-of-hooks, exhaustive-deps)
- `eslint-plugin-react-refresh` (compatibilità HMR Vite)

**Regole "downgrade" da error a warn** sul codebase esistente (vedi commenti in `eslint.config.js`):

- `no-floating-promises`, `no-misused-promises` — pattern React idiomatic (`mutation.mutate()` fire-and-forget)
- `no-non-null-assertion` — usato dove TS non riesce a inferire ma il programmatore sa
- `no-confusing-void-expression` — `() => doStuff()` è leggibile
- `no-unsafe-*` — escape hatch per payload API loosely-typed
- `prefer-nullish-coalescing`, `no-unnecessary-condition` — stile esistente
- altri minori (vedi config)

**Restano error** (bloccanti):

- `no-unused-vars` (eccetto pattern `^_`)
- regole base `eslint:recommended` (no-undef, no-redeclare, ecc.)
- React Hooks `rules-of-hooks` e `exhaustive-deps`

Per lanciare ESLint manualmente:

```bash
npm --prefix frontend run lint           # check
npm --prefix frontend run lint:fix       # auto-fix
npm --prefix frontend run typecheck      # solo tsc -b --noEmit
```

---

## Prettier

Config: `.prettierrc.json` a root. Stile:

- 2 spazi, `singleQuote: true`, `semi: true`, `trailingComma: 'all'`, `printWidth: 100`.

Override per `*.md` (printWidth 80) e `*.yml` (double quotes).

Se vuoi formattare tutto il repo a mano:

```bash
npm run format          # write
npm run format:check    # solo check, no scrittura
```

`.prettierignore` esclude `dist/`, `node_modules/`, `_legacy/`, `coverage/`, lock files.

---

## EditorConfig

`.editorconfig` a root. Tutti gli editor moderni lo leggono nativamente. Forza:

- LF (no CRLF) — coerenza Unix/Windows
- 2 spazi (no tab) eccetto Makefile
- Final newline + trim trailing whitespace
- UTF-8

---

## Testing

Doc dedicato: [`docs/TESTING.md`](docs/TESTING.md).

Riassunto comandi:

```bash
npm run test:backend     # vitest backend (35 test)
npm run test:frontend    # vitest frontend + RTL (10 test)
npm test                 # entrambi
```

E2E in `e2e/`:

```bash
cd e2e
npm install
npm run install:browsers   # primo setup
npm test                   # 3 spec Playwright
```

---

## Branching & PR

Convenzione semplice (no Git Flow elaborato):

- `main` — branch protected, deployabile in qualsiasi momento.
- `feat/<descrizione-breve>`, `fix/<descrizione-breve>` — branch di lavoro.
- PR su `main` con almeno una review.
- Squash merge consigliato per mantenere `main` lineare.

Il workflow CI (`.github/workflows/ci.yml`) gira su ogni push/PR:

- backend: `npm test` + coverage
- frontend: `typecheck` + `lint` (ESLint) + `test` + `build`
- E2E: solo su push a `main`/`develop` o PR con label `e2e`

---

## Aggiornare le dipendenze

Per minor/patch:

```bash
npm --prefix backend update
npm --prefix frontend update
```

Per major (potenzialmente breaking):

```bash
npm --prefix frontend exec -- npm-check-updates -u
npm --prefix frontend install
npm --prefix frontend test  # verifica regressioni
```

Le pull request automatiche di Dependabot/Renovate sono benvenute — verifica che CI sia verde prima di mergiare.

---

## Quando un controllo blocca un commit legittimo

Esempi reali e cosa fare:

- **commitlint** rifiuta `wip: cose`: usa un type valido (`chore: cose in corso` se proprio).
- **lint-staged ESLint** trova un error non fixabile su un file che non hai toccato: il file aveva già il problema. Sistemalo (è il momento, sei già lì), oppure crea una issue e bypassa con `--no-verify` solo per il PR specifico.
- **prettier** riformatta in modo "brutto": adatta lo stile sorgente. Se il risultato è davvero illeggibile, usa `// prettier-ignore` puntuale (ma chiediti se non è il caso di refactor).

---

## File chiave da NON toccare alla leggera

- `.husky/pre-commit`, `.husky/commit-msg` — pipeline pre-commit
- `commitlint.config.cjs` — regole conventional commits
- `eslint.config.js` (frontend) — strict-type-checked + downgrade documentati
- `.editorconfig`, `.prettierrc.json` — coerenza tra editor

Se hai un motivo per modificarli, documenta nel commit message e/o nel CHANGELOG.

'use strict';

// ESLint flat config (formato richiesto da ESLint 9+).
//
// Strategia:
//   - @eslint/js "recommended" come baseline (errori comuni JS)
//   - eslint-plugin-n: best-practice Node.js (require() corretti,
//     callback async, deprecated APIs, ecc.)
//   - eslint-plugin-security: pattern insecuri tipici (eval,
//     child_process.exec con input, regexp DoS, etc.) — soft (warn)
//     per evitare CI rumorosa al primo giro, alzare a error in PR
//     dedicate quando il codice è già pulito.
//   - Globals Node.js + CommonJS (require/module/exports/__dirname)
//
// Niente prettier-eslint: prettier già gira via lint-staged. ESLint
// si concentra su correttezza, non formattazione.

const js = require('@eslint/js');
// `eslint-plugin-n` v18 espone solo l'ESM default export. In CommonJS lo
// otteniamo via `.default`.
const nodePlugin = require('eslint-plugin-n').default;
const securityPlugin = require('eslint-plugin-security');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules',
      'coverage',
      'reports',
      'backups',
      'data',
      'secrets',
      'stryker.config.json',
      'public',
      // Vitest config è ESM (import/export), gestione separata sotto se
      // serve. Per ora lo escludiamo dal lint perché non è codice
      // applicativo critico e richiederebbe sourceType: module solo per lui.
      'vitest.config.js',
      'vitest.config.*.js',
    ],
  },
  js.configs.recommended,
  // `recommended-script` di eslint-plugin-n include `n/no-process-exit`
  // come error e `n/no-unsupported-features/node-builtins` legato a
  // `engines.node`. Lo importiamo, poi sotto allentiamo dove serve.
  nodePlugin.configs['flat/recommended-script'],
  {
    plugins: {
      security: securityPlugin,
    },
    rules: {
      ...securityPlugin.configs.recommended.rules,
    },
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.commonjs,
      },
    },
    rules: {
      // ===== Allentamenti pragmatici sul codebase esistente =====
      // Allinea il comportamento di no-unused-vars al frontend: parametri
      // e variabili che iniziano con `_` sono intenzionalmente non usati
      // (es. error handler che ignorano `err`, middleware Express che
      // accettano `(req, res, next)` ma non usano alcuni argomenti).
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          // Per i 4 argomenti dell'error handler Express: `(err, req, res, next)`.
          ignoreRestSiblings: true,
        },
      ],

      // eslint-plugin-n: in un backend Express moderno è normale usare
      // process.exit, top-level await in script ad-hoc, ecc. Allentiamo
      // le regole più rumorose senza disattivare lo zoccolo duro.
      'n/no-process-exit': 'warn',
      // `fetch` è ufficialmente stabile da Node 21; `engines.node` di
      // package.json dice ">=18". Il check accusa fetch a runtime ma lo
      // usiamo solo in test/integration (telegram). Lascio warn per
      // tracciare l'uso, non bloccare CI.
      'n/no-unsupported-features/node-builtins': 'warn',
      // `n/hashbang` chiede che script eseguibili abbiano #!/usr/bin/env
      // node — utile, ma nessuno dei nostri script ce l'ha. Warn per
      // ricordare di aggiungerlo se si rende lo script eseguibile.
      'n/hashbang': 'warn',
      // `preserve-caught-error` (nuova regola in ESLint 9.18+) chiede che
      // `throw new Error(...)` dentro un catch abbia `{ cause: err }`.
      // Buono in nuovo codice, ma il codebase esistente ha ~4 occorrenze
      // di pattern legittimi che ri-mappano l'errore con un messaggio
      // chiaro per l'utente. Warn, da riconvertire a error in PR dedicata.
      'preserve-caught-error': 'warn',
      // `n/no-missing-require` ha falsi positivi con i path generati
      // dinamicamente (es. require(`./models/${name}`)) usati nei seeders
      // e migrations. Lo lasciamo off, gli errori veri saltano fuori a
      // runtime nei test.
      'n/no-missing-require': 'off',
      // `n/no-unpublished-require` non si applica a un'app privata
      // (non pubblichiamo su npm).
      'n/no-unpublished-require': 'off',
      // `n/no-extraneous-require` segnala richieste di pacchetti
      // installati come transitive — utile ma rumoroso al primo giro.
      'n/no-extraneous-require': 'warn',
      // Permetti node: prefix nei require ma non forzarlo (allineato al
      // codice esistente che usa entrambi gli stili).
      'n/prefer-node-protocol': 'off',

      // ===== Security plugin: tutto a warn per la prima passata =====
      // Le regole più aggressive (object-injection, non-literal-fs-filename,
      // non-literal-regexp) hanno alti tassi di falsi positivi su pattern
      // legittimi (filtri admin, lookup dinamici). Mantenerle visibili come
      // warn fa da hint nel terminale senza bloccare la CI. In una PR
      // dedicata si fanno alzare progressivamente a error.
      'security/detect-object-injection': 'off', // troppi falsi positivi su `obj[key]` legittimi
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-non-literal-require': 'warn',
      'security/detect-unsafe-regex': 'warn',
      'security/detect-buffer-noassert': 'warn',
      'security/detect-child-process': 'warn',
      'security/detect-disable-mustache-escape': 'warn',
      'security/detect-eval-with-expression': 'warn',
      'security/detect-new-buffer': 'warn',
      'security/detect-no-csrf-before-method-override': 'warn',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-pseudoRandomBytes': 'warn',
      'security/detect-bidi-characters': 'error', // unicode bidi è un real attack vector
    },
  },
  {
    // Test files: meno strict (mock objects, console.log per debug).
    files: ['tests/**/*.js', '**/*.test.js', '**/*.spec.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.commonjs,
        ...globals.vitest,
        // Helpers globali esposti da `tests/setup.js`. Alcuni test li
        // chiamano via `globalThis.resetDatabase()`, altri direttamente
        // come `resetDatabase()` — entrambi i pattern devono passare il
        // lint.
        resetDatabase: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-empty': 'off',
      'no-useless-assignment': 'off',
      // I test in `tests/integration` usano `fetch` per parlare a mock
      // server locali. Su Node 18+ fetch è ufficialmente "experimental"
      // ma in pratica perfettamente funzionante; nei test non blocca.
      'n/no-unsupported-features/node-builtins': 'off',
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-non-literal-require': 'off',
      'n/no-unpublished-require': 'off',
      // I test possono ri-throw bare per readability, senza chain di
      // cause. Non è codice di produzione.
      'preserve-caught-error': 'off',
    },
  },
  {
    // Script ad-hoc: util di manutenzione/dev, possono usare console e
    // pattern un po' più lassi.
    files: ['scripts/**/*.js', 'seeders/**/*.js'],
    rules: {
      'n/no-process-exit': 'off',
      'security/detect-non-literal-fs-filename': 'off',
      // Alcuni script hanno `#!/usr/bin/env node` come documentazione del
      // runtime atteso anche se non sono marcati eseguibili (vengono
      // invocati via `node script.js` o npm scripts). `n/hashbang`
      // autofix lo rimuove → off per non perdere quella documentazione.
      'n/hashbang': 'off',
    },
  },
];

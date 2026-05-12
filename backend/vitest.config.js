import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.js'],
    exclude: ['node_modules/**', 'config/**'],
    // I test integrazione condividono il DB in-memory: niente parallelismo
    // tra file, ma all'interno dello stesso file restano sequenziali.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    testTimeout: 15000,
    hookTimeout: 15000,
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['routes/**/*.js', 'services/**/*.js', 'middleware/**/*.js', 'lib/**/*.js'],
      exclude: [
        '**/node_modules/**',
        'tests/**',
        'seeders/**',
        'scripts/**',
        // Adapters di messaging esterni (Signal CLI, IMAP polling, WhatsApp
        // Cloud API): I/O-bound su processi/network esterni. Coperti da
        // smoke loadability ma il test funzionale richiede fixture/cassette
        // pesanti — fuori scope dell'unit/integration coverage.
        'services/messaging/adapters/signal_cli.js',
        'services/messaging/adapters/email_imap.js',
        'services/messaging/adapters/whatsapp_cloud.js',
        // Bot conversazionale: intent matching + state machine richiedono
        // fixture conversazionali pesanti per essere testati realisticamente.
        'services/messaging/intent.js',
        // Email broadcast annunci: 100% dipendente da SMTP transporter.
        'services/announcementEmail.js',
      ],
      thresholds: {
        // Soglie di non-regressione: floor allineato al coverage corrente con
        // buffer di ~1-1.5 punti. Cresciute il 2026-05-12 dopo l'aggiunta di
        // 64 nuovi test che hanno portato services/twoFa.js da 24% a 100%
        // e routes/contractTypes.js da 12% a 93%.
        // TODO(test-debt): risalire ulteriormente aggiungendo test su
        //   - routes/analytics.js (20%): blocco nel SQL Postgres-only
        //     (EXTRACT/date_trunc), serve Postgres in CI o mock per le
        //     aggregazioni.
        //   - services/equipmentImporter.js (14%): I/O CSV.
        //   - services/twoFa.js è ora 100%: completato.
        statements: 59,
        lines: 61,
        functions: 60,
        branches: 47,
      },
    },
  },
});

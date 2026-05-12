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
        // buffer di ~1-1.5 punti. Cresciute il 2026-05-12 dopo:
        //   - twoFa.js da 24% a 100% (+26 unit)
        //   - contractTypes.js da 12% a 93% (+26 integration)
        //   - analytics CSV export coperta (+5 integration)
        //   - instrumentImporter.js da 14% a 88% (+19 integration)
        //   - structureImporter.js da 36% a 100% (+35 unit+integration)
        //   - lib/network.js da 16% a 100% branches (+13 unit)
        //   - lib/pgBin.js + routes/appIcons.js (+7 unit)
        //   - routes/courseLevels.js da 9% a alto branches (+19 integration)
        //   - routes/instrumentLoanRules.js da 2% a alto (+20 integration)
        //   - routes/botBindings.js da 8% a alto (+12 integration)
        statements: 69,
        lines: 70,
        functions: 74,
        branches: 58,
      },
    },
  },
});

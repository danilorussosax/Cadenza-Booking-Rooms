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
        // Soglie di non-regressione (raggiunte). Branches/functions naturalmente
        // più bassi e crescono con il tempo: soglie conservative.
        statements: 70,
        lines: 70,
        functions: 55,
        branches: 50,
      },
    },
  },
});

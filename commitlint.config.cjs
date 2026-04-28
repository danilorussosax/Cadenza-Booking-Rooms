/**
 * Commitlint — enforce dei conventional commits.
 * Vedi https://www.conventionalcommits.org e CONTRIBUTING.md.
 *
 * Type ammessi (estensione del default config-conventional con qualche
 * tipo specifico di Aula Book):
 *   feat      → nuova funzionalità
 *   fix       → bug fix
 *   docs      → solo documentazione (README, docs/, commenti)
 *   style     → formattazione (whitespace, virgole, …) — niente logica
 *   refactor  → ristrutturazione senza cambio di comportamento
 *   perf      → ottimizzazione performance
 *   test      → aggiunta/modifica test
 *   build     → build system, dipendenze (npm, vite, postcss, …)
 *   ci        → CI/CD (GitHub Actions, husky, lint-staged)
 *   chore     → varie ed eventuali fuori scope (rilasci, version bump)
 *   revert    → revert di un commit precedente
 *   security  → fix di sicurezza (dipendenze vulnerabili, hardening)
 *   gdpr      → modifiche legate a privacy/GDPR (consensi, retention, …)
 *
 * Esempio:
 *   feat(bookings): aggiungi waitlist auto-claim entro 30 minuti
 *   fix(auth): TOKEN_REVOKED dopo cambio password senza re-login
 *   docs(install): aggiungi modalità IP-only senza dominio
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'style',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'chore',
        'revert',
        'security',
        'gdpr',
      ],
    ],
    'subject-case': [0],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};

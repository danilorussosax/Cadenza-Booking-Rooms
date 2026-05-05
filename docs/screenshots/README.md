# Screenshot del Manuale Amministratore

Questa cartella ospita gli screenshot referenziati da `docs/MANUALE_ADMIN.md`.

## Generazione automatica

Lo script `e2e/screenshots.mjs` automatizza la generazione di tutti gli screenshot
loggandosi come admin tramite Playwright.

```bash
# Pre-requisiti:
#   1. backend up su http://localhost:3000 (npm --prefix backend run dev)
#   2. frontend buildato e servito dal backend (cd frontend && npm run build)
#   3. utente admin esistente con 2FA disabilitata o grace period attivo

cd e2e/
ADMIN_EMAIL=tua-email@conservatorio.it \
  ADMIN_PASSWORD='LaTuaPassword' \
  node screenshots.mjs

# Per generare anche lo screenshot del banner docente:
ADMIN_EMAIL=... ADMIN_PASSWORD=... \
  DOC_EMAIL=docente-con-deroga@... DOC_PASSWORD='...' \
  node screenshots.mjs

# Se l'admin ha 2FA attiva, fornisci il codice email:
ADMIN_EMAIL=... ADMIN_PASSWORD=... TWO_FA_CODE=123456 \
  node screenshots.mjs
```

I file PNG generati vengono salvati in `docs/screenshots/`:

| File                                               | Sezione manuale | Pagina sorgente                            |
| -------------------------------------------------- | --------------- | ------------------------------------------ |
| **§3 Utenti / §4 Corsi / §5 Struttura**            |
| `users-overview.png`                               | §3              | `/admin/users`                             |
| `users-oauth-providers.png`                        | §3.4            | `/admin/users` (riquadro OAuth)            |
| `users-form-monteore-override.png`                 | §3.5 / §8.10    | `/admin/users` (form Modifica docente)     |
| `courses-overview.png`                             | §4.1            | `/admin/courses` (tab Corsi)               |
| `courses-livelli.png`                              | §4.2            | `/admin/courses?tab=livelli`               |
| `structure-sedi.png`                               | §5.1            | `/admin/structure` (tab Sedi)              |
| `structure-dotazioni.png`                          | §5.2            | `/admin/structure?tab=dotazioni`           |
| **§6 Regole prenotazione**                         |
| `rules-overview.png`                               | §6              | `/admin/rules`                             |
| `rules-per-ruolo.png`                              | §6.1            | `/admin/rules?tab=per-ruolo`               |
| `rules-quote.png`                                  | §6.2            | `/admin/rules?tab=quote`                   |
| `rules-quote-prestiti.png`                         | §6.2bis         | `/admin/rules?tab=quote-prestiti`          |
| `rules-eccezioni.png`                              | §6.3            | `/admin/rules?tab=eccezioni`               |
| **§7 Approvazioni / Registro attività / Bookings** |
| `approvals-overview.png`                           | §7              | `/admin/approvals`                         |
| `activity-log-overview.png`                        | §7.5            | `/admin/activity-log`                      |
| `bookings-overview.png`                            | §7.6            | `/admin/bookings`                          |
| **§8 Monte Ore**                                   |
| `monteore-overview.png`                            | §8              | `/admin/monte-ore`                         |
| `monteore-settings.png`                            | §8.3            | `/admin/monte-ore?tab=settings`            |
| `monteore-proposte.png`                            | §8.5            | `/admin/monte-ore?tab=proposte`            |
| `monteore-amendments.png`                          | §8.6            | `/admin/monte-ore?tab=amendments`          |
| `monteore-docente-banner.png`                      | §8.10           | `/monte-ore` (vista docente con override)  |
| **§9 Inventario strumenti**                        |
| `instruments-overview.png`                         | §9.1            | `/admin/instruments`                       |
| `instruments-loans-all.png`                        | §9.2            | `/admin/instruments?tab=loans-all`         |
| `instruments-overdue.png`                          | §9.3            | `/admin/instruments?tab=overdue`           |
| `instruments-loan-rules.png`                       | §9.4            | `/admin/instruments?tab=loan-rules`        |
| **§10 Statistiche / §11 Annunci**                  |
| `analytics-overview.png`                           | §10             | `/admin/analytics`                         |
| `announcements-overview.png`                       | §11             | `/admin/announcements`                     |
| **§12 Impostazioni Server**                        |
| `server-settings-aspetto.png`                      | §12.0           | `/admin/server-settings/aspetto`           |
| `server-settings-servizi-mail.png`                 | §12.1           | `/admin/server-settings/servizi-mail`      |
| `server-settings-servizi-messaging.png`            | §12.3           | `/admin/server-settings/servizi-messaging` |
| `server-settings-qrcodes.png`                      | §12.2           | `/admin/server-settings/qrcodes`           |
| `server-settings-display.png`                      | §12.4           | `/admin/server-settings/display`           |
| `server-settings-audit-log.png`                    | §12.5           | `/admin/server-settings/audit-log`         |
| `server-settings-backups.png`                      | §12.6           | `/admin/server-settings/backups`           |
| `server-settings-moduli.png`                       | §12.7           | `/admin/server-settings/moduli`            |
| `mail-outbox-overview.png`                         | §12.1bis        | `/admin/mail-outbox`                       |

## Cattura manuale (alternativa)

Se preferisci catturare manualmente:

1. Apri Chrome / Firefox a 1440×900 (DevTools → Toggle device toolbar → Custom).
2. Vai su ciascuna URL della tabella sopra.
3. Scatta lo screenshot (macOS: `Cmd+Shift+4` con `Spazio`; Windows: `Win+Shift+S`).
4. Salva in questa cartella con il nome esatto della tabella.

## Aggiornare gli screenshot dopo modifiche UI

Lancia di nuovo lo script — sovrascrive i file esistenti. Per evitare diff
inutili nei PR, fai commit degli screenshot solo quando la UI è cambiata
visibilmente (non per ogni run).

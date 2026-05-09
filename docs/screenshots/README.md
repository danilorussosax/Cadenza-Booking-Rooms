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

### Screenshot attualmente referenziati dal manuale (v1.5 · 9 maggio 2026)

I 23 file PNG sotto sono quelli effettivamente referenziati da `MANUALE_ADMIN.md`. Sono già committati in `docs/screenshots/` e si aggiornano rilanciando lo script di cattura.

| File                                     | Sezione manuale | Pagina sorgente                                       |
| ---------------------------------------- | --------------- | ----------------------------------------------------- |
| **Login e accesso (§2)**                 |                 |                                                       |
| `login.png`                              | §2.1            | `/login` (provider scelto)                            |
| `login-email.png`                        | §2.1            | `/login` (form email + password)                      |
| `complete-profile.png`                   | §2.1            | `/complete-profile` (primo accesso)                   |
| **Vista utente (§2.3 – §2.5)**           |                 |                                                       |
| `dashboard-overview.png`                 | §2.3            | `/dashboard` (vista 1 giorno)                         |
| `dashboard-calendario-3giorni.png`       | §2.4            | `/dashboard` (toggle "3 giorni" attivo)               |
| `booking-page.png`                       | §2.5            | `/booking`                                            |
| `my-bookings.png`                        | §2.5            | `/my-bookings`                                        |
| `rooms-grouped.png`                      | §2.5            | `/rooms` (raggruppata per edificio)                   |
| `profile-page.png`                       | §2.5            | `/profile`                                            |
| **Form deroga Monte Ore (§3.7 / §8.10)** |                 |                                                       |
| `users-form-monteore-override.png`       | §3.7 / §8.10    | `/admin/users` (form Modifica docente)                |
| **Regole prenotazione (§6)**             |                 |                                                       |
| `rules-overview.png`                     | §6              | `/admin/rules`                                        |
| `rules-per-ruolo.png`                    | §6.1            | `/admin/rules?tab=per-ruolo`                          |
| `rules-quote.png`                        | §6.2            | `/admin/rules?tab=quote`                              |
| `rules-eccezioni.png`                    | §6.3            | `/admin/rules?tab=eccezioni`                          |
| `rules-eccezione-dialog.png`             | §6.3            | `/admin/rules?tab=eccezioni` (dialog Nuova eccezione) |
| **Monte Ore (§8)**                       |                 |                                                       |
| `monteore-overview.png`                  | §8              | `/admin/monte-ore`                                    |
| `monteore-settings.png`                  | §8.3            | `/admin/monte-ore/settings`                           |
| `monteore-proposte.png`                  | §8.5            | `/admin/monte-ore?tab=proposte`                       |
| `monteore-amendments.png`                | §8.6            | `/admin/monte-ore?tab=amendments`                     |
| `monteore-docente-banner.png`            | §8.10           | `/monte-ore` (vista docente con override)             |
| **Impostazioni Server (§12)**            |                 |                                                       |
| `server-settings-aspetto.png`            | §12.5           | `/admin/server-settings?tab=aspetto`                  |
| `server-settings-servizi-mail.png`       | §12.1           | `/admin/server-settings?tab=servizi&sub=mail`         |
| `server-settings-servizi-messaging.png`  | §12.3           | `/admin/server-settings?tab=servizi&sub=messaging`    |

### Altri screenshot disponibili (non referenziati dal manuale, ma utili)

Lo script genera anche questi (utili per slide / training / debug ma non mostrati direttamente nel manuale): `users-overview.png`, `users-oauth-providers.png`, `courses-overview.png`, `courses-livelli.png`, `structure-sedi.png`, `structure-dotazioni.png`, `approvals-overview.png`, `activity-log-overview.png`, `bookings-overview.png`, `instruments-overview.png`, `instruments-loans-all.png`, `instruments-overdue.png`, `instruments-loan-rules.png`, `analytics-overview.png`, `announcements-overview.png`, `mail-outbox-overview.png`, `server-settings-backups.png`, `server-settings-qrcodes.png`, `server-settings-display.png`, `server-settings-audit-log.png`, `server-settings-moduli.png`, `rules-quote-prestiti.png`, `profile-app-icon.png`, `admin-monteore-contract-types.png`.

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

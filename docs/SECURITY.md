# Sicurezza · Verifica in due passaggi via codice email

Questa guida spiega come funziona la **2FA via email** in Cadenza e come gli amministratori la configurano.

> Riferimento codice: `backend/services/twoFa.js`, `backend/services/emailService.js#sendSecurityEmail`, `backend/middleware/auth.js`, `backend/routes/auth.js` (sezione `/api/auth/2fa/*`), `frontend/src/components/profile/TwoFaSection.tsx`, `frontend/src/pages/auth/Login.tsx` (TwoFaView).

---

## 1. Cos'è la 2FA email in Cadenza

Cadenza utilizza una **OTP via email**: a ogni accesso (e per le operazioni sensibili sul 2FA stesso) il backend genera un codice di **6 cifre random**, lo invia all'email dell'utente e lo verifica al ritorno. Il codice scade in **10 minuti** (configurabile via `TWO_FA_TTL_MIN`) e ha un cap di **5 tentativi errati** (`TWO_FA_MAX_ATTEMPTS`) prima di essere invalidato.

Vantaggi rispetto al TOTP:

- **Zero setup utente**: non serve installare un'app, scansionare QR, copiare segreti.
- **Onboarding immediato**: l'utente conosce già la propria casella email.
- **Recovery integrato**: l'email è il canale di reset password → coerenza UX.

Limiti:

- Dipende dalla **disponibilità SMTP** (vedi §2): senza configurazione SMTP il login con 2FA fallisce.
- Latenza: il codice arriva tipicamente in 1-30 sec ma può tardare se il provider è congestionato. La UI mostra un bottone "Reinvia codice".
- Sicurezza email-channel: se la casella dell'utente è compromessa, lo è anche il 2FA. Per asset critici (admin) usare in combinazione con una password robusta + monitoraggio anomalie.

> 📌 **Recovery codes** restano disponibili come canale alternativo: 10 codici stampabili (single-use) generati al momento dell'attivazione.

---

## 2. Configurazione del server (prerequisito)

### SMTP (obbligatorio)

Senza un transporter SMTP configurato, l'invio dei codici fallisce e gli utenti con 2FA attivo non possono fare login. Configura SMTP da `/admin/mail` (UI) oppure via env:

```env
SMTP_HOST=smtp.tuoprovider.it
SMTP_PORT=587
SMTP_SECURE=false        # true se porta 465
SMTP_USER=noreply@conservatorio.it
SMTP_PASS=...
SMTP_FROM="Conservatorio · Cadenza <noreply@conservatorio.it>"
```

Le email di sicurezza (`sendSecurityEmail`) **non rispettano** le preferenze granulari (`emailNotifications`, `notifyOnConfirmation`, ecc.): vanno SEMPRE inviate.

### Branding

```env
# Mostrato nel subject e nell'header HTML dell'email codice
TWO_FA_ISSUER=Conservatorio · Cadenza
# Scadenza codice in minuti (default 10)
TWO_FA_TTL_MIN=10
# Tentativi max prima dell'invalidazione (default 5)
TWO_FA_MAX_ATTEMPTS=5
# Grace period in giorni per gli admin (default 7)
TWO_FA_GRACE_DAYS=7
```

> Niente `TWO_FA_ENC_KEY`: la versione email NON memorizza alcun segreto persistente. La challenge in DB è solo un hash bcrypt del codice (privo di valore una volta scaduto).

---

## 3. Flusso utente: attivare la 2FA

L'utente accede al profilo (`/profile`) e nella sezione **"Sicurezza · Verifica in due passaggi (email)"** trova un toggle.

### Setup

1. **Toggle "Attiva"** → backend chiama `issueAndSendTwoFaCode(user, 'enroll')`:
   - Genera codice 6 cifre, hashato con bcrypt (cost 8)
   - Salva `{ hash, expiresAt, attempts: 0, purpose: 'enroll' }` in `users.twoFaChallenge`
   - Invia email `Conservatorio · Cadenza · Codice di accesso` con il codice in chiaro
2. **UI mostra "Codice inviato a m\***@example.it"\*\* + input.
3. **Inserimento codice** → POST `/api/auth/2fa/verify { code }`:
   - Validazione bcrypt + scadenza + cap tentativi
   - Se ok: `twoFaEnabled=true`, `twoFaActivatedAt=now()`, genera 10 recovery codes restituiti **una sola volta**.
4. L'utente DEVE salvare i recovery codes (copia, stampa, password manager).

### Login con 2FA attivo

1. POST `/api/auth/login` con email+password.
2. Se `user.twoFaEnabled`: backend genera challenge + invia email automaticamente → 200 `{ needsTwoFa: true, tempToken, sentTo: 'm***@x.it', expiresInMinutes: 10 }`.
3. Frontend mostra TwoFaView con email mascherata + bottone "Reinvia codice" + timer.
4. Utente inserisce codice → POST `/api/auth/2fa/verify { tempToken, code }` → 200 `{ token, user }`.

Errori specifici:

- `401 TWO_FA_INVALID_CODE`: codice errato (resta nel cap di 5 tentativi)
- `401 TWO_FA_EXPIRED`: codice scaduto (l'utente deve cliccare "Reinvia")
- `429 TWO_FA_TOO_MANY_ATTEMPTS`: superati i 5 tentativi → richiedere nuovo codice
- `503 TWO_FA_SEND_FAILED`: SMTP down → la UI mostra il messaggio + permette retry

### Disattivazione e rigenerazione recovery

Entrambe richiedono un nuovo codice email valido (no operazioni distruttive con la sola sessione attiva):

1. Click su "Disattiva" o "Rigenera recovery codes" → backend manda subito un codice email
2. UI mostra input + bottone "Reinvia"
3. Inserimento → conferma operazione
4. Per disattivazione: `twoFaEnabled=false`, ma `twoFaActivatedAt` resta valorizzato (per il middleware admin grace-period: chi ha già attivato non riparte da 0).

In alternativa, su disattivazione l'utente può presentare un **recovery code** (utile se la casella email è inaccessibile).

---

## 4. Enforcement per amministratori

`backend/middleware/auth.js` espone:

- `enforceAdminTwoFa(user, res)` — usato internamente da `authenticate` per intercettare ogni request di admin senza 2FA.
- `require2FAForAdmin` — middleware standalone per usi mirati.

### Logica di enforcement

```
admin con twoFaEnabled=true       → next() (header X-TwoFa-Grace-Days-Left non emesso)
admin con twoFaActivatedAt=null:
  - account < 7 giorni            → next() + header X-TwoFa-Grace-Days-Left: <residui>
  - account ≥ 7 giorni            → 403 TWO_FA_REQUIRED_FOR_ADMIN
admin con twoFaActivatedAt!=null e twoFaEnabled=false (riattivazione richiesta)
                                  → 403 TWO_FA_REQUIRED_FOR_ADMIN immediato
```

Bypass automatici (l'admin DEVE poter completare il setup):

- `/api/auth/me`
- `/api/auth/logout`
- `/api/auth/change-password`
- `/api/auth/2fa/*`

Per il frontend admin, l'header `X-TwoFa-Grace-Days-Left` permette di mostrare un countdown giornaliero non bloccante.

---

## 5. Architettura tecnica

### Challenge in DB

Schema `users.twoFaChallenge` (JSON, nullable):

```json
{
  "hash": "$2a$08$...", // bcrypt cost 8 del codice 6 cifre
  "expiresAt": "2026-04-28T01:30:00.000Z",
  "attempts": 0,
  "purpose": "login" // login | enroll
}
```

- **Single-shot**: ogni nuova `issueAndSendTwoFaCode` sovrascrive la challenge precedente (le UI mostrano "Reinvia codice" → reset attempts a 0).
- **Cleanup**: la challenge viene azzerata sia in caso di verify riuscita (codice consumato) sia in caso di troppi tentativi/scadenza.
- `consumeChallenge(stored, code)` ritorna `{ ok, reason, updated }`: il chiamante salva `user.twoFaChallenge = updated` (può essere `null` per scartare).

### Recovery codes

- 10 codici random (80 bit ciascuno) generati con `crypto.randomBytes`.
- Salvati come array di **hash bcrypt cost 4** (codice random già forte → niente brute-force).
- Single-use: alla verifica, l'indice trovato viene rimosso dall'array.

### JWT pre-2FA

- Claim: `{ id, tfa: 'pre' }`.
- TTL: **5 minuti**.
- Firmato con lo stesso `JWT_SECRET` dell'app.
- Il guard `verifyPre2faToken` rifiuta token con `tfa !== 'pre'` → impossibile usarlo come token di sessione.

### Endpoint API

| Metodo | Path                     | Auth                                          | Note                                                      |
| ------ | ------------------------ | --------------------------------------------- | --------------------------------------------------------- |
| POST   | `/api/auth/2fa/setup`    | Bearer                                        | Manda codice via email. NON attiva.                       |
| POST   | `/api/auth/2fa/resend`   | Bearer **OR** body.tempToken                  | Rigenera + manda email                                    |
| POST   | `/api/auth/2fa/verify`   | Bearer (enroll) **OR** body.tempToken (login) | Verifica codice + (al primo enroll) emette recovery codes |
| POST   | `/api/auth/2fa/recovery` | Bearer + nuovo codice email                   | Rigenera 10 recovery codes                                |
| POST   | `/api/auth/2fa/disable`  | Bearer + nuovo codice email/recovery          | Disattiva 2FA                                             |
| GET    | `/api/auth/2fa/status`   | Bearer                                        | Stato corrente per UI profilo                             |

### Email template

Inline HTML in `routes/auth.js#issueAndSendTwoFaCode`. Layout minimale (max 480px, palette `#3762aa` + sfondo `#f7f9fc`), codice in box monospace 34pt, hint "se non hai richiesto tu il codice ignora". Inviata via `sendSecurityEmail` (transporter cached da `loadConfig`, bypass preferenze utente).

---

## 6. Procedura operativa per il primo admin

Al primo deploy il seeder crea l'admin `admin@conservatorio.it / Admin123!` con `twoFaEnabled=false`.

1. Login → cambia subito la password di default.
2. Configura SMTP da `/admin/mail` (test invio incluso). Senza SMTP funzionante non puoi attivare il 2FA.
3. Apri `/profile` → sezione 2FA → toggle "Attiva".
4. Controlla la casella email: arriva un codice 6 cifre.
5. Inserisci il codice → ricevi 10 recovery codes → **salvali in un posto sicuro** (password manager, cassaforte, busta sigillata).
6. Logout + login con email/password + codice email → conferma il flusso completo.

Da questo momento gli altri admin che vorrai aggiungere avranno 7 giorni dalla creazione per attivare il 2FA, oppure la loro autenticazione admin sarà bloccata.

---

## 7. Recupero account perduto

Se un admin perde **sia** l'accesso alla casella email **sia** i recovery codes:

1. Un altro admin può aprire una utility a riga di comando sul backend:
   ```bash
   cd backend
   node -e "
     const { sequelize, User } = require('./models');
     (async () => {
       const u = await User.findOne({ where: { email: 'TARGET@example.it' } });
       u.twoFaEnabled = false;
       u.twoFaChallenge = null;
       u.twoFaRecoveryCodes = null;
       // NB: lasciamo twoFaActivatedAt valorizzato così il middleware blocca
       // immediatamente le operazioni admin finché non rifa il setup.
       u.tokenVersion = (u.tokenVersion || 0) + 1; // kick all sessioni
       await u.save();
       console.log('reset OK');
       await sequelize.close();
     })();
   "
   ```
2. L'utente recupera prima l'accesso alla casella email (procedura interna IT), poi rifà il setup dal profilo.
3. La procedura va loggata su AuditLog manualmente per tracciabilità.

---

## 8. Test e verifica

```bash
cd backend
npx vitest run tests/integration/auth.test.js
```

Verifiche manuali consigliate:

1. Setup → email arriva → conferma → recovery codes salvati. Logout + login con codice email funziona.
2. Login con codice scaduto → 401 `TWO_FA_EXPIRED`. Click "Reinvia codice" → nuovo codice → ok.
3. 6 codici sbagliati di fila → 429 `TWO_FA_TOO_MANY_ATTEMPTS` → reinvio obbligatorio.
4. Logout + login con recovery code: il codice usato non funziona la 2ª volta.
5. Disattiva: serve nuovo codice email. Stop SMTP → la disattivazione fallisce con 503 (corretto, evita disable a sessione compromessa).
6. Admin senza 2FA su account vecchio → admin endpoints rispondono 403 `TWO_FA_REQUIRED_FOR_ADMIN`. Frontend redirige a `/profile`.

---

## 9. Riferimenti normativi

- **OWASP ASVS v4 §2.7** — multi-factor authentication. Cadenza copre `2.7.4` (OOB authenticator: l'email è un canale OOB rispetto al browser) e `2.7.6` (server non rivela se il primo fattore era valido in caso di errore al secondo step).
- **NIST SP 800-63B AAL2** — l'email-OTP è classificato come "Out-of-Band" + "look-up secret" (recovery codes). Per AAL3 sarebbe richiesto un autenticatore hardware (YubiKey, ecc.) — non in scope.
- **GDPR art. 32** — la verifica in due passaggi è una misura tecnica appropriata per l'accesso a dati personali. La challenge non contiene PII oltre all'email del destinatario stesso (no leak cross-utente).

In ottica ISAE 3000 / SOC 2: la 2FA email è accettabile per la maggior parte dei casi d'uso PA italiana ed è la scelta meno burocratica per i conservatori. Per asset altamente critici considerare un upgrade futuro a TOTP+app o WebAuthn.

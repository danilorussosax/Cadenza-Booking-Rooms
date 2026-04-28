# Cadenza · Roadmap Enterprise & Integrazioni PA

> **Documento operativo per il team di sviluppo** — focus su funzionalità "enterprise" che sbloccano i conservatori AFAM grandi e l'integrazione con i sistemi gestionali italiani.
> **Aggiornato al 28 aprile 2026** · complementare a [`develop.md`](./develop.md) (roadmap generale) e [`../analisi.md`](../analisi.md) (analisi commerciale).
>
> Il presente documento espande in profondità le sezioni `develop.md § 2.9` (SPID/CIE), `§ 2.13` (sync anagrafiche), `§ 2.14` (RFID), aggiunge **autenticazione LDAP/AD** non prevista, e include i prompt di implementazione pronti all'uso.

---

## 0. Quick reference

- **Stato attuale auth/integrazioni**: OAuth2 Google + Microsoft (passport.js), local username/password (bcrypt cost 12), 2FA email, OAuth settings UI cifrate.
- **Gap critici per fascia "enterprise" PA italiana**: nessun SSO LDAP/AD/SAML, nessuna sincronizzazione anagrafiche con Isidata/Esse3, retention audit fissa 24 mesi.
- **Stack di riferimento**: Node 18+ / Express 4 / Sequelize 6 / Postgres 16, libreria crypto in `backend/lib/crypto.js` (AES-256-GCM, riusabile per credenziali integrazioni), modello `OAuthSettings` come pattern per nuove `*Settings`.

**Legenda priorità** (allineata a develop.md):

- 🔴 P0 — bloccante per categoria di clienti enterprise
- 🟠 P1 — sblocca segmento (es. tutti i conservatori AD-based)
- 🟢 P2 — incremento ROI, on-demand cliente
- 🔵 P3 — adempimenti specialistici / regolatorio

**Stime effort** (allineate): **S** ≤ 1g · **M** 2-5g · **L** ≥ 1 settimana · **XL** ≥ 1 mese.

---

## 1. Quadro fattuale: cosa esiste oggi e cosa manca

### 1.1 Stato auth in `backend/`

| Funzionalità                                      | File                                                       | Stato                       |
| ------------------------------------------------- | ---------------------------------------------------------- | --------------------------- |
| Username/password locale + bcrypt cost 12         | `routes/auth.js`                                           | ✅ Production               |
| OAuth2 Google                                     | `routes/auth.js` (passport-google-oauth20)                 | ✅ Production               |
| OAuth2 Microsoft                                  | `routes/auth.js` (passport-microsoft)                      | ✅ Production               |
| 2FA email + recovery codes                        | `services/twoFa.js`                                        | ✅ Production               |
| JWT 2h + tokenVersion (logout effettivo)          | `routes/auth.js`                                           | ✅ Production               |
| Rate-limit auth (5/15min login, 3/30min register) | `app.js`                                                   | ✅ Production               |
| OAuth settings UI cifrato AES-256-GCM             | `routes/admin/oauthSettings.js`, `models/OAuthSettings.js` | ✅ Production               |
| **LDAP/AD bind**                                  | —                                                          | ❌ **Da implementare**      |
| **SAML 2.0 federation** (IDEM-GARR)               | —                                                          | ❌ Da implementare          |
| **SPID/CIE**                                      | —                                                          | ❌ Roadmap develop.md § 2.9 |

### 1.2 Stato sync anagrafiche

| Provider                                         | Stato              | Note                                                         |
| ------------------------------------------------ | ------------------ | ------------------------------------------------------------ |
| Manual CSV import                                | ✅ Production      | `routes/users.js` import file CSV (utenti)                   |
| Auto-sync **Isidata**                            | ❌ Da implementare | ~70-80% conservatori AFAM lo usano (anagrafica + segreteria) |
| Auto-sync **Esse3 (Cineca)**                     | ❌ Da implementare | Conservatori grandi (Milano, alcuni grandi atenei integrati) |
| Sync **Spaggiari** (registro elettronico scuole) | ❌ Out of scope    | Non rilevante per conservatori AFAM                          |

### 1.3 Pattern riusabili dal codice esistente

Il progetto ha già modelli e pattern direttamente applicabili alle nuove integrazioni:

- **`OAuthSettings`** (`models/OAuthSettings.js`): pattern di "settings cifrate" per provider esterni — credenziali serializzate con `lib/crypto.js` (AES-256-GCM con KEY env), placeholder UI per i secrets.
- **`MessagingSettings`** + **`messaging/adapters/*.js`**: pattern adapter pluggable già usato per Telegram/WhatsApp/Signal/Email — replicabile per `auth/adapters/*.js` e `integrations/*.js`.
- **`reminderScheduler.js`**: cron 5' che esegue task ricorrenti — replicabile per sync notturno.
- **`AuditLog`**: target_type custom + payload JSON — già usato per messaging, riutilizzabile per audit delle sync (`target_type='IntegrationSync'`).

> **Implicazione progettuale**: tutto il codice di questa roadmap segue gli stessi pattern già consolidati, riducendo il rischio di regressione e i tempi di review.

---

## 2. 🟠 LDAP / Active Directory authentication (P1)

### 2.1 Razionale

I conservatori italiani medi e grandi tipicamente hanno un **Active Directory aziendale** (gestito dall'ufficio IT del conservatorio o federato con la rete della Regione/Università) per docenti e personale amministrativo. Senza SSO LDAP/AD:

- Gli utenti devono creare credenziali Cadenza separate da quelle istituzionali → frizione, password reuse, sicurezza ridotta.
- I direttori IT spesso pongono come **requisito di gara** l'integrazione LDAP — è uno dei primi filtri tecnici.
- L'admin deve gestire manualmente l'on/off-boarding (creare/disattivare account) invece di riusare il ciclo di vita Active Directory.

**Stima del segmento di mercato**: dei ~70 conservatori statali, almeno 25-35 dichiarano AD/LDAP nelle policy IT pubblicate (siti istituzionali). LDAP nativo sblocca ~50% del mercato target.

### 2.2 Profilo dei sistemi target

| Sistema                                  | Diffusione AFAM                       | Dialetto LDAP        | Note                                                    |
| ---------------------------------------- | ------------------------------------- | -------------------- | ------------------------------------------------------- |
| **Microsoft Active Directory** (on-prem) | ~50% conservatori medi/grandi         | LDAPv3, schema MS    | Bind via UPN (`user@conservatorio.it`) o sAMAccountName |
| **Microsoft Entra ID** (ex Azure AD)     | crescente, post-PNRR                  | LDAP via Azure AD DS | Bind via UPN, tipicamente preferito SAML/OIDC sopra     |
| **OpenLDAP**                             | ~10-15% (conservatori con IT interno) | LDAPv3 stock         | Schema custom, posixAccount/inetOrgPerson               |
| **FreeIPA / Red Hat IdM**                | rari (ma presenti)                    | LDAPv3 + Kerberos    | DN `uid=user,cn=users,cn=accounts,dc=...`               |
| **GARR IDEM** (federation universitaria) | conservatori federati con atenei      | SAML 2.0 sopra LDAP  | Vedi § 5.1 — non LDAP diretto                           |

### 2.3 Approccio tecnico

**Stack scelto**: `ldapjs` 3.x (low-level, mantenuto, supporta TLS) + wrapper custom in `backend/services/auth/ldapAuth.js`. Rifiuto `passport-ldapauth` perché:

- Aggiunge un layer Passport.js non necessario (usiamo già `routes/auth.js` con flow custom)
- Non gestisce nativamente la separazione bind-search e bind-auth (importante per AD)
- Manutenzione meno attiva (`ldapjs` ha 8M download/settimana vs 50k)

**Flusso di autenticazione (3 fasi)**:

```
┌──────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│  POST /api/auth/ │       │  ldapAuth       │       │  LDAP/AD server │
│   ldap/login     │──────►│  service        │──────►│                 │
│  {user, pass}    │       │                 │       │                 │
└──────────────────┘       └─────────────────┘       └─────────────────┘
                                    │
                          1) bind admin (bindDN, bindPwd)
                                    │
                          2) search (uid=$user OR mail=$user)
                                    │  → DN, attributes (cn, mail, sn, memberOf)
                                    │
                          3) re-bind userDN with provided password
                                    │
                                    ▼
                          ┌─────────────────────┐
                          │  upsert User in DB  │
                          │  + map groups→role  │
                          │  + sign JWT 2h      │
                          └─────────────────────┘
```

### 2.4 Modello dati

Nuova tabella `LdapSettings` (singleton, riuso pattern `OAuthSettings`/`MailSettings`):

```ts
LdapSettings {
  id: 1,                                     // sempre 1, singleton
  isEnabled: BOOLEAN,                        // master switch
  serverUrl: STRING,                         // ldaps://ad.cons.it:636 (TLS obbligatorio in prod)
  bindDN: STRING,                            // CN=svc-cadenza,OU=Service,DC=cons,DC=it
  bindPasswordEncrypted: TEXT,               // AES-256-GCM via lib/crypto.js
  searchBase: STRING,                        // OU=People,DC=cons,DC=it
  searchFilter: STRING,                      // (|(uid={u})(mail={u})(sAMAccountName={u}))
  attrFirstName: STRING,                     // 'givenName' (AD) o 'cn' (OpenLDAP)
  attrLastName: STRING,                      // 'sn'
  attrEmail: STRING,                         // 'mail'
  attrMatricola: STRING (nullable),          // 'employeeNumber' o custom
  attrGroups: STRING,                        // 'memberOf'
  groupRoleMapping: JSON,                    // {"CN=Docenti,...": "docente", ...}
  defaultRole: ENUM('studente','docente'),   // se nessun gruppo matcha
  autoCreateUsers: BOOLEAN,                  // se true, crea User al primo login
  autoApprove: BOOLEAN,                      // se true, status='approved' al create
  tlsRejectUnauthorized: BOOLEAN,            // false per CA self-signed (DEV ONLY)
  connectTimeoutMs: INTEGER,                 // default 5000
  searchTimeoutMs: INTEGER,                  // default 10000
  lastSuccessAt: DATE (nullable),
  lastFailureAt: DATE (nullable),
  lastFailureMessage: TEXT (nullable)
}
```

Estensione `User`:

```ts
User.authProvider: ENUM('local','google','microsoft','ldap')  // tracking
User.ldapDN: STRING (nullable, UNIQUE if not null)            // per "trust" sync futuri
User.lastLdapSyncAt: DATE (nullable)
```

### 2.5 Sicurezza

- **TLS obbligatorio in produzione**: il middleware respinge `serverUrl` con schema `ldap://` quando `NODE_ENV=production`. Solo `ldaps://` o `ldap://` localhost in dev.
- **Bind credentials cifrate**: `bindPasswordEncrypted` con AES-256-GCM (chiave da `LDAP_ENC_KEY` env, fallback `APP_ENC_KEY`).
- **Rate limiting**: ereditato dal middleware `loginLimiter` esistente (5 tentativi/15min/IP).
- **Lockout post-failures**: se 5+ failure consecutivi sullo stesso username → blocco 30min in tabella `LoginAttempt` (nuova).
- **No password leakage**: la password utente è passata SOLO al re-bind LDAP, mai loggata.
- **Group injection prevention**: il `searchFilter` accetta solo `{u}` come placeholder, escapato con `ldap-escape` (RFC 4515) per evitare LDAP injection (es. `*)(uid=admin)`).
- **Audit trail**: ogni tentativo LDAP scrive in `AuditLog` con `target_type='LdapAuth'`, payload `{username, success, error, ip, ua, ldapDN: success ? dn : null}`.
- **Secret leak prevention**: GET `/api/admin/ldap-settings` non ritorna mai `bindPasswordEncrypted`, solo flag `hasBindPassword: true|false`. PUT permette update parziale (pattern già usato in MailSettings).

### 2.6 UI admin

Nuova pagina `/admin/ldap-settings` (oppure tab dentro nuova pagina `/admin/auth-providers`):

- **Card "Stato connessione"**: enabled toggle, last success/failure with timestamp + message
- **Card "Server"**: URL, bindDN, bindPassword (campo password mai pre-compilato), search base, search filter (con tooltip che mostra placeholder validi)
- **Card "Mapping attributi"**: tabella key-value per firstName/lastName/email/matricola/groups
- **Card "Mapping ruoli"**: tabella `groupDN → role`, drag-and-drop per priorità
- **Card "Auto-provisioning"**: toggle autoCreateUsers, autoApprove (con warning se entrambi true)
- **Pulsante "Testa connessione"**: bind admin + search dummy filter, ritorna ms + N risultati senza modificare DB
- **Pulsante "Testa autenticazione utente"**: prompt admin per username+password test, esegue il flow completo end-to-end senza creare User

### 2.7 Effort dettagliato

| Step                                                              | Tempo                   |
| ----------------------------------------------------------------- | ----------------------- |
| Setup `ldapjs` + crypto helper                                    | 0.5 g                   |
| Modello `LdapSettings` + migration                                | 0.5 g                   |
| Service `services/auth/ldapAuth.js` (search + bind + escape)      | 1.5 g                   |
| Routes `/api/auth/ldap/login` + `/api/admin/ldap-settings`        | 1 g                     |
| Group→role mapping engine                                         | 0.5 g                   |
| User upsert con `authProvider='ldap'` + auto-approve              | 0.5 g                   |
| UI `/admin/ldap-settings` (5 card + test buttons)                 | 2 g                     |
| Login form: tab "LDAP" affianco a "Email" + OAuth                 | 0.5 g                   |
| Lockout per failure consecutivi (`LoginAttempt`)                  | 0.5 g                   |
| Audit log + Sentry tagging                                        | 0.5 g                   |
| Test integration (bind ok/fail/timeout, escape, lockout, mapping) | 2 g                     |
| i18n IT/EN/ES + docs `docs/LDAP.md`                               | 1 g                     |
| **Totale**                                                        | **~11 gg uomo (≈ M-L)** |

### 2.8 Prompt di implementazione

```prompt
Implementa autenticazione LDAP/Active Directory per Cadenza.

OBIETTIVO
Permettere a un utente di accedere con le credenziali del directory aziendale
del conservatorio (AD on-prem, OpenLDAP, FreeIPA), con upsert automatico
dell'utente locale e mapping gruppi LDAP → ruolo applicativo.

VINCOLI
- Riusa `lib/crypto.js` (AES-256-GCM) per cifrare bindPassword.
- TLS obbligatorio in production (ldaps:// o STARTTLS): rifiuta ldap:// se
  NODE_ENV=production e host != localhost.
- Riusa `loginLimiter` esistente per rate-limiting.
- Pattern UI/secrets/test: imitare `MailSettings` e `OAuthSettings`.
- LDAP injection prevention: escape RFC 4515 sul filter via npm `ldap-escape`.

STEP

1) Dipendenze
   npm install ldapjs ldap-escape

2) Modello LdapSettings (singleton id=1) — vedi schema § 2.4 develop-enterprise.md.
   Aggiungi User.authProvider ENUM con valori 'local','google','microsoft','ldap'
   (default 'local'), User.ldapDN STRING UNIQUE nullable, User.lastLdapSyncAt.
   Migration in lib/preSyncMigrations.js (idempotente come gli altri).

3) Service backend/services/auth/ldapAuth.js export:
   - testConnection(settings) → {ok, ms, sampleCount, error}
   - authenticate(username, password) → {ok, user|null, error|null}
     a) load LdapSettings
     b) bind admin (bindDN, decrypted bindPassword)
     c) search by searchFilter substituting {u} (escapato) — base=searchBase, scope='sub'
     d) prendi il primo risultato, leggi attributi mappati
     e) re-bind userDN con la password fornita
     f) extract groups da memberOf, mappa via groupRoleMapping → role
     g) upsert User (firstName, lastName, email, matricola, ldapDN), set
        authProvider='ldap', status=autoApprove?'approved':'pending'
     h) ritorna user

4) Routes
   - POST /api/auth/ldap/login {username, password}: chiama authenticate, su
     success firma JWT 2h e ritorna come /api/auth/login normale. Su failure
     incrementa LoginAttempt, blocca dopo 5 tentativi consecutivi (30 min).
   - GET /api/admin/ldap-settings → mai espone bindPasswordEncrypted, ritorna
     hasBindPassword:bool.
   - PUT /api/admin/ldap-settings (bindPassword: opzionale, se assente non
     aggiorna; se 'CLEAR_SECRET' azzera).
   - POST /api/admin/ldap-settings/test (testConnection senza commit DB).
   - POST /api/admin/ldap-settings/test-auth {testUsername, testPassword}
     (full flow, no user creation).

5) UI frontend
   - frontend/src/pages/admin/LdapSettings.tsx: card layout descritto in § 2.6.
     Field bindPassword: input password con flag isDirty per non
     sovrascrivere se vuoto (pattern MailSettings).
   - frontend/src/api/ldap.ts client.
   - frontend/src/pages/auth/Login.tsx: aggiungi tab "LDAP/AD" se
     LdapSettings.isEnabled (esposto da pubblico /api/auth/providers).
   - i18n IT/EN/ES per tutte le label.

6) Audit + observability
   - Ogni tentativo LDAP scrive in AuditLog (target_type='LdapAuth', payload
     {username, success, error, ldapDN, ms}).
   - Sentry tag auth_method='ldap' su evento error.
   - Log Pino strutturato con redact bindPassword/userPassword.

7) Test integration (Vitest + ldap-server-mock o testcontainers OpenLDAP)
   - bind admin success / fail
   - search filter escape (caso `*)(cn=admin)` non bypassa)
   - re-bind user password ok / wrong
   - group→role mapping (docente, studente, no match → defaultRole)
   - autoCreateUsers off → utente non in DB → 401
   - lockout dopo 5 fail consecutivi
   - TLS forced in production rejection ldap://

8) Documentazione
   - docs/LDAP.md: istruzioni complete per direttori IT — esempi AD,
     OpenLDAP, FreeIPA con search filter pronti.
   - Sezione troubleshooting (cert self-signed, NTLM only, group nidificati).

DELIVERABLES
- 11 gg dev + test, target review code quality strictTypeChecked
- Test coverage ldapAuth.js ≥ 80%
- Demo: video 3 min flow login LDAP end-to-end
```

---

## 3. 🟠 Sincronizzazione Isidata (P1 per AFAM)

### 3.1 Profilo Isidata

[Isidata SRL](https://www.isidata.it) (P.IVA italiana, sede Roma) è il fornitore dominante del software gestionale per i conservatori italiani:

- **Diffusione stimata**: 70-80% dei 70 conservatori statali italiani (basato su footprint pubblico dei portali `servizi*.isidata.net` e bandi per upgrade del modulo "ServiziStudenti")
- **Moduli coperti**: anagrafica studenti/docenti, immatricolazioni, esami, certificati, didattica, segreteria, contabilità
- **Tecnologia**: ASP.NET classico (server Windows), interfaccia web, **endpoint SOAP custom** disponibili tramite contratto con il vendor (non documentati pubblicamente)
- **Alternative pubbliche**: export manuale XLSX/CSV dal pannello segreteria

### 3.2 Strategia di integrazione

Dato che gli endpoint SOAP non sono documentati pubblicamente e richiedono accordo commerciale specifico, propongo un **approccio a tre livelli** che copre i tre scenari realistici di adozione cliente:

#### Livello A — Import CSV/XLSX manuale (MVP, sempre fattibile)

Il conservatorio esporta da Isidata un file XLSX con anagrafica studenti/docenti e lo carica nel pannello admin di Cadenza. Il sistema mostra un **preview diff** (X nuovi, Y aggiornati, Z disattivati) prima di applicare.

**Effort**: M (3-5 gg). Sblocca il 100% dei conservatori senza dipendenze esterne.

#### Livello B — Polling SOAP/REST con endpoint dedicato (per conservatori che hanno acquistato il modulo "Servizi Web" Isidata)

Il conservatorio fornisce ad Cadenza le credenziali del modulo Servizi Web Isidata. Cron notturno fa polling degli endpoint anagrafica e applica delta.

**Effort**: L (1-2 sett) per il template generico, **+M-L per ogni conservatorio specifico** (l'endpoint SOAP non è standard tra installazioni, vanno mappati i campi caso per caso).

#### Livello C — Webhook push (per conservatori che hanno un contratto custom con Isidata)

Isidata stesso pusha eventi (immatricolazione, ritiro) verso un webhook Cadenza. Real-time.

**Effort**: L (richiede contratto specifico Isidata-cliente, implementazione lato Cadenza è M).

### 3.3 Architettura comune (tutti e tre i livelli)

```
backend/services/integrations/
  index.js                  # registry dei provider attivi
  base.js                   # interfaccia comune Provider
  isidata/
    csvImporter.js          # Livello A: parser XLSX/CSV
    soapClient.js           # Livello B: client SOAP wrapper
    webhookHandler.js       # Livello C: handler push
    fieldMapping.js         # Mapping Isidata field → Cadenza User
    diffEngine.js           # Calcola added/updated/removed (riusato A,B,C)
  esse3/                    # vedi § 4
    ...
```

Interfaccia comune (`base.js`):

```ts
interface Provider {
  testConnection(): Promise<{ ok: boolean; message: string; ms: number }>;
  fetchUsers(opts: { limit?; offset?; since?: Date }): Promise<ExternalUser[]>;
  fetchCourses?(): Promise<ExternalCourse[]>;
}

interface ExternalUser {
  externalId: string; // ID univoco nel sistema sorgente
  matricola: string | null;
  firstName: string;
  lastName: string;
  email: string;
  role: 'studente' | 'docente' | 'admin';
  courseCode: string | null;
  courseLevel: string | null;
  status: 'active' | 'withdrawn' | 'graduated' | 'suspended';
  raw: object; // dati originali, per debugging
}
```

### 3.4 Modello dati

Nuova tabella `IntegrationConfig` (multipla, una riga per provider+istituto):

```ts
IntegrationConfig {
  id: PK,
  instituteId: FK Institute,
  provider: ENUM('isidata_csv','isidata_soap','isidata_webhook','esse3','custom'),
  isEnabled: BOOLEAN,
  credentialsEncrypted: TEXT,             // AES-256-GCM, struct JSON specifica per provider
  fieldMappingOverrides: JSON,            // override del default mapping del provider
  syncSchedule: STRING,                   // cron expression, es. '0 2 * * *' = 02:00 daily
  lastRunAt: DATE,
  lastRunStatus: ENUM('success','partial','error'),
  lastRunSummary: JSON,                   // {fetched, created, updated, skipped, errors}
  lastErrorMessage: TEXT,
  paranoid: true                          // soft delete
}
```

Nuova tabella `IntegrationSyncRun` (storico esecuzioni, per debug):

```ts
IntegrationSyncRun {
  id: PK,
  configId: FK IntegrationConfig,
  startedAt: DATE,
  finishedAt: DATE,
  triggeredBy: ENUM('cron','manual','webhook'),
  status: ENUM('running','success','partial','error'),
  fetched: INT,
  created: INT,
  updated: INT,
  skipped: INT,
  errors: INT,
  errorPayload: JSON,                     // primi 50 errori
  diffSnapshot: JSON,                     // sample diff per UI
}
```

### 3.5 Field mapping Isidata → Cadenza

Mapping di default (override per istituto):

| Isidata field                     | Cadenza User field  | Note                                                         |
| --------------------------------- | ------------------- | ------------------------------------------------------------ |
| `Matricola`                       | `matricola`         | UNIQUE — usato come primary external ID                      |
| `Cognome`                         | `lastName`          |                                                              |
| `Nome`                            | `firstName`         |                                                              |
| `EMail`                           | `email`             | UNIQUE — fallback se matricola assente                       |
| `TipoUtente` (Studente/Docente)   | `role`              | Mapping `Studente→studente`, `Docente→docente`, altro → skip |
| `CorsoCodice` (es. `DCPL01`)      | `courseId` (lookup) | Se non trova course → log warning, courseId=null             |
| `LivelloCorso` (Triennio/Biennio) | `courseLevel`       |                                                              |
| `StatoIscrizione`                 | logica conversione  | `Attivo→active`, `Ritirato→soft delete with isExternal=true` |

### 3.6 Strategia "mai cancellare"

Importante: l'integrazione **non cancella mai** utenti dal DB locale. Casi:

- Utente in Isidata con `StatoIscrizione=Ritirato` → User locale: `isActive=false` + `externalStatusNote='Ritirato in Isidata 2025-09-15'`
- Utente sparito dall'export Isidata (graduato o cambiato corso) → `isActive=false` + tag `external_orphan=true`
- Mai DELETE: lo storico prenotazioni/prestiti deve restare per audit GDPR

### 3.7 Effort dettagliato (Livello A)

| Step                                                                               | Tempo                    |
| ---------------------------------------------------------------------------------- | ------------------------ |
| Modello `IntegrationConfig` + `IntegrationSyncRun` + migration                     | 0.5 g                    |
| Library `xlsx` + parser `csvImporter.js`                                           | 1 g                      |
| `diffEngine.js` (calcolo delta + mock dry-run)                                     | 1 g                      |
| `fieldMapping.js` Isidata default + override engine                                | 0.5 g                    |
| Routes `/api/admin/integrations/isidata-csv/{upload,preview,apply}`                | 1 g                      |
| UI `/admin/integrations/isidata` (dropzone, preview tabella diff, apply)           | 2 g                      |
| i18n + docs `docs/INTEGRATIONS-ISIDATA.md` (con screenshot esempio export Isidata) | 1 g                      |
| Test unit (parser, diff edge cases) + integration (upload→preview→apply)           | 1.5 g                    |
| **Livello A totale**                                                               | **~8.5 gg uomo (≈ M-L)** |

### 3.8 Effort Livello B (SOAP polling)

Aggiunge sopra Livello A:

- `soapClient.js` con node-soap o axios + builder XML manuale | 2 g
- Handler tracker `since` (pull incrementale) | 0.5 g
- Cron scheduler (riusa pattern reminderScheduler.js) | 0.5 g
- UI scheduler config + log run history | 1 g
- Test mock SOAP server (xmldom + sample WSDL) | 2 g

**Livello B aggiuntivo**: ~6 gg → **totale A+B: 14.5 gg**.

### 3.9 Prompt di implementazione (Livello A — MVP)

```prompt
Implementa importazione anagrafica utenti via CSV/XLSX da Isidata in Cadenza.

OBIETTIVO
Permettere all'admin di caricare un file XLSX/CSV esportato da Isidata,
visualizzare un preview diff (utenti nuovi, aggiornati, da disattivare),
e applicare la sincronizzazione previa conferma esplicita. Mai cancellare
utenti locali — soft-disable + tag external_orphan.

VINCOLI
- Riuso del modulo `lib/crypto.js` se servono future credenziali (Liv B/C).
- Niente DELETE su User: max isActive=false. Storico prenotazioni intatto.
- Tutto in transazione SERIALIZABLE per garantire consistenza preview→apply.
- File ≤ 10 MB (validato). Parsing solo dei primi 5000 record per performance.

STEP

1) Dipendenze
   npm install xlsx

2) Modelli (Sequelize, paranoid where appropriate)
   - IntegrationConfig (id, instituteId, provider, isEnabled,
     credentialsEncrypted, fieldMappingOverrides JSON, syncSchedule,
     lastRunAt, lastRunStatus, lastRunSummary JSON, lastErrorMessage)
   - IntegrationSyncRun (id, configId, startedAt, finishedAt, triggeredBy,
     status, fetched, created, updated, skipped, errors, errorPayload JSON,
     diffSnapshot JSON, paranoid:false)
   - Estensione User: aggiungi colonne externalSource STRING,
     externalId STRING, externalStatusNote TEXT, lastExternalSyncAt DATE.
     UNIQUE INDEX (externalSource, externalId).
   - Migrazione idempotente in lib/preSyncMigrations.js.

3) Services
   - backend/services/integrations/base.js: interfaccia Provider
     {testConnection, fetchUsers, fetchCourses?}.
   - backend/services/integrations/diffEngine.js export:
     computeDiff(externalUsers: ExternalUser[], localUsers: User[],
                  matchBy: 'matricola'|'email'|'externalId') →
       {toCreate: ExternalUser[],
        toUpdate: {local: User, external: ExternalUser, fieldsChanged: string[]}[],
        toOrphan: User[]} (locali con externalSource='isidata' ma non in import)
   - backend/services/integrations/isidata/csvImporter.js:
     parse(buffer: Buffer, mimeType: string) → ExternalUser[].
     Supporta sia .xlsx (libreria xlsx) sia .csv (split su \n e , con quoting).
     Headers IT case-insensitive (Matricola/MATRICOLA/matricola).
   - backend/services/integrations/isidata/fieldMapping.js: mapping default +
     funzione applyOverrides(externalRow, overrides) → ExternalUser.

4) Routes (riusa middleware requireAdmin)
   - POST /api/admin/integrations/isidata-csv/preview
     multipart/form-data 'file', + body {instituteId, mappingOverrides?}.
     Risposta: {diff: {toCreate, toUpdate, toOrphan}, summary: {fetched,
     warnings: [{row, msg}]}}.
     NON modifica DB. Stateless.
   - POST /api/admin/integrations/isidata-csv/apply
     body {instituteId, mappingOverrides?, confirmedDiffHash}.
     Ricarica file dal blob storage temp (cache 10min Redis o filesystem
     `/tmp/cadenza-imports/{adminId}-{ts}.xlsx`), ricomputa diff, verifica
     hash matcha quello mostrato all'admin (anti-TOCTOU), applica in
     transazione SERIALIZABLE.
     Ritorna IntegrationSyncRun.id.
   - GET /api/admin/integrations/runs?providerId=...&limit=50: storia.

5) UI frontend
   - frontend/src/pages/admin/integrations/IsidataImport.tsx
     Step 1: dropzone "Trascina file XLSX di Isidata" + select istituto +
              expandable "Mapping campi" (override default).
     Step 2: tabella preview con 3 sezioni colorate (verde nuovi, blu
              aggiornati, ambra da disattivare). Filtri per ruolo/corso.
     Step 3: pulsante "Applica" con conferma + spinner + risultato.
   - frontend/src/api/integrations.ts client.
   - i18n IT/EN/ES.

6) Audit + observability
   - AuditLog target_type='IntegrationSyncRun', payload con summary.
   - Sentry transaction wrap su /apply.
   - Pino structured log per ogni warning di parsing.

7) Test
   - Unit: csvImporter (XLSX, CSV, BOM, encoding latin1, header missing,
     extra columns, malformed dates, null email).
   - Unit: diffEngine (matcher matricola/email priority, orphan detection,
     fieldsChanged delta).
   - Integration: upload→preview→apply round-trip, hash mismatch reject,
     transaction rollback on error.

8) Documentazione
   - docs/INTEGRATIONS-ISIDATA.md: come esportare da Isidata (steps con
     screenshot del pannello segreteria), spiegazione campi, troubleshooting
     (es. matricole con leading zero in Excel).

9) Liv B/C (separate roadmap items, dopo Liv A): aggiungi soapClient.js e
   webhookHandler.js seguendo l'interfaccia Provider.

DELIVERABLES
- 8.5 gg dev + test
- Coverage diffEngine ≥ 90%
- Documentazione utente con screenshot reali presa da un export Isidata di test
```

---

## 4. 🟠 Sincronizzazione Esse3 (Cineca) (P1 per atenei integrati)

### 4.1 Profilo Esse3

[Esse3](https://www.cineca.it/sistemi/esse3) di **Cineca** è la piattaforma SIS (Student Information System) leader nelle università italiane, e adottata da alcuni grandi conservatori "integrati" (es. Conservatorio di Milano in alcune sue dipendenze, Politecnico delle Arti di Bergamo). Caratteristiche tecniche:

- **REST API v3** documentata (`/api/v3/...`) — endpoints per `studenti`, `docenti`, `corsi`, `appelli`, `iscrizioni`
- **Autenticazione**: OAuth 2.0 client_credentials grant, OPPURE Basic Auth con API user dedicato
- **Webhook**: opzionale, configurabile in Esse3 Admin per push eventi (immatricolazione, voti)
- **Schema dati**: stabile, sincronizzato con specifiche Cineca cross-ateneo

### 4.2 Strategia

A differenza di Isidata, Esse3 ha un'API **standardizzata** tra installazioni. Un singolo client REST + mapping di default copre il 95% dei casi.

Approccio: **REST polling cron** (semplice, robusto) + **webhook opzionale** per eventi critici (immatricolazione, ritiro). Niente Liv A CSV — Esse3 ha sempre l'API disponibile per i clienti che pagano la licenza.

### 4.3 Architettura

```
backend/services/integrations/esse3/
  apiClient.js              # axios wrapper con OAuth2 token cache + retry
  fieldMapping.js           # Esse3 → ExternalUser
  syncJob.js                # cron handler
  webhookHandler.js         # POST /api/integrations/esse3/webhook
  webhookSignature.js       # HMAC verify (riusa pattern messagingWebhook.js)
```

### 4.4 Field mapping Esse3 → Cadenza

| Esse3 field (REST)                  | Cadenza User field      | Note                                                           |
| ----------------------------------- | ----------------------- | -------------------------------------------------------------- |
| `id` (esse3 internal)               | `externalId`            | string, stabile per ateneo                                     |
| `matricola`                         | `matricola`             | UNIQUE primary                                                 |
| `nome`, `cognome`                   | `firstName`, `lastName` |                                                                |
| `email`                             | `email`                 | sempre `@stud.uniXXX.it` per studenti, `@unipi.it` per docenti |
| `tipoSoggetto` (`STU`/`DOC`/`PTA`)  | `role`                  | `STU→studente`, `DOC→docente`, `PTA→admin` (?), altro skip     |
| `corsoStudio.codice`                | `courseId` (lookup)     | Es. `0509A` → cerca Course.code                                |
| `livelloCorso` (`L`/`LM`/`MS`/`DT`) | `courseLevel`           |                                                                |
| `statoIscrizione.attivo`            | `isActive`              | bool                                                           |

### 4.5 Sincronizzazione bidirezionale (opzionale)

Caso d'uso enterprise: un conservatorio vuole vedere in Esse3 le ore di studio individuale tracciate da Cadenza.

Esse3 espone POST endpoints per `attivita-didattiche-aggiuntive` (workshop, laboratori), ma NON per "ore studio individuale" standard. Bidirezionale è quindi limitato a "registrazione masterclass/concerto come attività didattica" — utile ma non MVP.

**Effort separato**: M (3-5 gg), solo on-demand cliente.

### 4.6 Effort

| Step                                                                         | Tempo                    |
| ---------------------------------------------------------------------------- | ------------------------ |
| Modello `IntegrationConfig` (riuso § 3.4)                                    | — (già fatto da Isidata) |
| `apiClient.js` con OAuth2 + token cache + axios-retry                        | 1.5 g                    |
| `fieldMapping.js` default + override                                         | 0.5 g                    |
| `syncJob.js` cron + delta detection (since lastRunAt)                        | 1.5 g                    |
| `webhookHandler.js` + HMAC verify                                            | 1 g                      |
| Routes /api/admin/integrations/esse3/\* (testConnection, manualRun, webhook) | 1 g                      |
| UI `/admin/integrations/esse3` config + history                              | 1.5 g                    |
| Test mock Esse3 server (msw o nock)                                          | 1.5 g                    |
| Docs `docs/INTEGRATIONS-ESSE3.md` con setup OAuth client side Cineca         | 0.5 g                    |
| **Totale**                                                                   | **~9 gg uomo (≈ L)**     |

### 4.7 Prompt di implementazione

```prompt
Implementa sincronizzazione anagrafiche da Esse3 (Cineca) verso Cadenza.

OBIETTIVO
Cron notturno + webhook real-time che importa studenti/docenti da Esse3 v3 API,
con delta detection (solo modifiche da lastRunAt), upsert idempotente, mai
DELETE locale.

PREREQUISITI
- Modelli IntegrationConfig + IntegrationSyncRun già implementati per Isidata
  (vedi prompt § 3.9). Riusa schema.
- diffEngine.js già implementato.

STEP

1) Dipendenze
   npm install axios axios-retry

2) backend/services/integrations/esse3/apiClient.js export class Esse3Client:
   - constructor(config: {baseUrl, clientId, clientSecret, scope?})
   - async getToken() → fetch /oauth/token con client_credentials, cache per
     `expires_in - 60s` in memoria con Map<config.id, {token, expiresAt}>.
   - async listStudenti({since?: Date, limit?: 500, offset?: 0}) →
     GET /api/v3/studenti?modificatoDopo=$ISO&limit=&offset= con bearer token.
     Retry 3x exp backoff su 5xx. Throw con codice nominato su 4xx.
   - async listDocenti(...): analogo.
   - async listCorsi(): analogo, used to populate Course.

3) backend/services/integrations/esse3/fieldMapping.js export
   mapStudente(raw): ExternalUser, mapDocente(raw): ExternalUser.
   Override applicati come in Isidata.

4) backend/services/integrations/esse3/syncJob.js export
   async runSync(configId: number, opts: {triggeredBy, dryRun?}):
   - load config, decrypt credentials
   - new Esse3Client
   - listStudenti({since: config.lastRunAt}) + listDocenti(same) +
     opzionale listCorsi
   - mapping → ExternalUser[]
   - load local users where externalSource='esse3'
   - diffEngine.computeDiff(...)
   - if !dryRun: apply in transaction SERIALIZABLE
   - write IntegrationSyncRun
   - update config.lastRunAt
   - return summary

5) Cron registration in services/reminderScheduler.js or new
   integrationScheduler.js: parse syncSchedule cron expr (riusa node-cron),
   schedule per IntegrationConfig with isEnabled=true.

6) Webhook handler backend/services/integrations/esse3/webhookHandler.js:
   - POST /api/integrations/esse3/webhook (signed HMAC SHA256 con config.webhookSecret)
   - body shape: {event: 'student.enrolled'|'student.withdrawn'|..., data: {id, matricola, ...}}
   - validate HMAC timing-safe (riusa pattern messagingWebhook.js)
   - dispatch a fetch ad-hoc dell'utente specifico via Esse3Client.getStudente(id) per
     evitare race: il webhook segnala l'evento, lo stato canonico è in Esse3.
   - upsert User locale.

7) Routes (riuso requireAdmin)
   - POST /api/admin/integrations/esse3/test-connection: valida OAuth + ping
     /api/v3/version → ritorna {ok, ms, esse3Version}.
   - POST /api/admin/integrations/esse3/run-now {dryRun?}: trigger immediate.
   - GET /api/admin/integrations/runs?provider='esse3': storia (riuso).

8) UI frontend
   - frontend/src/pages/admin/integrations/Esse3Config.tsx
     - Card "Connessione": baseUrl, clientId, clientSecret (gestiti come bind
       password LDAP — show/hide eye + isDirty), scope opt.
     - Card "Schedule": cron preset (daily 02:00, every 6h, every hour) +
       custom expression con preview "next 5 fires" (cronstrue + cron-parser).
     - Card "Webhook" (opzionale): genera webhookSecret, mostra URL pubblico
       da configurare in Esse3 admin.
     - Card "Field mapping" (advanced): editor JSON con schema validation.
     - Pulsante "Run now" (manual trigger) con dryRun toggle.
     - Tabella storico run con expandable diff snapshot.
   - i18n IT/EN/ES.

9) Audit + Sentry
   - AuditLog per ogni manual run + webhook call.
   - Sentry breadcrumb per ogni HTTP call Esse3 (URL, status, duration).

10) Test integration
    - Mock server msw con fixtures Esse3 sample (3 studenti, 2 docenti).
    - Test: full sync → 5 created. Re-run → 0 created, 0 updated.
    - Test: change un nome → 1 updated, fieldsChanged=['firstName'].
    - Test: rimuovi 1 dal mock → 1 toOrphan, isActive=false locally.
    - Test webhook HMAC valid/invalid signature (timing-safe).
    - Test OAuth token refresh on 401.

11) Documentazione
    - docs/INTEGRATIONS-ESSE3.md: come ottenere OAuth client da Cineca,
      configurazione webhook lato Esse3 admin, esempio payload.

DELIVERABLES
- 9 gg dev + test
- Coverage syncJob.js ≥ 80%
- Demo: cron run su mock Esse3 con 100 studenti
```

---

## 5. 🟢 Altre funzionalità enterprise (P1-P2)

### 5.1 SAML 2.0 / SSO federazione IDEM-GARR (P2)

**Razionale**: i conservatori federati con un'università italiana usano la federazione **IDEM-GARR** (Identity Federation della Rete della Ricerca italiana). SAML 2.0 è lo standard. È uno step intermedio prima di SPID (`develop.md § 2.9`).

**Stack**: `passport-saml` (SP-initiated flow). Settings cifrate (privateKey, IDP cert).

**Effort**: L (1-2 sett dev + 1-2 sett processo registrazione SP nella federazione GARR).

**Prompt** (sintetico, espandibile a richiesta):

```prompt
Implementa SAML 2.0 SSO (Service Provider) per federazione IDEM-GARR.
- npm install passport-saml
- Modello SamlSettings (singleton: idpEntityId, idpSsoUrl, idpCert, spEntityId,
  spPrivateKey encrypted, spCert, attributeMapping, autoCreateUsers, defaultRole)
- Routes /api/auth/saml/{login,callback,metadata}
- /api/auth/saml/metadata espone l'XML SP da registrare in IDEM
- UI /admin/saml-settings con upload IDP metadata XML che parsa entityId/cert/sso
- User upsert con authProvider='saml', mapping eduPersonAffiliation→role
- Test integration con simplesamlphp mock IDP
- docs/SAML-IDEM.md con istruzioni registrazione GARR
```

### 5.2 Multi-tenancy (multi-istituto) full SaaS (P2)

**Razionale**: oggi `Institute` esiste come modello ma il pattern SaaS multi-tenant non è completo (1 deployment = 1 conservatorio). Abilitare 1 deployment = N conservatori riduce drasticamente i costi infra per il modello SaaS.

**Trade-off**: complessità di sicurezza row-level + tenant isolation testing + DPO per-tenant. **Non priorità immediata**: il pricing self-host €800/anno copre già il caso "voglio un'istanza isolata".

**Effort**: XL (1-2 mesi). Da affrontare solo dopo 10+ clienti SaaS.

### 5.3 Audit retention configurabile (P1, semplice)

`develop.md § 1.5` cita "retention scheduler (audit 24 mesi)". Per enterprise PA serve poter estendere a **5 anni** (alcune normative regionali) o ridurre a 6 mesi (privacy-first).

**Effort**: S (mezza giornata).

```prompt
Aggiungi retention configurabile per AuditLog.
- Nuovo campo Institute.auditRetentionMonths INTEGER NOT NULL DEFAULT 24
  (range 1-120 con check constraint)
- services/retentionScheduler.js: leggi institute.auditRetentionMonths invece
  della costante hardcoded
- UI /admin/legal-settings: slider 1-120 mesi con preset "6 mesi" "12 mesi"
  "24 mesi (default)" "5 anni" "10 anni"
- i18n IT/EN/ES
- Test: retention=6 con record di 7 mesi → cancellato; retention=120 → mantenuto
```

### 5.4 Role mapping engine (P1, complementare a § 2 e § 3)

Quando si usa LDAP + Isidata + Esse3 contemporaneamente, le sorgenti hanno semantiche di gruppo diverse (memberOf LDAP, tipoSoggetto Esse3, TipoUtente Isidata). Serve un **engine unificato** di mapping.

**Effort**: M (3-5 gg).

```prompt
Implementa Role Mapping Engine unificato.
- Nuovo modello RoleMappingRule (id, instituteId, source ENUM('ldap','saml',
  'isidata','esse3','manual'), expression STRING, role ENUM, priority INT,
  isEnabled BOOL).
  expression è una mini-DSL: 'group:CN=Docenti,*' OR 'attribute:tipoSoggetto=DOC'
  OR 'email-domain:@docenti.cons.it' (parser semplice case-insensitive).
- services/roleMappingEngine.js export resolveRole({source, rawData}) → role | null:
  itera regole ordered by priority DESC, prima match wins, fallback default.
- Sostituisci hardcoded mapping in ldapAuth.js, esse3/syncJob.js, isidata/csvImporter.js
  con engine.resolveRole(...)
- UI /admin/role-mapping: tabella draggable per priorità, editor expression con
  preview ("Questa regola applicherebbe role=docente a 3 utenti correnti").
- i18n + docs/ROLE-MAPPING.md
```

### 5.5 Dry-run + diff staging mode (P1, qualità integrazioni)

Già accennato in § 3 e § 4. Centralizzare il pattern in modo consistente:

- Tutte le integrazioni espongono `runSync({dryRun: true})` che NON modifica DB
- UI admin sempre mostra diff + conferma esplicita prima di applicare
- Diff persistito in `IntegrationSyncRun.diffSnapshot` per replay/audit

**Effort**: già incluso in § 3.7 e § 4.6 (no overhead aggiuntivo).

### 5.6 Audit esteso accessi a dati sensibili (P2)

`develop.md § 3.4` cita questo come tech debt. Per clienti enterprise che richiedono compliance ISO 27001 / SOC 2:

**Effort**: M (3-5 gg).

```prompt
Estendi AuditLog per tracciare GET su endpoint sensibili.
- Whitelist endpoint sensibili: /api/users, /api/users/:id, /api/users/me,
  /api/admin/audit-log, /api/admin/analytics/*, /api/loans/:id/pdf,
  /api/users/me/gdpr/export.
- Middleware auditAccess(req, res, next) inserito SOLO su questi endpoint:
  scrive AuditLog target_type='SensitiveAccess', payload {endpoint, queryParams
  redacted, userId, ip, ua}.
- Riduci verbosità: bulk-summary 1 riga ogni 10 GET stesso endpoint stesso
  utente in 60 sec.
- UI /admin/audit-log: nuova tab "Accessi sensibili" con filtri.
```

### 5.7 IP whitelist per /admin (P2)

Alcuni conservatori chiedono di restringere l'accesso a `/api/admin/*` solo dalla rete del conservatorio.

**Effort**: S (1 g).

```prompt
Aggiungi IP whitelist opzionale per route admin.
- Modello SecuritySettings (singleton): adminIpWhitelist JSON array di
  CIDR strings (es. ['192.168.1.0/24', '10.0.0.0/8']).
- Middleware adminIpGuard prima di requireAdmin: se whitelist non vuota e IP
  non match → 403 con audit log.
- UI /admin/security-settings: textarea con validazione CIDR client-side.
- Mai bloccare se whitelist vuota (default open). Warning se admin tenta di
  salvare whitelist che non include il proprio IP corrente.
- Test: 192.168.1.50 in 192.168.1.0/24 ok; 10.0.0.5 in 10.0.0.0/8 ok; 8.8.8.8 ko.
```

### 5.8 Gestione service account / API key per integrazioni (P2)

Per integrazioni server-to-server (es. import script schedulati lato cliente):

**Effort**: M (2-3 g).

```prompt
Implementa API Key per service account.
- Nuovo modello ApiKey (id, instituteId, label, prefix UNIQUE 8char, hashHex
  bcrypt, scopes ENUM[] {read:users, write:users, read:bookings, ...},
  lastUsedAt, expiresAt, revokedAt, createdBy).
- Routes /api/admin/api-keys (CRUD).
- Middleware apiKeyAuth: header 'X-Api-Key: prefix.secret', lookup by prefix,
  bcrypt compare, check scopes vs route required scope, set req.apiKey + req.user=null.
- UI /admin/api-keys: lista + create (mostra secret SOLO una volta) + revoke.
- Audit log per ogni call con apiKey.
- Test: chiave valida con scope corretto → 200; scope insufficiente → 403;
  chiave revocata → 401.
```

---

## 6. Quadro complessivo: confronto vs `develop.md`

```
                                          develop.md      develop-enterprise.md
LDAP / AD authentication                       —              ✅ § 2 (NEW, P1)
Isidata sync                                   ◐ § 2.13       ✅ § 3 (deep, P1)
Esse3 sync                                     ◐ § 2.13       ✅ § 4 (deep, P1)
SAML 2.0 / IDEM-GARR                           —              ✅ § 5.1 (NEW, P2)
Multi-tenancy SaaS                             —              ✅ § 5.2 (NEW, P2)
Audit retention configurabile                  ◐ implicito    ✅ § 5.3 (NEW, P1)
Role mapping engine                            —              ✅ § 5.4 (NEW, P1)
Dry-run / diff staging                         —              ✅ § 5.5 (NEW, integrato)
Audit GET sensibili                            ◐ § 3.4        ✅ § 5.6 (NEW, P2)
IP whitelist admin                             —              ✅ § 5.7 (NEW, P2)
API key service account                        —              ✅ § 5.8 (NEW, P2)
SPID/CIE                                       ✅ § 2.9       (riferimento, vedi develop.md)
PEC integration                                ✅ § 2.10      (riferimento, vedi develop.md)
Conservazione sostitutiva                      ✅ § 2.11      (riferimento, vedi develop.md)
Export ANIS/MIUR                               ✅ § 2.12      (riferimento, vedi develop.md)
RFID controllo accessi                         ✅ § 2.14      (riferimento, vedi develop.md)
```

✅ trattato · ◐ accennato · — assente

---

## 7. Sprint plan suggerito (orizzonte 6 mesi)

### Sprint G — Auth enterprise (~2-3 settimane)

1. **§ 2 LDAP/AD authentication** (M-L, 11 gg) — sblocca ~50% conservatori medi/grandi
2. **§ 5.4 Role mapping engine** (M, 3-5 gg) — propedeutico per LDAP, Isidata, Esse3

> Rationale: prima di affrontare i SIS (Isidata/Esse3), serve LDAP per coprire il caso "ho già le credenziali AD ma non un SIS integrato". Role mapping engine va consegnato insieme a LDAP per evitare di hardcodare.

### Sprint H — Sync anagrafiche fase 1 (~2 settimane)

1. **§ 3 Isidata Livello A** (CSV/XLSX import) (M-L, 8.5 gg) — sblocca 70-80% AFAM senza dipendenze esterne
2. **§ 5.5 Dry-run pattern** (incluso)

### Sprint I — Sync anagrafiche fase 2 (~2-3 settimane)

1. **§ 4 Esse3 sync** (L, 9 gg) — sblocca conservatori grandi integrati
2. **§ 3 Isidata Livello B** (SOAP polling) (L+, ~6 gg incrementali) — solo se cliente specifico richiede

### Sprint J — Compliance e hardening (~1-2 settimane)

1. **§ 5.3 Audit retention configurabile** (S, 0.5 g)
2. **§ 5.6 Audit GET sensibili** (M, 3-5 g)
3. **§ 5.7 IP whitelist admin** (S, 1 g)
4. **§ 5.8 API Key service account** (M, 2-3 g)

> Bundle "compliance" pensato per chiusura simultanea quando un cliente PA richiede ISO 27001 / SOC 2 readiness.

### Sprint K — Federazione (on-demand)

1. **§ 5.1 SAML 2.0 IDEM-GARR** (L, 1-2 sett dev + 1-2 sett processo GARR) — solo se cliente firmato lo richiede

### Sprint L — Multi-tenancy (deferred)

1. **§ 5.2 Multi-tenancy full SaaS** (XL, 1-2 mesi) — affrontare solo a 10+ clienti SaaS

---

## 8. Rischi specifici enterprise

| Rischio                                                     | Probabilità | Impatto | Mitigazione                                                                                                                   |
| ----------------------------------------------------------- | ----------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| LDAP cert self-signed in dev → confusione integrazione test | Alta        | Basso   | Documenta `tlsRejectUnauthorized: false` solo dev, lockato in prod                                                            |
| Isidata SOAP endpoint differs per installazione             | Alta        | Medio   | Liv A (CSV) è agnostico; per Liv B prevedere customizzazione per-cliente fatturabile                                          |
| Esse3 OAuth client signup ha lead time                      | Media       | Medio   | Documentare in pre-vendita: il cliente deve avviare la richiesta a Cineca prima del go-live                                   |
| Schema Isidata cambia tra versioni                          | Media       | Medio   | fieldMappingOverrides per istituto + warnings su parsing                                                                      |
| GDPR: dati personali importati non hanno consenso esplicito | Media       | Alto    | Documenta che consent gate è gestito a monte (segreteria conservatorio); esponi flag `consentSourceNote` su User per tracking |
| Conflitto matricola/email tra Isidata e Esse3 (dual-source) | Bassa       | Medio   | externalSource + externalId UNIQUE compound; ENUM enforce un solo provider attivo per Institute                               |
| Performance import 5000+ utenti                             | Media       | Medio   | Streaming parser per XLSX > 10MB; chunked transaction commit ogni 500 record                                                  |

---

## 9. Definition of Done (per ogni feature enterprise)

Una feature è "production-ready enterprise" quando:

- ✅ Test integration ≥ 80% coverage del service core
- ✅ Test E2E del flow critico (login LDAP, import Isidata round-trip, sync Esse3)
- ✅ Documentazione `docs/<FEATURE>.md` con: overview, prerequisiti, configurazione step-by-step, troubleshooting, esempi reali
- ✅ i18n IT/EN/ES per tutte le UI
- ✅ Audit log scritto su ogni operazione amministrativa
- ✅ Secret management: cifratura AES-256-GCM, mai in log/Sentry/UI plaintext
- ✅ Rate-limiting / lockout dove applicabile
- ✅ TLS enforcement in production
- ✅ Sentry tag + breadcrumb per debugging post-deploy
- ✅ Feature flag in `Institute.enabledFeatures` JSON così l'admin può abilitare per istituto

---

## 10. Riferimenti rapidi

- **`develop.md`** — roadmap generale, Sprint A-F
- **`../analisi.md`** — analisi commerciale e mercato AFAM
- **`../Proposta.md`** — proposta tecnico-commerciale completa con benchmark ASIMUT/EasyStaff
- **`docs/ARCHITECTURE.md`** — architettura tecnica generale
- **`docs/SECURITY.md`** — postura di sicurezza
- **`backend/lib/crypto.js`** — modulo encryption riusato per tutte le credenziali integrazioni
- **`backend/services/messaging/`** — pattern adapter pluggable di riferimento

---

_— Fine documento · `develop-enterprise.md` v1.0 · 28 aprile 2026 —_

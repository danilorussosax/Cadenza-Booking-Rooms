# SSO — Login con Microsoft 365 (Entra ID) e Google Workspace

Questa guida spiega passo-passo come abilitare il login Single Sign-On in
Aula Book usando i piani **gratuiti** di Microsoft 365 for Education
(Entra ID) e di Google Workspace for Education Fundamentals.

> **Tempo richiesto**: ~15 minuti per provider (lato Microsoft / Google)
>
> - 2 minuti per incollare i valori in Aula Book.
>
> **Prerequisito**: avere un account amministratore del tenant
> Microsoft 365 / Workspace del proprio istituto, e un admin Aula Book.

> **Le immagini** referenziate (`./images/sso/...`) sono placeholder: vai
> nei portali Microsoft/Google e carica gli screenshot reali nelle
> directory `docs/images/sso/microsoft/`, `docs/images/sso/google/` e
> `docs/images/sso/aulabook/`. La guida è comunque utilizzabile senza
> immagini grazie alle descrizioni testuali "Cosa devi vedere".

## Indice

1. [Sommario rapido](#1-sommario-rapido)
2. [Microsoft 365 / Entra ID — passo-passo](#2-microsoft-365--entra-id--passo-passo)
3. [Google Workspace — passo-passo](#3-google-workspace--passo-passo)
4. [Configurazione in Aula Book](#4-configurazione-in-aula-book)
5. [Test del login](#5-test-del-login)
6. [Troubleshooting](#6-troubleshooting)
7. [FAQ](#7-faq)

---

## 1. Sommario rapido

Il flusso end-to-end per ciascun provider è sempre lo stesso:

```
Admin del cliente               Admin Aula Book
─────────────────               ─────────────────
1. Apre portale Azure
   o Google Cloud Console
2. Registra una nuova
   "OAuth app" / "App
   registration"
3. Imposta il "Redirect URI"
   verso Aula Book
4. Genera Client ID + Secret
5. Comunica i due valori   →   6. Apre Aula Book →
                                  Admin → Utenti
                               7. Incolla nelle card
                                  Google / Microsoft
                                  e abilita il toggle
                               8. (riavvia backend)
                               9. Prova il login
```

L'utente finale (docente/studente) vedrà nella pagina di login **due
nuovi pulsanti** "Continua con Google" e "Continua con Microsoft".

### URL di redirect (Aula Book)

Aula Book riceve il callback OAuth su due URL fissi del backend.
Sostituisci `aulabook.tuo-dominio.it` con il dominio reale (in dev:
`http://localhost:3000`).

| Provider      | Redirect URI da inserire nel portale                          |
| ------------- | ------------------------------------------------------------- |
| **Google**    | `https://aulabook.tuo-dominio.it/api/auth/google/callback`    |
| **Microsoft** | `https://aulabook.tuo-dominio.it/api/auth/microsoft/callback` |

> **Importante**: l'URL deve essere **esatto**, schema (https/http) e
> path inclusi. Se in sviluppo locale usi `http://localhost:3000` va bene
> per Google ma per Microsoft devi aggiungere anche
> `https://localhost:3000/api/auth/microsoft/callback` (Microsoft
> richiede schema https eccetto per `localhost`).

---

## 2. Microsoft 365 / Entra ID — passo-passo

### Prerequisiti

- Account **Global Administrator** o **Application Administrator** del
  tenant Microsoft 365 dell'istituto
- Un browser
- Il piano **Microsoft 365 A1 (Education)** gratuito è sufficiente.
  Tutto ciò che ti serve è incluso in **Microsoft Entra ID Free**, parte
  del bundle EDU gratuito.

### 2.1 Registrazione dell'app in Entra ID

1. Vai su **[https://entra.microsoft.com](https://entra.microsoft.com)**
   e accedi con l'account amministratore.

2. Nel menu laterale: **Entra ID** → **App registrations** → **New registration**.

   ![Entra → App registrations](./images/sso/microsoft/01-app-registrations.png)

   _Cosa devi vedere_: la lista delle app registrate del tenant; in alto
   il pulsante **+ New registration** (icona "+" e testo blu).

3. Compila il form:

   | Campo                       | Valore                                                           |
   | --------------------------- | ---------------------------------------------------------------- |
   | **Name**                    | `Aula Book`                                                      |
   | **Supported account types** | `Accounts in this organizational directory only (Single tenant)` |
   | **Redirect URI** → tipo     | `Web`                                                            |
   | **Redirect URI** → URL      | `https://aulabook.tuo-dominio.it/api/auth/microsoft/callback`    |

   ![Form New registration](./images/sso/microsoft/02-register-form.png)

   _Cosa devi vedere_: tre sezioni — Name, Supported account types
   (radio button con 4 opzioni; scegli la **prima**), Redirect URI con
   dropdown "Select a platform" (scegli **Web**) e textbox per l'URL.

4. Click **Register**. Microsoft crea l'app e ti porta nella sua pagina
   "Overview".

### 2.2 Recupera Client ID e Tenant ID

Nella pagina **Overview** dell'app trovi due GUID che servono ad Aula Book:

![Overview con i GUID evidenziati](./images/sso/microsoft/03-overview.png)

| Campo nel portale           | Lo userai come…          |
| --------------------------- | ------------------------ |
| **Application (client) ID** | `Client ID` in Aula Book |
| **Directory (tenant) ID**   | `Tenant` in Aula Book    |

> Copia entrambi in un blocco note temporaneo. Il Client ID è
> lungo ~36 caratteri tipo `1a2b3c4d-5e6f-7g8h-9i0j-k1l2m3n4o5p6`.

### 2.3 Genera il Client Secret

1. Nel menu laterale dell'app: **Certificates & secrets** → tab
   **Client secrets** → **+ New client secret**.

   ![Client secrets](./images/sso/microsoft/04-secrets-tab.png)

2. Nel popup:

   | Campo           | Valore consigliato           |
   | --------------- | ---------------------------- |
   | **Description** | `Aula Book backend`          |
   | **Expires**     | `24 months` (max consentito) |

3. Click **Add**. Microsoft mostra il secret in una riga della tabella.

   ⚠️ **CRITICO**: il valore visibile nella colonna **Value** è
   mostrato **una sola volta**. Copialo subito, lo userai come
   `Client Secret` in Aula Book. Se chiudi la pagina senza copiarlo
   dovrai cancellarlo e ricrearlo.

   ![Secret value](./images/sso/microsoft/05-secret-value.png)

### 2.4 Permessi API (verifica default)

Per il solo login basta `User.Read` (delegated), che Microsoft assegna
**di default** alle nuove app. Verifica:

1. **API permissions** nel menu laterale.
2. Devi vedere `Microsoft Graph → User.Read (Delegated)` con stato
   **Granted for `<tenant>`** (icona verde) oppure "Not granted" — se
   "Not granted" cliccca **Grant admin consent for `<tenant>`** in alto.

   ![API permissions](./images/sso/microsoft/06-api-permissions.png)

### 2.5 Quello che hai pronto da Microsoft

Tre valori:

```
Application (client) ID  →  copia in [Microsoft OAuth → Client ID]
Directory (tenant) ID    →  copia in [Microsoft OAuth → Tenant]
Client secret VALUE      →  copia in [Microsoft OAuth → Client Secret]
```

Vai a [Configurazione in Aula Book](#4-configurazione-in-aula-book).

---

## 3. Google Workspace — passo-passo

### Prerequisiti

- Account **Super Admin** del Workspace dell'istituto
- Il piano **Google Workspace for Education Fundamentals** gratuito è
  sufficiente
- Per pubblicare l'app come "Internal" (consigliato) il dominio deve
  essere verificato in Workspace (di solito già fatto se l'istituto usa
  email `@cons-tuo-istituto.edu.it`)

### 3.1 Crea un progetto in Google Cloud Console

Google separa **Workspace** (utenti / domini) da **Cloud Console**
(progetti / API). Per ottenere le credenziali OAuth devi creare un
progetto Cloud, che è **gratuito** e non richiede billing.

1. Vai su **[https://console.cloud.google.com](https://console.cloud.google.com)**
   e accedi con l'account super admin del Workspace.

2. In alto a sinistra, click sul **selettore progetto** (header
   azzurro con il nome del progetto attivo) → **NEW PROJECT**.

   ![Selettore progetto](./images/sso/google/01-project-selector.png)

3. Form **New Project**:

   | Campo            | Valore                                 |
   | ---------------- | -------------------------------------- |
   | **Project name** | `Aula Book`                            |
   | **Organization** | il tuo dominio (es. `cons-xxx.edu.it`) |
   | **Location**     | la stessa organization                 |

   Click **Create**, attendi 30 secondi, poi seleziona il progetto
   appena creato dal selettore.

   ![New project](./images/sso/google/02-new-project.png)

### 3.2 Configura la OAuth Consent Screen

1. Menu laterale: **APIs & Services** → **OAuth consent screen**.

   ![OAuth consent screen](./images/sso/google/03-consent-screen.png)

2. Seleziona **User Type → Internal** (visibile solo agli utenti del
   tuo Workspace) → **CREATE**.

   > Se l'opzione **Internal** è grigia significa che il progetto non
   > è dentro un'organizzazione Workspace: torna al passo 3.1 e
   > assicurati di selezionare la **Organization** corretta.

3. Compila:

   | Campo                       | Valore                                           |
   | --------------------------- | ------------------------------------------------ |
   | **App name**                | `Aula Book`                                      |
   | **User support email**      | la tua email admin                               |
   | **App logo**                | (opzionale) carica il logo del conservatorio     |
   | **Application home page**   | `https://aulabook.tuo-dominio.it`                |
   | **Authorized domains**      | `tuo-dominio.it` (premi Enter dopo aver scritto) |
   | **Developer contact email** | la tua email admin                               |

4. Click **SAVE AND CONTINUE**. Nelle pagine successive (**Scopes**,
   **Test users**, **Summary**) puoi cliccare direttamente **SAVE AND
   CONTINUE** senza modifiche.

### 3.3 Crea le credenziali OAuth Client ID

1. Menu laterale: **APIs & Services** → **Credentials** → **+ CREATE
   CREDENTIALS** → **OAuth client ID**.

   ![Create credentials](./images/sso/google/04-create-credentials.png)

2. Form:

   | Campo                             | Valore                                                     |
   | --------------------------------- | ---------------------------------------------------------- |
   | **Application type**              | `Web application`                                          |
   | **Name**                          | `Aula Book backend`                                        |
   | **Authorized JavaScript origins** | `https://aulabook.tuo-dominio.it`                          |
   | **Authorized redirect URIs**      | `https://aulabook.tuo-dominio.it/api/auth/google/callback` |

   ![OAuth client form](./images/sso/google/05-oauth-client-form.png)

3. Click **CREATE**. Si apre un popup con due valori:

   ![Client created modal](./images/sso/google/06-client-created.png)

   | Campo nel popup   | Lo userai come…              |
   | ----------------- | ---------------------------- |
   | **Client ID**     | `Client ID` in Aula Book     |
   | **Client secret** | `Client Secret` in Aula Book |

   > Il **Client ID** termina sempre con `.apps.googleusercontent.com`.
   > Puoi rivedere il **Client secret** in qualsiasi momento entrando
   > nel client dalla pagina **Credentials**.

### 3.4 Quello che hai pronto da Google

Due valori:

```
Client ID      →  copia in [Google OAuth → Client ID]
Client secret  →  copia in [Google OAuth → Client Secret]
```

Vai a [Configurazione in Aula Book](#4-configurazione-in-aula-book).

---

## 4. Configurazione in Aula Book

1. Accedi ad Aula Book con un utente **admin**.

2. Vai su **Admin → Utenti**. Scorri la pagina fino in fondo: vedi tre
   card **Google OAuth · Microsoft OAuth · Isidata** affiancate.

   ![Card OAuth in Admin → Utenti](./images/sso/aulabook/01-oauth-cards.png)

### 4.1 Card "Google OAuth"

Compila:

| Campo nella card                      | Valore (incolla qui)                                               |
| ------------------------------------- | ------------------------------------------------------------------ |
| Toggle in alto a destra (header card) | **abilita**                                                        |
| **Client ID**                         | il Client ID di Google (`...apps.googleusercontent.com`)           |
| **Client Secret**                     | il Client Secret di Google (clicca occhio per mostrare/nascondere) |
| **Callback URL**                      | `https://aulabook.tuo-dominio.it/api/auth/google/callback`         |

Click **Salva**.

![Form Google OAuth in Aula Book](./images/sso/aulabook/02-google-form.png)

### 4.2 Card "Microsoft OAuth"

Compila:

| Campo nella card        | Valore (incolla qui)                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Toggle in alto a destra | **abilita**                                                                                                         |
| **Client ID**           | l'Application (client) ID di Microsoft                                                                              |
| **Client Secret**       | il **Value** del client secret di Microsoft (NON l'ID)                                                              |
| **Callback URL**        | `https://aulabook.tuo-dominio.it/api/auth/microsoft/callback`                                                       |
| **Tenant**              | il Directory (tenant) ID di Microsoft (oppure `common` per accettare qualunque tenant — sconsigliato in produzione) |

Click **Salva**.

![Form Microsoft OAuth in Aula Book](./images/sso/aulabook/03-microsoft-form.png)

### 4.3 Riavvio backend (importante)

Aula Book carica le strategie OAuth allo **startup**. Dopo il primo
salvataggio (o ogni volta che cambi i valori) **riavvia il backend**:

```bash
# Sul server, dalla cartella backend:
npm run restart:bg
```

> Lo script `restart:bg` chiude il processo Node sulla porta 3000 e ne
> avvia uno nuovo in background, pronto in pochi secondi.

In alternativa, se gestisci il backend con `pm2`:

```bash
pm2 restart aulabook
```

Nella pagina di settings vedrai un banner ambra:

> ⚠️ Riavvia il backend per applicare le nuove impostazioni OAuth.

dopo il riavvio il banner sparisce alla prossima ricarica.

---

## 5. Test del login

1. Vai alla pagina **Login** di Aula Book in **incognito** (per evitare
   sessione cached).

2. Vedi due nuovi pulsanti sotto al form email/password:

   | Pulsante                   | Azione                          |
   | -------------------------- | ------------------------------- |
   | **Continua con Google**    | parte il flusso OAuth Google    |
   | **Continua con Microsoft** | parte il flusso OAuth Microsoft |

   ![Pagina login con SSO](./images/sso/aulabook/04-login-page.png)

3. Click su uno dei due → vieni redirezionato al provider →
   autenticazione → consent (solo la prima volta) → ritorni in Aula
   Book autenticato.

4. **Primo login di un nuovo utente**: il profilo nasce in stato
   `pending` con il dominio email del provider. Un admin Aula Book deve
   approvarlo (o assegnarlo a un corso/matricola se è uno studente)
   prima che possa prenotare.

### Cosa controllare se non funziona

| Sintomo                                                            | Diagnosi                                                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Click su "Continua con X" → 503 / pagina di errore                 | backend non riavviato dopo il salvataggio                                                              |
| Pagina provider mostra **AADSTS50011** "redirect URI mismatch"     | il Redirect URI in Entra ≠ Callback URL in Aula Book (controlla schema https vs http e ogni carattere) |
| Pagina Google mostra **error 400 redirect_uri_mismatch**           | come sopra ma su Google Cloud Console                                                                  |
| Login OK ma utente in stato pending: non riesce a prenotare        | normale: un admin Aula Book deve approvarlo (Admin → Approvazioni)                                     |
| Login Microsoft con `tenant=common` accetta utenti di altri tenant | metti il **Directory (tenant) ID** specifico, non `common`                                             |

Vedi anche [Troubleshooting](#6-troubleshooting).

---

## 6. Troubleshooting

### 6.1 "AADSTS50011: The redirect URI specified... does not match"

Il **Redirect URI** registrato in Entra ID è diverso da quello
configurato in Aula Book. Apri di nuovo l'app in Entra → **Authentication**
→ verifica che ci sia esattamente:

```
https://aulabook.tuo-dominio.it/api/auth/microsoft/callback
```

Anche un singolo `/` finale di troppo o `http` invece di `https` rompe
tutto. Salva → riprova.

### 6.2 "redirect_uri_mismatch" su Google

Stesso problema lato Google. Vai in **APIs & Services → Credentials**,
clicca sul tuo OAuth client, verifica che **Authorized redirect URIs**
contenga **esattamente**:

```
https://aulabook.tuo-dominio.it/api/auth/google/callback
```

### 6.3 "OAUTH_NOT_CONFIGURED" / 503 dopo il click

Il backend non ha caricato le strategie. Cause possibili:

1. Hai salvato in admin ma non riavviato il backend.
   → `npm run restart:bg`.
2. Il `Client Secret` salvato è vuoto o non decifrabile (es. cambio del
   `JWT_SECRET` ha invalidato la cifratura). → reinserisci il secret e
   salva di nuovo.

### 6.4 "AADSTS70011: invalid scope"

Solo `User.Read` è necessario. Se hai aggiunto altri scope custom
(es. `Group.Read.All`) e non hai dato admin consent, Microsoft rifiuta.
Rimuovi gli scope extra o concedi consent.

### 6.5 Login Google funziona ma email risulta `@gmail.com` (account personale)

L'utente ha cliccato su un account personale invece dell'account
istituzionale. Per **forzare** solo account del dominio del Workspace,
in Aula Book non c'è ancora un parametro `hostedDomain` configurabile
(roadmap Liv A miglioramenti SSO). Workaround temporaneo: in Aula Book
**Admin → Approvazioni** rifiuti gli account `@gmail.com`.

### 6.6 Microsoft accetta account guest da altri tenant

Stai usando `Tenant = common` o `organizations`. Cambia in
**Tenant = `<il tuo Directory (tenant) ID>`** (un GUID specifico) → solo
gli utenti del tuo Microsoft 365 potranno autenticarsi.

### 6.7 Client Secret scaduto

Microsoft consente max 24 mesi di validità sui secret. Quando scade,
i login iniziano a fallire con `AADSTS7000222 invalid_client`. Soluzione:

1. Entra in Azure → app → **Certificates & secrets** → **+ New client
   secret** → copia il valore.
2. Aula Book → Admin → Utenti → Microsoft OAuth → incolla il nuovo
   secret → Salva → `npm run restart:bg`.

Stesso flusso vale per Google ma i secret Google **non scadono** —
solo se li revochi manualmente.

---

## 7. FAQ

### 7.1 Quale costo?

**Zero**, sui piani gratuiti EDU. Vedi `analisivps.md` o la tabella
qui sotto:

| Provider                                         | Piano necessario | Costo  |
| ------------------------------------------------ | ---------------- | ------ |
| Microsoft Entra ID Free (incluso in M365 A1 EDU) | A1 EDU           | gratis |
| Google Workspace for Education Fundamentals      | Fundamentals     | gratis |

Costi a pagamento solo se vuoi feature enterprise non necessarie per il
login (Conditional Access, MFA enforcement IdP-side, custom branding).

### 7.2 Posso abilitare solo uno dei due provider?

Sì. Le due card in Aula Book sono indipendenti: lascia l'altra
disabilitata (toggle off, campi vuoti) e funziona comunque.

### 7.3 Cosa succede agli utenti che si erano già registrati con

email/password?

Nulla: il login email/password resta attivo. Se un utente si registra
poi con SSO usando la **stessa email**, Aula Book riconosce l'account
esistente e lo collega al provider (no duplicati).

### 7.4 Posso forzare tutti gli utenti a usare SSO disabilitando le

password locali?

Non in automatico via UI, ma puoi:

1. Lasciare attive solo le card OAuth (toggle off del local? non c'è
   ancora, è una feature da aggiungere)
2. Comunicare agli utenti di accedere solo via SSO (gli account locali
   esistenti restano funzionanti per emergenze admin).

Roadmap: aggiungere flag `Institute.disableLocalPassword` per
forzare SSO-only.

### 7.5 SSO funziona anche per il display kiosk?

Il display `/display` è **pubblico** e non richiede login. Non è
toccato dall'integrazione SSO.

### 7.6 Posso configurare SSO per ambiente di sviluppo locale?

Sì. Usa `http://localhost:3000` come dominio. Microsoft accetta
`localhost` con schema `http`; Google idem ma vuole anche
`http://localhost:3000` come **Authorized JavaScript origin**.
Crea **due app separate** in Azure / Google Cloud (una per dev, una
per prod) per non mischiare i secret.

### 7.7 Quanti utenti posso autenticare contemporaneamente?

I piani gratuiti EDU non hanno limiti pratici per il login (Microsoft:
50 000 utenti per tenant; Google: illimitato per dominio). Aula Book a
sua volta gestisce centinaia di login simultanei senza problemi anche su
VPS minimale (vedi `analisivps.md`).

### 7.8 Sicurezza: come è cifrato il Client Secret?

Aula Book cifra `googleClientSecret` e `microsoftClientSecret` at-rest
con AES-256-GCM (vedi `backend/lib/crypto.js`). La chiave deriva dal
`JWT_SECRET` configurato in `.env`. Non sono mai esposti in response
JSON dell'API admin (ricezione solo di un placeholder `••••••`).

### 7.9 Posso revocare i token JWT degli utenti SSO se l'IdP disabilita un account?

Non automaticamente (Aula Book non riceve back-channel logout). Ma puoi:

1. Disattivare l'utente in Admin → Utenti (toggle "Attivo" off): al
   prossimo refresh del token Aula Book lo blocca.
2. Forzare logout globale incrementando il `tokenVersion` dell'utente
   (DB query manuale o feature admin "Forza logout").

Per disabilitazione automatica vedi roadmap "SCIM provisioning push" in
`docs/INTEGRATIONS-ISIDATA.md` § 9 (Liv C).

---

## Appendice A — Checklist pre-volo

Prima di passare il login SSO in produzione:

- [ ] Redirect URI registrato in entrambi i provider con schema **https**
- [ ] Client Secret Microsoft ha **scadenza > 12 mesi** annotata in
      calendario per il rinnovo
- [ ] Tenant Microsoft impostato a **GUID specifico** (non `common`)
- [ ] OAuth Consent Screen Google impostato a **Internal**
- [ ] Test in incognito: login Google ok, login Microsoft ok, profilo
      utente popolato con nome/cognome/email corretti
- [ ] Approvazione `pending → approved` testata da admin
- [ ] Backup del file `.env` con `JWT_SECRET` (la chiave di cifratura
      dei client secret)
- [ ] Documentazione interna che spiega ai docenti come fare il primo
      login

## Appendice B — Variabili d'ambiente vs configurazione DB

Aula Book supporta due modi di configurare OAuth:

1. **DB (consigliato)**: i valori vivono in tabella `oauth_settings`,
   editabili da Admin → Utenti, cifrati at-rest. Perfetto per ambienti
   self-hosted.
2. **Env var**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `GOOGLE_CALLBACK_URL`, `MICROSOFT_CLIENT_ID`,
   `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_CALLBACK_URL`,
   `MICROSOFT_TENANT`. Utile per CI/CD o quando vuoi gestire i secret
   con vault esterno.

Se entrambi sono valorizzati, **DB ha priorità**.

> **Nota tecnica per il developer**: il route guard in
> `backend/routes/auth.js` dei due endpoint di start (`/api/auth/google`,
> `/api/auth/microsoft`) controlla `process.env.<X>_CLIENT_ID`. In una
> futura release verrà esteso per leggere anche dal DB. Workaround
> attuale: settare almeno una env var placeholder
> (`GOOGLE_CLIENT_ID=managed-via-db`) per superare il guard, mentre la
> strategia OAuth reale viene caricata dal DB.

---

**Storia versioni**:

- 2026-04-28 — prima versione: Microsoft Entra ID + Google Workspace
  EDU su piani gratuiti.

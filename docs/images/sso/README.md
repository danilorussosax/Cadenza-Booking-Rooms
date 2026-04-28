# Screenshots per la guida SSO.md

Questa cartella ospita gli screenshot referenziati da `docs/SSO.md`.
La guida è **completa anche senza immagini** (ogni step ha una sezione
"Cosa devi vedere"), ma le immagini la rendono molto più chiara per i
sysadmin meno tecnici.

## File attesi (sostituisci i placeholder con screenshot reali)

### `microsoft/`

| File                       | Cosa mostrare                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `01-app-registrations.png` | Pannello **Entra ID → App registrations** con il pulsante "+ New registration" evidenziato             |
| `02-register-form.png`     | Form "Register an application" compilato (Name=`Cadenza`, Single tenant, Web + redirect URI)           |
| `03-overview.png`          | Pagina **Overview** dell'app con i due GUID (Application/Tenant ID) evidenziati con un riquadro rosso  |
| `04-secrets-tab.png`       | Tab **Certificates & secrets** con il pulsante "+ New client secret" evidenziato                       |
| `05-secret-value.png`      | Tabella secrets con il valore visibile UNA VOLTA SOLA (sfocare la parte sensibile prima di committare) |
| `06-api-permissions.png`   | Tab **API permissions** con `User.Read (Delegated)` granted                                            |

### `google/`

| File                        | Cosa mostrare                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `01-project-selector.png`   | Header di Google Cloud Console con il selettore progetto aperto e "+ NEW PROJECT" evidenziato |
| `02-new-project.png`        | Form "New Project" compilato (Project name, Organization, Location)                           |
| `03-consent-screen.png`     | **APIs & Services → OAuth consent screen** con la scelta "Internal"                           |
| `04-create-credentials.png` | **APIs & Services → Credentials → + CREATE CREDENTIALS** menu aperto su "OAuth client ID"     |
| `05-oauth-client-form.png`  | Form "Create OAuth client ID" compilato (Web application, redirect URIs)                      |
| `06-client-created.png`     | Modal di successo con Client ID e Client secret (sfocare le parti sensibili)                  |

### `cadenza/`

| File                    | Cosa mostrare                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `01-oauth-cards.png`    | Pagina **Admin → Utenti** scrollata in fondo, con le 3 card Google/Microsoft/Isidata visibili affiancate                              |
| `02-google-form.png`    | Card "Google OAuth" con i campi popolati (Client ID terminato in `.apps.googleusercontent.com`, secret nascosto in •••, callback URL) |
| `03-microsoft-form.png` | Card "Microsoft OAuth" con i campi popolati (Client ID, secret nascosto, callback URL, Tenant)                                        |
| `04-login-page.png`     | Pagina di **Login** in incognito, con i due bottoni "Continua con Google" e "Continua con Microsoft" sotto al form                    |

## Convenzioni

- **Formato**: PNG, larghezza 1200–1600 px (Retina-friendly).
- **Compressione**: usa `pngquant --quality=70-85` o online TinyPNG
  per stare sotto i 200 KB per immagine.
- **Privacy**: sfoca tutti i valori sensibili (Client Secret, Tenant ID
  reali, email amministratore) — la guida è pubblica e finirà nei
  repo Git e nei pacchetti deploy.
- **Aspect ratio**: per gli screenshot dei portali Microsoft/Google
  cattura solo la parte rilevante della UI (no sidebar di sistema, no
  taskbar) e ritaglia attorno all'azione descritta.

## Strumenti consigliati

- macOS: `Cmd-Shift-4` (cattura selezione) + Preview per ritagli e
  sfocature
- Windows: Snipping Tool + ShareX per redaction e annotations
- Linux: Flameshot per cattura + annotations native

## Quando rifare gli screenshot

Microsoft e Google ridisegnano regolarmente le proprie console. Se in un
upgrade futuro le label cambiano (es. "App registrations" → "Application
Hub"), è sufficiente ricaricare i 6 file `microsoft/01..06.png` o
`google/01..06.png` mantenendo lo stesso nome — `SSO.md` non va
modificato.

---

**Stato attuale**: directory vuote (placeholder). La guida funziona già
ora grazie alle descrizioni testuali; gli screenshot sono un upgrade
nice-to-have da aggiungere quando si registra l'app per il primo
istituto reale.

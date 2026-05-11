# Screenshots per la guida SSO.md

Dal 2026-05-11 la guida `docs/SSO.md` **non dipende più** da screenshot
locali per i portali Microsoft / Google: ogni passo è linkato alla doc
ufficiale Microsoft Learn / Google Cloud, dove gli screenshot sono
sempre allineati alla UI corrente. Vedi `SSO.md` § Appendice C per
l'indice completo dei link.

## Strategia attuale

| Provider                 | Strategia screenshot                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| **Microsoft (Entra ID)** | Link a [Microsoft Learn](https://learn.microsoft.com/it-it/entra/identity-platform/quickstart-register-app) — niente PNG locali |
| **Google (GCP)**         | Link a [Google Cloud Support](https://support.google.com/cloud/answer/6158849) — niente PNG locali                              |
| **Cadenza**              | Screenshot reali nel repo, in `docs/screenshots/` (`login.png`, `users-overview.png`, `users-oauth-providers.png`)              |

## Perché questo cambio

1. **Copyright** — riusare screenshot dei portali Microsoft/Google nella
   nostra doc è in zona grigia (le linee guida sui brand asset di
   entrambi i fornitori scoraggiano la ripubblicazione delle UI).
2. **Manutenzione** — Microsoft e Google ridisegnano le console
   regolarmente. Ogni nostro screenshot diventa obsoleto in pochi mesi;
   la doc ufficiale viene aggiornata insieme alla UI.
3. **Localizzazione** — i link `learn.microsoft.com/it-it/...` portano
   l'utente direttamente alla versione italiana, screenshot inclusi.

## Cartelle legacy (`microsoft/`, `google/`, `aulabook/`)

Esistono ancora come placeholder vuoti dalla v1 della guida. Se in
futuro volessimo davvero ospitare screenshot locali (es. per workflow
offline / aria gappata) si può:

1. Catturare gli screenshot seguendo le convenzioni qui sotto
2. Riferirli da `SSO.md` con path relativo `./images/sso/<provider>/...`

In tutti gli altri casi le directory possono restare vuote.

## Convenzioni (se decidi di aggiungere screenshot locali)

- **Formato**: PNG, larghezza 1200–1600 px (Retina-friendly).
- **Compressione**: `pngquant --quality=70-85` o TinyPNG → sotto 200 KB.
- **Privacy**: sfoca tutti i valori sensibili (Client Secret, Tenant ID
  reali, email amministratore) — la guida è pubblica.
- **Aspect ratio**: cattura solo la parte rilevante della UI (no
  sidebar di sistema, no taskbar) e ritaglia attorno all'azione
  descritta.

## Strumenti consigliati

- macOS: `Cmd-Shift-4` (cattura selezione) + Preview per ritagli e
  sfocature
- Windows: Snipping Tool + ShareX per redaction e annotations
- Linux: Flameshot per cattura + annotations native

---

**Stato attuale**: cartelle legacy vuote. La guida è completa grazie ai
link a doc ufficiali (Microsoft/Google) e agli screenshot Cadenza in
`docs/screenshots/`.

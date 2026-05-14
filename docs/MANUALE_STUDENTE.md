---
title: 'Cadenza · Manuale Studente'
subtitle: 'Guida pratica per studenti del Conservatorio'
author: 'Danilo Russo, docente del Conservatorio'
date: '14 maggio 2026'
lang: it
papersize: a4
documentclass: article
geometry:
  - top=22mm
  - bottom=22mm
  - left=18mm
  - right=18mm
fontsize: 10pt
linestretch: 1.45
mainfont: 'Helvetica Neue'
monofont: 'Menlo'
toc: true
toc-depth: 3
numbersections: false
colorlinks: true
linkcolor: '[HTML]{2C5D8A}'
header-includes:
  - \usepackage{lastpage}
  - \usepackage{fancyhdr}
  - \pagestyle{fancy}
  - \fancyhf{}
  - \fancyhead[L]{\small Cadenza · Manuale Studente v1.5.1}
  - \fancyhead[R]{\small 14 maggio 2026}
  - \fancyfoot[C]{\small\thepage\ / \pageref*{LastPage}}
  - \renewcommand{\headrulewidth}{0.4pt}
---

# Cadenza · Manuale Studente

> **Versione**: 1.0 · **Data**: 14 maggio 2026 · **Lingua**: italiano · **Formato stampa**: A4
> **Destinatari**: studenti iscritti al Conservatorio (corsi accademici e pre-accademici)
> **Prerequisiti**: account su una installazione Cadenza già attiva (te lo crea la Segreteria oppure ti registri al primo accesso)

---

## Indice

- [§1. In due minuti](#1-in-due-minuti)
- [§2. Primo accesso](#2-primo-accesso)
- [§3. Dashboard e calendario](#3-dashboard-e-calendario)
- [§4. Prenotare un'aula](#4-prenotare-unaula)
- [§5. Le tue prenotazioni](#5-le-tue-prenotazioni)
- [§6. Check-in con QR code](#6-check-in-con-qr-code)
- [§7. Aule e dotazioni](#7-aule-e-dotazioni)
- [§8. Prestiti strumenti](#8-prestiti-strumenti)
- [§9. Avvisi e bacheca](#9-avvisi-e-bacheca)
- [§10. Profilo, notifiche e calendario personale](#10-profilo-notifiche-e-calendario-personale)
- [§11. App sul telefono (PWA)](#11-app-sul-telefono-pwa)
- [§12. Bot Telegram (opzionale)](#12-bot-telegram-opzionale)
- [§13. Lingue dell'interfaccia](#13-lingue-dellinterfaccia)
- [§14. Cose che NON puoi fare (e perché)](#14-cose-che-non-puoi-fare-e-perche)
- [§15. Domande ricorrenti](#15-domande-ricorrenti)

---

## 1. In due minuti

Cadenza è la piattaforma del Conservatorio per **prenotare le aule di studio** e gestire le tue attività dentro l'istituto. Da un'unica interfaccia puoi:

- Prenotare uno **studio individuale**, una **sala prove** o una **sala per esercizio strumentale**.
- Vedere il **calendario** delle aule e i tuoi prossimi impegni.
- Richiedere il **prestito** di uno strumento dall'inventario del Conservatorio.
- Leggere gli **avvisi** della Direzione filtrati per il tuo corso.
- Ricevere **promemoria via email** prima di ogni prenotazione.
- Installare l'app **sul telefono** (Android e iPhone).

Cadenza è in italiano, inglese, spagnolo, tedesco e francese; puoi cambiare lingua dal tuo profilo.

> **Nota importante**: alcune funzionalità (lezioni ricorrenti, "Monte Ore") sono pensate per docenti e contrattisti. Tu come studente non le vedrai e non ti servono.

---

## 2. Primo accesso

### 2.1 Login

URL: `https://cadenza.tuoconservatorio.it/login` (l'URL esatto dipende dall'istituto — chiedilo alla Segreteria).

![Schermata di login — scelta del provider o email + password](screenshots/login.png)

Hai tre modi per entrare:

| Metodo                       | Quando usarlo                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------- |
| **Email + password**         | Account creato dalla Segreteria; password ricevuta via email al primo invito. |
| **Google**                   | Se il Conservatorio ha attivato il login Google Workspace.                    |
| **Microsoft 365 / Entra ID** | Se il Conservatorio ha attivato il login Microsoft (account istituzionale).   |

Click su "Email" apre il form classico:

![Form email + password](screenshots/login-email.png)

> **2FA via email** (opt-in): se la Direzione lo attiva, dopo username/password riceverai un codice a 6 cifre. Inseriscilo per completare l'accesso. La 2FA per gli studenti **non è obbligatoria** — la attivi solo se vuoi.

### 2.2 Cosa fare se non hai una password

Se non hai mai ricevuto la password:

1. Chiedi alla Segreteria di invitarti (ti arriverà via email un link).
2. In alternativa, in fondo alla pagina di login c'è "Registrati": compila i tuoi dati (nome, cognome, email istituzionale, **matricola**, corso) e attendi che la Segreteria approvi il tuo account.

Fino a quando la Segreteria non approva, vedrai una pagina "In attesa di approvazione" e non potrai prenotare.

### 2.3 Password dimenticata

Se hai la password ma non te la ricordi più, non serve scrivere alla Segreteria — risolvi da solo in 1 minuto:

1. Apri la pagina di login.
2. Sotto il bottone "Accedi", clicca su **"Password dimenticata?"**.
3. Inserisci la tua email e clicca **"Invia link di reset"**.
4. Riceverai entro pochi secondi un'email con un bottone "**Reimposta password**". Cliccalo (link valido **1 ora**, utilizzabile **una sola volta**).
5. Scegli la nuova password (minimo 10 caratteri, almeno una maiuscola e un numero) e confermala.
6. Vieni reindirizzato al login: accedi con la nuova password.

> **Sicurezza:** dopo il cambio password, **tutte le sessioni attive vengono disconnesse** (anche su altri dispositivi). Dovrai rifare il login ovunque. Se l'email non arriva entro qualche minuto, controlla lo spam.

### 2.4 Completamento del profilo (solo al primo accesso)

Al primo login Cadenza ti chiede di completare l'anagrafica: nome, cognome, **matricola** (è obbligatoria per gli studenti) e **corso di studio**. Senza matricola e corso non puoi prenotare — sono i dati che il sistema usa per applicare le regole giuste.

![Pagina di completamento profilo](screenshots/complete-profile.png)

Dopo il completamento sei dentro e arrivi alla **Dashboard**.

---

## 3. Dashboard e calendario

La Dashboard è la tua "home" dentro Cadenza. Mostra:

- Il calendario delle aule del **giorno selezionato** (oppure di 3 giorni affiancati).
- I tuoi **prossimi impegni** (prenotazioni) come elenco compatto.
- Gli **avvisi importanti** pubblicati dalla Direzione.

### 3.1 Vista 1 giorno (default)

![Dashboard — vista calendario "1 giorno" (default)](screenshots/dashboard-overview.png)

Le aule sono in colonna, le ore in riga (slot da 30 min). Colori:

- 🟦 **Blu**: prenotazione tua;
- 🟪 **Viola**: prenotazione di un altro utente (non disponibile);
- 🟩 **Verde tenue**: slot libero.

Click su uno slot libero ti porta direttamente al form di prenotazione, con orario e aula pre-compilati.

### 3.2 Vista 3 giorni

In alto a destra c'è un toggle "1 giorno · 3 giorni". Cambiandolo vedi tre colonne giorno affiancate, utile per cercare aule libere su più giorni.

![Dashboard — vista calendario "3 giorni" affiancati](screenshots/dashboard-calendario-3giorni.png)

### 3.3 Filtri rapidi

In alto trovi i filtri:

- **Edificio**: se l'istituto ha più sedi, puoi filtrare per una sola.
- **Tipo aula**: solo studi, solo sale prove, solo aule didattiche, ecc.
- **Capienza minima**: utile per cercare sale prove o aule capienti.

I filtri sono memorizzati nel browser: la prossima volta che apri la Dashboard li ritrovi impostati.

---

## 4. Prenotare un'aula

### 4.1 Le tre vie alla prenotazione

Puoi prenotare in tre modi:

1. **Click su uno slot libero** nel calendario della Dashboard (la via più veloce: orario e aula sono già compilati).
2. **Menu laterale → "Prenota"**: parti dal form completo.
3. **Bottom-nav del telefono → icona "+"** se sei da PWA.

![Form prenotazione](screenshots/booking-form.png)

### 4.2 Cosa compilare

| Campo              | Note                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------- |
| **Data**           | Oggi o nei prossimi giorni. La finestra di prenotazione anticipata dipende dalle regole. |
| **Orario**         | Slot di 30 minuti minimo. Cadenza non ti fa scegliere orari "sbalzati".                  |
| **Durata**         | Tipico 30/60/90 minuti. Anche qui dipende dal tipo di aula e dalla regola.               |
| **Aula**           | Filtrabile per edificio, tipo (studio, sala prove, ecc.) e capienza.                     |
| **Motivo / Scopo** | Solo per alcune aule "speciali" (sala concerti, aula registrazione).                     |

Quando clicchi "Conferma", Cadenza:

1. Controlla che lo slot sia ancora libero (qualcun altro potrebbe averlo preso).
2. Verifica che tu non sfori le quote del tuo corso (vedi §4.4).
3. Verifica che l'aula non richieda approvazione (vedi §4.5).
4. Crea la prenotazione e ti manda subito un'email di conferma con allegato `.ics` per il tuo calendario.

### 4.3 Tipi di aula

Le aule del Conservatorio sono classificate in tipi. Quelle più frequenti per uno studente sono:

| Tipo                     | A cosa serve                                                                   |
| ------------------------ | ------------------------------------------------------------------------------ |
| **Studio**               | Esercizio individuale silenzioso. Piccola, di solito un solo strumento.        |
| **Sala prove**           | Esercizio di gruppo, ensemble, lezioni private.                                |
| **Aula didattica**       | Lezioni con docente. Spesso prenotata dai docenti, ma in alcuni casi anche tu. |
| **Sala concerti**        | Per esami, concerti, prove acustiche. Quasi sempre con approvazione admin.     |
| **Studio registrazione** | Solo per chi è autorizzato dal Conservatorio.                                  |

### 4.4 Quote e limiti

Il Conservatorio definisce delle **quote** per evitare che pochi studenti monopolizzino le aule:

- **Ore al giorno**: tipicamente 2-4 ore di prenotazioni attive nello stesso giorno.
- **Ore alla settimana**: tipicamente 10-20 ore in una settimana.
- **Prenotazioni future contemporanee**: tipicamente 5-10 prenotazioni "in coda" non ancora consumate.

Se sfori, Cadenza te lo dice con un messaggio chiaro tipo "Hai già 4 ore prenotate oggi, il massimo è 4". I numeri esatti li vedi nella pagina "Le mie prenotazioni" (in alto, riassunto).

### 4.5 Aule con approvazione

Alcune aule (es. sala concerti) richiedono l'approvazione di un amministratore. In quel caso la prenotazione viene creata in stato "**In attesa di approvazione**" — non è ancora attiva. Riceverai un'email quando un admin l'approva o la rifiuta.

![Stato prenotazione: In attesa di approvazione](screenshots/booking-pending.png)

> Suggerimento: per le aule "speciali" prenota con qualche giorno di anticipo, così la Direzione ha il tempo di valutare la richiesta.

### 4.6 Tipi di prenotazione (opzionale)

Se la Direzione li ha configurati, puoi etichettare la prenotazione con un "Tipo" (Esercizio personale, Lezione di gruppo, Prove esame, ecc.). Serve all'amministrazione per le statistiche e a te non cambia nulla nel pratico.

### 4.7 Waitlist (lista d'attesa)

Se l'aula che vuoi è già occupata, Cadenza ti propone di metterti **in lista d'attesa**: se chi ha quello slot cancella, ricevi un'email e hai 30 minuti per confermare lo slot prima che venga proposto al prossimo in lista.

![Waitlist — proposta di prendere uno slot liberato](screenshots/waitlist-offer.png)

---

## 5. Le tue prenotazioni

Dalla voce di menu **"Le mie prenotazioni"** vedi l'elenco di tutte le tue prenotazioni: passate, attive, future, cancellate.

![Pagina "Le mie prenotazioni"](screenshots/my-bookings.png)

### 5.1 Cosa puoi fare

Per ogni prenotazione **futura** puoi:

| Azione                    | Quando                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------- |
| **Visualizzare dettagli** | Sempre.                                                                            |
| **Cancellare**            | Fino a X ore prima dell'inizio (dipende dalle regole, tipicamente 1 o 24 h prima). |
| **Esportare .ics**        | Sempre. Aggiunge la prenotazione al tuo calendario (Google, Apple, Outlook).       |

Per le prenotazioni **passate**: nessuna azione, sono solo "storia".

### 5.2 Stato delle prenotazioni

| Stato                  | Significato                                                                   |
| ---------------------- | ----------------------------------------------------------------------------- |
| ✅ **Confermata**      | È attiva. Vai in aula all'orario previsto.                                    |
| 🕓 **In attesa**       | L'admin deve approvare (aula speciale).                                       |
| ❌ **Cancellata**      | Cancellata da te o dall'admin. Vedi nei dettagli il motivo.                   |
| ⛔ **Auto-cancellata** | Cadenza l'ha cancellata perché non hai fatto **check-in** in tempo (vedi §6). |
| ✓ **Completata**       | Hai fatto check-in e l'orario è passato.                                      |

### 5.3 Cancellazione

Per cancellare: apri la prenotazione, click su "Cancella". Cadenza chiede conferma e (per cancellazioni vicine all'orario) può chiederti un motivo.

> **Attenzione**: cancellazioni ripetute e all'ultimo minuto possono incidere sul tuo "credito" di prenotazioni se la Direzione attiva quel meccanismo (raro, ma possibile).

---

## 6. Check-in con QR code

Per evitare che un'aula resti "prenotata ma vuota", il Conservatorio può richiedere il **check-in**: quando arrivi in aula, fai una foto con il telefono al QR code esposto fuori, e Cadenza segna la tua presenza.

![QR code esposto in aula](screenshots/qr-code-aula.png)

### 6.1 Come si fa

1. Apri Cadenza sul telefono (o usa la PWA installata).
2. Vai alla prenotazione che stai per consumare. Cadenza mostra un bottone "**Fai check-in**".
3. In alternativa, scansiona il QR fuori dall'aula con la fotocamera del telefono → ti porta direttamente alla schermata di conferma.

![Schermata "Fai check-in"](screenshots/checkin-page.png)

### 6.2 Quando si può fare

- Da **5 minuti prima** dell'inizio della tua prenotazione (configurabile dalla Direzione).
- Fino a **15 minuti dopo** l'inizio (default; oltre questa "finestra di grazia" la prenotazione viene auto-cancellata).

### 6.3 Cosa succede se non fai check-in

Dopo 15 minuti dall'inizio senza check-in, Cadenza:

1. Marca la tua prenotazione come **"Auto-cancellata (no-show)"**.
2. Libera l'aula per altri utenti.
3. Ti manda un'email "Prenotazione cancellata: non hai effettuato check-in".

Troppe auto-cancellazioni di seguito possono attivare un rallentamento delle tue future prenotazioni (configurazione admin).

### 6.4 Aule che NON richiedono check-in

Non tutte le aule lo richiedono. Le aule didattiche con lezione del docente, per esempio, di solito ne sono esenti. Lo vedi nella scheda dell'aula: se non c'è il bottone "Fai check-in", non serve.

---

## 7. Aule e dotazioni

La voce di menu **"Aule"** ti permette di esplorare il catalogo completo degli spazi del Conservatorio.

![Pagina catalogo aule](screenshots/rooms-catalog.png)

Per ogni aula puoi vedere:

- **Foto** (se caricata).
- **Edificio e piano**.
- **Capienza** (numero massimo di persone).
- **Tipo** (studio, sala prove, ecc.).
- **Dotazioni**: pianoforte, sistema audio, leggii, lavagna, ecc.
- **Regole specifiche**: orari di accesso, fasce orarie consentite, vincoli particolari.

Filtri utili per uno studente: cerca per **strumento** (es. "pianoforte a coda") o per **edificio** se l'istituto ha più sedi.

---

## 8. Prestiti strumenti

Il Conservatorio può prestare strumenti dall'inventario (violini, chitarre, contrabbassi, fiati, ecc.). Vai a **"Strumenti"** dal menu.

![Catalogo strumenti in prestito](screenshots/instruments-catalog.png)

### 8.1 Richiedere un prestito

1. Trova lo strumento che ti interessa nel catalogo.
2. Click su "Richiedi prestito".
3. Inserisci **periodo** (da-a) e **motivo della richiesta**.
4. Conferma.

La richiesta arriva all'amministratore responsabile, che approva o rifiuta. Riceverai un'email con l'esito.

### 8.2 Le tue richieste e i tuoi prestiti

La pagina **"I miei prestiti"** mostra:

- Le richieste **pendenti** (in attesa di approvazione).
- I prestiti **attivi** (ti sono stati consegnati).
- I prestiti **passati** (restituiti).

### 8.3 Restituzione

Riporti lo strumento all'amministrazione entro la data concordata. L'amministratore marca il prestito come "Restituito" su Cadenza e l'operazione si chiude.

> **Ritardi**: se non restituisci in tempo, Cadenza ti manda un promemoria e successivamente marca il prestito come "**in mora**". Troppi prestiti in mora possono bloccare future richieste (regola della Direzione).

### 8.4 Quote e regole

Alcune regole tipiche:

- **Massimo strumenti in prestito contemporaneamente**: di solito 1-2.
- **Durata massima singolo prestito**: di solito 30-90 giorni.
- **Strumenti riservati ai soli iscritti al corso di quel famiglia**: per esempio un fagotto può essere prestato solo a studenti di fagotto. Cadenza filtra automaticamente.

---

## 9. Avvisi e bacheca

In Dashboard e in **"Avvisi"** trovi le comunicazioni della Direzione. Sono filtrati automaticamente in base al tuo corso e al tuo ruolo (vedi solo quelli che ti riguardano).

![Lista avvisi](screenshots/announcements.png)

Tipi di avviso:

- **Generico**: a tutti.
- **Per corso**: solo agli iscritti di quel corso.
- **Urgenti**: in cima e marcati in rosso, possono richiedere conferma di lettura.

Click su un avviso per leggere il testo completo.

---

## 10. Profilo, notifiche e calendario personale

Dal menu in alto a destra (avatar con le tue iniziali) → **"Profilo"**.

![Pagina profilo](screenshots/profile.png)

### 10.1 Dati personali

Puoi modificare:

- Nome e cognome.
- Email (solo se non sei loggato con OAuth Google/Microsoft).
- Numero di telefono (opzionale, usato per eventuali SMS della Direzione).
- Lingua dell'interfaccia.

Matricola e corso di studio **non sono modificabili** da te: se sono sbagliati, scrivi alla Segreteria.

### 10.2 Cambio password

Se accedi con email + password, sotto "Sicurezza" puoi cambiarla. Devi inserire la vecchia password per conferma. Dopo il cambio, tutte le sessioni attive su altri dispositivi vengono disconnesse.

### 10.3 2FA (autenticazione a due fattori)

Opt-in per gli studenti. Se la attivi, ad ogni login dovrai inserire un codice a 6 cifre che ti arriva via email. Più sicuro ma anche più lento.

### 10.4 Notifiche

Sezione "Notifiche": scegli cosa vuoi ricevere via email:

- ✅ **Conferma prenotazione** (consigliato attivo).
- ✅ **Promemoria 1 ora prima** (consigliato attivo).
- 🔘 **Cancellazione di altri utenti** in aule che ti interessano (opzionale).
- ✅ **Cambio stato prestiti** (consigliato attivo).
- ✅ **Avvisi della Direzione** (default attivo).

### 10.5 Calendario personale (.ics)

Cadenza espone le tue prenotazioni come **feed iCal** che puoi importare in Google Calendar, Apple Calendar, Outlook. Il feed si aggiorna automaticamente — non devi ri-importarlo ogni volta.

Per attivarlo:

1. Vai in Profilo → "Calendario personale".
2. Click su "Genera link iCal".
3. Copia l'URL e incollalo nel tuo calendario preferito come "Aggiungi calendario dall'URL".

> **Sicurezza**: il link contiene un **token segreto personale**. Non condividerlo. Se lo perdi o pensi che qualcun altro lo abbia visto, click su "Rigenera token": il vecchio link smette di funzionare immediatamente.

---

## 11. App sul telefono (PWA)

Cadenza è una **Progressive Web App**: si installa sul telefono dal browser, senza passare per App Store o Play Store.

### 11.1 Android (Chrome)

1. Apri Cadenza in Chrome.
2. Menu (tre puntini in alto a destra) → "**Installa app**".
3. Conferma. L'icona Cadenza appare nella home come una vera app.

### 11.2 iPhone / iPad (Safari)

1. Apri Cadenza in Safari (deve essere Safari, non Chrome).
2. Bottone "Condividi" (icona quadrato con freccia in alto).
3. Scorri e click su "**Aggiungi a Home**".

Una volta installata, Cadenza funziona offline parzialmente: il calendario salvato e i tuoi dati restano leggibili anche senza rete, ma non puoi fare nuove prenotazioni se sei offline.

---

## 12. Bot Telegram (opzionale)

Se il Conservatorio ha attivato il bot Telegram, puoi prenotare e ricevere notifiche da chat.

1. Vai in Profilo → "Bot Telegram".
2. Click sul link "Collega Telegram" — ti porta a una chat con il bot.
3. Invia il messaggio `/start` e segui le istruzioni.

Una volta collegato, da Telegram puoi:

- Scrivere "prenota studio domani alle 10" → il bot ti propone gli studi liberi.
- Confermare con un click.
- Ricevere il promemoria 1 ora prima direttamente in chat.

Il bot capisce italiano semplice — non c'è una sintassi rigida.

---

## 13. Lingue dell'interfaccia

Cadenza è disponibile in 5 lingue:

- 🇮🇹 Italiano
- 🇬🇧 English
- 🇪🇸 Español
- 🇩🇪 Deutsch
- 🇫🇷 Français

Cambia lingua dal toggle in alto a destra (icona globo) oppure dal Profilo. Le email che ricevi sono sempre nella lingua del tuo profilo.

---

## 14. Cose che NON puoi fare (e perché)

Alcune funzioni di Cadenza sono **riservate a docenti o amministratori**: se non le vedi è normale, non è un bug.

| Funzione                                    | Riservata a     | Perché                                                                    |
| ------------------------------------------- | --------------- | ------------------------------------------------------------------------- |
| **Monte Ore annuale**                       | Docenti         | Le ore di lezione vengono proposte dal docente, non dallo studente.       |
| **Prenotazioni ricorrenti**                 | Docenti         | Servono per il calendario didattico fisso, non per l'esercizio personale. |
| **Spostamenti e cambio aula**               | Docenti         | Riguardano lezioni Monte Ore, non singole prenotazioni studente.          |
| **Approvazione prenotazioni**               | Amministratori  | Le richieste per aule speciali le valuta la Direzione.                    |
| **Gestione utenti**                         | Amministratori  | Modifiche all'anagrafica si fanno in Segreteria.                          |
| **Import da Isidata**                       | Amministratori  | È un'operazione di massa, riservata all'amministrazione.                  |
| **Visualizzare il manuale Docente / Admin** | Docenti / Admin | Hanno informazioni che a te non servono e potrebbero confondere.          |

---

## 15. Domande ricorrenti

**Posso prenotare un'aula per un mio compagno?**
No. Le prenotazioni sono nominative. Se hai bisogno di studiare insieme, ognuno prenota per sé oppure prenota una sala prove a tuo nome.

**Posso cambiare aula a una prenotazione già fatta?**
Non direttamente. La cancelli e ne crei una nuova nell'aula desiderata, se è ancora libera.

**Quanto tempo prima posso prenotare?**
Dipende dalle regole del tuo Conservatorio, ma tipicamente da subito fino a 2-4 settimane in avanti. Se provi a prenotare oltre il limite, Cadenza te lo dice con un messaggio.

**Cosa succede se la rete WiFi del Conservatorio non funziona e devo fare check-in?**
Il check-in funziona anche dalla rete dati del tuo telefono — non è obbligatorio essere collegato al WiFi del Conservatorio (a meno che la Direzione non lo abbia configurato esplicitamente).

**Posso prenotare aule di un altro edificio del mio Conservatorio?**
Sì, se l'istituto ha più sedi puoi prenotare in qualsiasi sede a meno di restrizioni specifiche per corso (raro).

**Ho cambiato corso di studio: cosa devo fare?**
Comunicalo alla Segreteria. Loro aggiornano il tuo profilo Cadenza e ti vedrai applicare le nuove regole automaticamente.

**Cancellando una prenotazione perdo del "credito"?**
Solo se la Direzione ha configurato una regola apposita (raro per gli studenti). Cancella tranquillamente entro i tempi indicati — Cadenza te lo segnala se c'è una penale.

**Non vedo il bottone "Prestiti strumenti": dove sta?**
Il modulo Prestiti potrebbe non essere attivo nel tuo Conservatorio. Chiedi alla Segreteria. Se è attivo ma non lo vedi, prova a ricaricare la pagina (Ctrl/Cmd + R).

**Mi è arrivata un'email "Auto-cancellazione": cosa è successo?**
Avevi prenotato un'aula con check-in obbligatorio e non hai fatto check-in entro la finestra di grazia. La prenotazione è stata cancellata automaticamente per liberare l'aula. La prossima volta ricordati di scansionare il QR all'arrivo.

**Posso usare Cadenza senza creare un account?**
No. Tutto in Cadenza richiede di essere registrati e approvati dalla Segreteria. È una piattaforma interna del Conservatorio.

---

> Per problemi tecnici (login, password, errori imprevisti) scrivi alla Segreteria. Per dubbi sul **regolamento** delle prenotazioni e dei prestiti riferisciti alla Direzione del tuo Conservatorio: Cadenza applica le regole ma non le decide.

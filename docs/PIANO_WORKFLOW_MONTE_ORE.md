# Piano di adeguamento del workflow Monte Ore

Data: 10 ottobre 2026. Stato: piano proposto, implementazione non avviata.

## Obiettivo e regole

Il docente presenta il piano annuale secondo il proprio contratto. Il revisore configura calendario e limite delle richieste, verifica la proposta, assegna le aule definitive e rende operative le prenotazioni. Ogni variazione successiva resta in attesa della decisione del revisore. Il docente riceve un'email automatica con l'esito e il piano aggiornato.

| Contratto       | Regola da implementare                                                  |
| --------------- | ----------------------------------------------------------------------- |
| Cattedra intera | 324 ore annuali                                                         |
| Tempo definito  | Monte ore positivo, massimo 162 ore; nessun minimo di 162 implicito     |
| Collaborazione  | Ore obbligatorie e positive definite alla creazione dell'utenza docente |

### Assunzioni operative del piano

Queste scelte rendono il piano implementabile, ma sono decisioni di prodotto proposte, distinte dai requisiti espliciti:

- Le 324 ore e le ore della collaborazione sono obiettivi esatti. Se sono invece minimi, cambia la modalità di validazione, non l'architettura.
- Il limite annuale conta le **richieste inviate**, comprese quelle rifiutate, perché il requisito limita quante volte il docente può richiedere una variazione. Bozze, errori di validazione e retry della stessa richiesta non consumano il limite. Una decisione del revisore non lo consuma di nuovo.
- Una richiesta può includere più cambiamenti coerenti, ad esempio cancellazione e recupero, e conta una volta. Non si conta ogni clic o ogni data.
- Il revisore può modificare e approvare direttamente la richiesta, senza una seconda accettazione del docente; motivazione e differenze restano visibili.
- Per il primo rilascio il revisore è l'admin esistente. Un revisore separato richiede un permesso dedicato e non deve ricevere tutti i poteri amministrativi.
- L'aula definitiva è assegnata per fascia/occorrenza: non si presume una sola aula per tutto l'anno.
- I vincoli giornalieri esistenti restano configurabili, ma non si introduce un'esenzione automatica per un contratto senza una regola esplicita.

## Differenze rispetto allo stato attuale

| Area              | Implementazione presente                                                                                     | Adeguamento                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Contratti         | Tipi dinamici, `defaultHours` e override individuali risolti come soglia minima                              | Regola esplicita `exact` / `maximum` / eventuale `minimum`; collaborazione senza fallback silenzioso a 324 |
| Creazione docente | Utente creato prima; contratto/override salvati con seconda chiamata                                         | Un'unica operazione atomica: niente collaboratore creato senza ore                                         |
| Calendario        | Settings annuali, sospensioni e sessioni disponibili                                                         | Riutilizzo con verifica dell'impatto sui piani esistenti                                                   |
| Proposta          | Fasce e griglia, totali diversi, operazioni non tutte riferite all'anno selezionato                          | Un conteggio autorevole e anno esplicito in tutte le operazioni                                            |
| Approvazione      | Approva e genera prenotazioni sono operazioni separate; generazione può essere parziale                      | Conferma operativa con aule assegnate e nessun conflitto irrisolto                                         |
| Variazioni        | Alcune auto-approvate; disattivazioni escluse dal budget; contatore spesso aggiornato alla decisione         | Tutte in attesa; budget uniforme e consumato atomicamente all'invio                                        |
| Decisione         | Approva/rifiuta, con alcune possibilità di assegnazione aula                                                 | Approva, rifiuta, modifica e approva per tutte le modifiche supportate                                     |
| Email             | Outbox, scheduler e template già disponibili; decisioni monte ore senza invio dedicato nelle route esaminate | Eventi e template dedicati, accodamento nella transazione della decisione                                  |

Riferimenti principali: `backend/routes/monteOre.js`, `backend/services/monteOreSlotService.js`, `backend/services/monteOreThresholdService.js`, `backend/services/monteOreService.js`, `backend/models/ContractType.js`, `backend/models/MonteOreAmendment.js`, `frontend/src/pages/MonteOre.tsx`, `frontend/src/pages/admin/MonteOre.tsx`, `frontend/src/components/monteOre/MonteOreGrid.tsx`, `frontend/src/components/admin/UserFormDialog.tsx`.

## Fase 1 — Contratto, anno accademico e conteggi

1. Estendere la configurazione contrattuale con modalità di validazione e indicazione di ore individuali obbligatorie. Creare i tre tipi richiesti senza reinterpretare automaticamente tutti i vecchi contratti.
2. Salvare contratto e ore insieme all'utenza nella stessa transazione. Applicare gli stessi controlli alle API, non soltanto al form.
3. Congelare sulla proposta lo snapshot del contratto: tipo, modalità, minuti annuali e versione. Un cambio anagrafico successivo apre una rivalidazione esplicita, preservando lo storico.
4. Calcolare le durate in minuti interi. Esporre separatamente obiettivo/limite, ore pianificate e ore prenotate; eliminare l'uso di `totalHoursRequested` come blocco all'invio quando il totale reale è negli slot.
5. Propagare anno/proposta in tutte le letture e scritture, comprese fasce, rigenerazione e nuove giornate. Uniformare le chiavi di cache e aggiornare griglia, riepilogo e azioni dopo ogni modifica.
6. Usare un servizio comune di validazione per invio, approvazione, import e variazioni. La UI mostra gli stessi esiti senza essere l'autorità.

Accettazione: 324 ore valide per cattedra intera; 323/325 non valide con modalità esatta. Tempo definito: 120 e 162 valide, 162h01 non valide. Collaborazione da 80 ore: dato obbligatorio in creazione e piano da 80 ore valido. Preparare l'anno successivo non modifica quello corrente.

## Fase 2 — Calendario e presentazione del piano

1. Riutilizzare `MonteOreSettings`, `MonteOreSuspension` e la pagina impostazioni per vacanze, blocchi e massimo richieste annuali; validare il massimo come intero non negativo, con zero che disabilita nuove richieste.
2. Applicare calendario e intervallo di validità del docente a tutte le date. Vietare selezioni in giornate bloccate.
3. Organizzare la pagina docente in contratto → fasce → calendario → riepilogo → invio. Mostrare chiaramente aula preferita e assegnazione definitiva ancora da decidere.
4. Aggiungere selezione per periodo/giorno e rigenerazione incrementale che preservi le selezioni compatibili. Per rimozioni inevitabili presentare le differenze prima della conferma.
5. Prima di modificare vacanze o blocchi dopo l'approvazione, mostrare piani e prenotazioni coinvolti. Richiedere una revisione amministrativa tracciata delle sole occorrenze interessate, senza consumare il budget docente; vietare sovrapposizioni silenziose con un blocco appena introdotto.
6. Una riduzione del massimo richieste non cancella lo storico: residuo pari a zero se le richieste già consumate superano il nuovo limite.

Accettazione: una vacanza non produce ore pianificate; aggiornare una fascia non azzera l'intero anno; cambiare calendario segnala tutte le occorrenze coinvolte.

## Fase 3 — Approvazione e assegnazione definitiva delle aule

1. Mostrare al revisore contratto, totale, calendario effettivo, aule preferite e conflitti prima della decisione.
2. Rendere obbligatoria l'aula definitiva per ogni occorrenza attiva. Consentire assegnazione per fascia con eccezioni per singola data.
3. Introdurre anteprima di approvazione e un comando di conferma che rivalida e applica assegnazioni, prenotazioni e stato nella stessa transazione. L'anteprima non riserva le aule: ricontrollare disponibilità al commit.
4. Non dichiarare operativa una proposta con prenotazioni saltate o errori. Se una data non è disponibile, mantenere il piano da revisionare con spiegazione e nessuna generazione parziale nuova.
5. Mantenere gli stati legacy per leggere lo storico; distinguere in UI i piani già `approved` ma non generati e quelli `generated` con anomalie. Evitare una rinomina distruttiva degli enum.
6. Per richieste di correzione iniziali usare il ritorno in bozza esistente, con motivazione. Queste correzioni precedono il piano approvato e non consumano variazioni annuali.

Accettazione: approvazione impossibile senza aule; conflitto emerso dopo l'anteprima impedisce l'intera conferma; doppio clic non duplica prenotazioni; piano approvato e prenotazioni coincidono.

## Fase 4 — Richieste di variazione obbligatoriamente revisionate

1. Eliminare l'auto-approvazione per le nuove richieste di tutti i tipi, incluse disattivazione, riattivazione, cambio orario, aula e spostamento. Conservare `auto_approved` soltanto nello storico.
2. Modellare una richiesta con una o più operazioni: preferibile una tabella di dettaglio collegata a `MonteOreAmendment`, migrando ogni vecchia variazione a una singola operazione senza perdere il payload originale.
3. Salvare motivo, piano/versione di partenza, richiesta originale immutabile e chiave idempotente. Consumare una unità del budget nella stessa transazione della creazione; controllare anche richieste concorrenti.
4. Prima dell'invio mostrare differenze, saldo ore risultante e richieste residue. Il piano operativo e le prenotazioni restano invariati finché il revisore decide.
5. Raggruppare cancellazione e recupero quando occorre mantenere il monte ore contrattuale. Validare il risultato dell'intera richiesta, non i singoli passaggi intermedi.
6. Bloccare richieste sovrapposte su occorrenze con variazioni pendenti; non consentire decisioni su una versione superata senza nuova revisione. Per le date già trascorse usare una rettifica amministrativa motivata, senza riscrittura retroattiva silenziosa.
7. Esporre un contatore “Richieste inviate X/N; disponibili Y”, distinto dal numero di variazioni approvate.

Accettazione: nessuna modifica immediata; con limite 3 anche la terza richiesta rifiutata esaurisce il budget secondo l'assunzione scelta; due invii concorrenti sull'ultimo posto producono un solo consumo; retry non consuma; limite isolato per docente e anno.

## Fase 5 — Decisione, modifiche del revisore e comunicazione

1. Interfaccia comparativa: piano attuale, richiesta docente, soluzione finale del revisore. Azioni: approva, rifiuta, modifica e approva.
2. Consentire modifica di data, orario e aula e delle operazioni della richiesta. Motivazione obbligatoria per rifiuto e approvazione con modifiche. Conservare originale e soluzione finale separatamente.
3. Validare contratto, calendario, durata e conflitti sul risultato finale. Applicare decisione, slot, prenotazioni, revisione del piano e record email nella stessa transazione; un errore lascia la richiesta pendente e il piano invariato.
4. Aggiungere template email per approvazione, rifiuto e approvazione con modifiche. Includere anno, riepilogo prima/dopo, aula definitiva, motivazione, saldo e link alla richiesta. Il rifiuto comunica che resta valido il piano precedente.
5. Riutilizzare `MailOutbox` e lo scheduler. Adeguare `enqueueMail` o introdurre un servizio transazionale dedicato: il helper corrente non riceve una transazione e gestisce alcuni errori in best-effort, quindi non basta chiamarlo dentro la route.
6. Chiave univoca per richiesta e versione della decisione; retry SMTP senza rieseguire la decisione. Visualizzare accodata, inviata al server SMTP o fallita, con reinvio amministrativo. Non promettere consegna certa né assenza assoluta di duplicati SMTP dopo crash.
7. Registrare attore, data, differenze e motivazione in audit. Le modifiche amministrative del calendario usano lo stesso meccanismo di comunicazione per i docenti interessati.

Accettazione: una sola decisione vincente anche tra due revisori; nessuna email per transazioni annullate; indisponibilità SMTP mantiene la mail in coda e non perde l'esito; nessuna modifica del piano in caso di rifiuto; il docente vede esattamente la soluzione comunicata.

## Fase 6 — Migrazione, verifiche e rilascio

- Migrazioni esplicite e ripetibili, compatibili con SQLite nei test e PostgreSQL in produzione. Nessun ricorso a `sync(force)` o ad alterazioni automatiche indiscriminate.
- Inventario prima della migrazione: contratti mancanti/custom, collaborazioni senza ore, proposte approvate non generate, generazioni parziali, richieste pendenti e auto-approvate.
- Non convertire automaticamente `supplente` in tempo definito né attribuire ore mancanti ai collaboratori. Produrre una lista da completare dall'admin.
- Conservare proposte operative, aule, prenotazioni e decisioni storiche. Rivalidare con le nuove regole in modo esplicito, senza cancellare prenotazioni già valide.
- Per il budget nell'anno in corso adottare una data di entrata in vigore: conservare il contatore legacy a fini di audit e contare secondo la nuova regola gli invii successivi. Mostrare il criterio in UI. Le richieste pendenti precedenti non consumano di nuovo alla decisione. Per applicazione retroattiva serve una scelta diversa esplicita.
- Aggiornare manuali docente/admin, testi di stato e tutte le cinque lingue. Documentare il significato del massimo richieste e del massimo 162 ore.
- Test backend: matrice contratti, calendario, transazioni, idempotenza, permessi e transizioni; PostgreSQL per concorrenza e vincoli anti-sovrapposizione.
- Test frontend mirati: totale coerente, anno selezionato, cache dopo clic, pulsanti bloccati con motivo, contatore e confronto della decisione.
- E2E: docente → proposta → assegnazione aula/approvazione → richiesta → ciascuno dei tre esiti → record email verificato con trasporto di test. Includere vacanze, prossimo anno e limite esaurito.
- Eseguire lint, test, copertura richiesta, typecheck/build e format check. Collaudo in staging su copia anonimizzata prima del rilascio; il presente piano non autorizza né esegue un deploy.

## Sequenza e perimetro

Ordine: fase 1 → fase 2 → fase 3 → fase 4 → fase 5 → fase 6. Ogni fase comprende i propri test; la fase 6 integra migrazione e collaudo completo.

Il primo rilascio completo deve includere tutte le fasi funzionali: togliere l'auto-approvazione senza fornire decisioni e comunicazioni complete lascerebbe il percorso incompleto.

Fuori perimetro: consuntivo delle ore effettivamente svolte, nuove regole retributive, ottimizzazione automatica delle aule, ruolo revisore autonomo salvo scelta esplicita. Si tratta delle regole di prodotto richieste, non di una verifica normativa dei contratti.

## Implementazione v1.17.0 — 10 ottobre 2026

Fasi funzionali implementate. Le operazioni composte sono memorizzate in JSON separati (`operations` e `finalOperations`) con snapshot prima/dopo, anziché in una nuova tabella di dettaglio. Questo conserva i payload precedenti e mantiene atomica la decisione. La richiesta originale non viene sovrascritta.

Il revisore resta il ruolo admin esistente. Il nuovo contatore parte da zero all'entrata in vigore, conservando `amendmentCount` per lo storico. Tutti i nuovi invii contano, anche se rifiutati; le rettifiche amministrative non contano. La rivalidazione di date già trascorse è bloccata: richiede una gestione amministrativa separata.

Migrazione additiva e ripetibile al boot, con lock PostgreSQL fra istanze PM2. Snapshot storico mantenuto per piani submitted/approved/generated preesistenti, fino a rivalidazione esplicita. Inventario disponibile in `backend/scripts/monte-ore-inventory.js`.

Verifiche: integrazione SQLite, transazioni e concorrenza PostgreSQL su database dedicato, percorso Playwright docente–admin, lint, copertura, typecheck e build. Manuali aggiornati. Il rilascio e deploy sono stati autorizzati successivamente dall'utente.

Esito del collaudo prima del rilascio: suite backend completa superata sia in Europe/Rome sia in UTC, copertura oltre le soglie CI; 29 verifiche PostgreSQL (workflow/concorrenza, anti-sovrapposizione e statistiche); 20 E2E esistenti più 2 E2E frontend (workflow completo e prenotazione); test frontend con copertura, lint senza warning, typecheck/build e format check superati. Backup pre-migrazione sul VPS: `backup-2026-10-10-1007.tar.gz`. Nessuna email reale inviata dai test: verificata la coda transazionale con SMTP disabilitato.

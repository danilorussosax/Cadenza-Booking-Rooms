# Preparazione degli anni accademici

Dal pannello **Monte Ore → Calendario didattico**, scegliere **Crea nuovo anno accademico…**.

1. Indicare l’anno (`YYYY/YYYY`) e scegliere la configurazione standard oppure un anno sorgente precedente.
2. Scegliere separatamente se copiare regole (ore, variazioni, pause), periodo lezioni/finestra di invio, sospensioni personalizzate e sessioni d’esame.
3. Controllare l’anteprima: date, regole, sospensioni, eventuali sovrapposizioni e giorni disponibili dal lunedì al sabato. Il conteggio non verifica le disponibilità delle aule. Ogni modifica alle date o alle soglie richiede di aggiornare l’anteprima.
4. **Salva bozza** conserva una preparazione riservata all’amministrazione. **Pubblica anno** la rende utilizzabile. Le altre impostazioni, le sospensioni e gli esami si possono rifinire dalla pagina del calendario.

La pubblicazione non anticipa le date della finestra di invio. **Mostra ai docenti** sceglie esplicitamente quale anno viene mostrato; **Usa selezione automatica** ripristina la scelta in base a calendario e finestra. I docenti possono preparare una bozza di piano nell’anno pubblicato; l’invio segue la finestra e le eventuali deroghe individuali già previste.

Gli anni conclusi possono essere archiviati e ripubblicati. L’archiviazione rimuove la selezione esplicita per i docenti e impedisce modifiche al calendario e ai piani tramite le operazioni amministrative. Non elimina dati o prenotazioni.

## Regole di copia

- Le sei sospensioni standard vengono ricalcolate ogni volta che si prepara un nuovo anno: Immacolata, Natale, Pasqua, Liberazione, Lavoratori, Repubblica.
- Le date copiate mantengono giorno e mese usando la distanza effettiva tra gli anni. Il 29 febbraio diventa il 28 febbraio quando necessario. Il giorno della settimana può cambiare: verificare sempre ponti e sessioni.
- I piani dei docenti e le prenotazioni non vengono copiati.
- La creazione ripetuta senza sovrascrittura conserva integralmente l’anno esistente. I riavvii del server non ripristinano festività eliminate o spostate.
- L’interfaccia di creazione non offre più il ripristino distruttivo delle impostazioni: un anno esistente si modifica dal calendario. L’API mantiene `overwrite` per compatibilità, con controllo dell’impatto sulle lezioni.

## Migrazione e verifica

La migrazione additiva `20261011000000-academic-year-lifecycle` introduce `monte_ore_settings.status`. Gli anni già presenti diventano `published`, preservandone l’operatività. Il bootstrap crea esplicitamente i nuovi anni come `draft`. La migrazione viene eseguita anche prima della sincronizzazione sicura, con lock PostgreSQL per l’avvio di più worker PM2.

L’installazione resta a singola istituzione (decisione della release 1.20). I servizi di bootstrap isolano la sorgente per istituto; l’API amministrativa usa l’istituto dell’installazione e non accetta un istituto scelto dal client. I vecchi piani senza configurazione mantengono la compatibilità storica.

Test dedicati: `academicYearLifecycle.test.js`, `academicYearBootstrap.test.js`, `timeTravel.test.js`, test dei componenti e percorso Playwright `academic-years.spec.ts`.

## Versione automatica

Dopo il commit della funzionalità, `npm run release:version -- --dry-run` mostra la versione proposta. `npm run release:version` aggiorna i quattro manifest e i lockfile senza cambiare dipendenze. La versione è ricavata dai commit successivi al tag corrente: breaking change → major, `feat` → minor, altri cambiamenti → patch. Commit di release, tag, GitHub Release e deploy sono passaggi espliciti successivi.

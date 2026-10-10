# Esecuzione del piano di debug — Cadenza 1.20

Data: 10 ottobre 2026. Riferimento: [piano e rilievi iniziali](PIANO_DEBUG_RELEASE_1.20.md).

L'implementazione è stata autorizzata dopo l'analisi iniziale. Le modifiche sono nel working tree; nessun deploy o intervento sui dati di produzione. Versione dei pacchetti allineata a 1.20.0. Le cancellazioni `.serena/` già presenti non fanno parte del lavoro.

## Decisioni confermate

- C03: Google/Microsoft sono sufficienti per il login; non viene richiesta una seconda verifica 2FA locale al ritorno dal provider.
- C04: un solo istituto per installazione. Nessuna dichiarazione di supporto multi-istituto.
- C06: il massimo contemporaneo conta tutte le richieste aperte, anche con date future disgiunte. La quota giorni include la porzione dei prestiti che attraversano il limite inferiore dei 365 giorni e mantiene il conteggio degli impegni futuri già previsto.
- C08: feed personale riattivato in `/announcements`, con voce nel menu condiviso desktop/mobile e testi nelle cinque lingue.

## Interventi

| Rilievi       | Risultato                                                                                                                                                                                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D01, D22      | Cache React Query svuotata ai cambi di sessione; risposte obsolete ignorate, anche se riuscite; sincronizzazione tra schede; credenziali conservate dopo errori transitori; caricamento OAuth termina anche in errore.                                                        |
| D02, D03      | Policy approvazione condivisa: modifica e claim su aula soggetta ad approvazione producono `pending_approval` per utenti non admin.                                                                                                                                           |
| D04           | Pagina del link waitlist con caricamento, errore, voce non disponibile e claim. Destinazione conservata attraverso login, incluso OAuth avviato dai pulsanti. Corretto il redirect concorrente del guard pubblico.                                                            |
| D05, D06, C05 | Uscita dalla coda idempotente, promozione del successivo, hook nelle cancellazioni massive e GDPR; verifica dell'intero intervallo del candidato e notifica atomica sotto lock.                                                                                               |
| D07, D08      | Letture delle quote nella transazione serializzabile del prestito; cancellazione condizionata allo stato, compatibile con approvazione concorrente.                                                                                                                           |
| D09–D11       | Enum `pending_approval` corretto; date effettive nell'export; rimozione foto dopo commit e recupero delle cancellazioni fallite nel job retention. Foto personali escluse dalla cache PWA e HTTP persistente; pulizia della vecchia cache `storage-v1`.                       |
| D12–D14       | Versione sessione nel token pre-2FA; consumo OTP/recovery e reset password sotto lock/transazione; revoca e challenge aggiornate insieme a logout e cambio password.                                                                                                          |
| D15, D16      | PATCH sospensione aggiorna l'eccezione collegata nella stessa transazione. Riduzione/rimozione ricalcola i blocchi; le lezioni cancellate restano inattive e richiedono una scelta esplicita per essere ripristinate.                                                         |
| D17, D18      | API live restore bloccata con `409 RESTORE_OFFLINE_REQUIRED`; CLI condivisa con validazione archivio, snapshot separato, lock di manutenzione, guard all'avvio, percorso SQLite configurato e conservazione WAL/SHM. PostgreSQL usa `ON_ERROR_STOP` e `--single-transaction`. |
| D19           | Prenotazione bot validata e scritta nella stessa transazione serializzabile. Elaborazione chat PostgreSQL serializzata fra worker con advisory lock transazionale, attesa fuori dalla connessione e limite di occupazione del pool.                                           |
| D20, D21      | Proxy Vite `/storage`; errori OAuth verso `/login` e messaggio visibile.                                                                                                                                                                                                      |
| D23, D24      | Import logger corretto; completate le chiavi mancanti nelle quattro lingue e aggiunti i testi per claim/annunci in tutte e cinque.                                                                                                                                            |
| C01           | Store PostgreSQL atomico condiviso per i limiter HTTP; chiavi hashate, pulizia dei bucket scaduti. SQLite mantiene lo store in memoria per installazioni a processo singolo. Corretto anche il fallback della chiave IPv6.                                                    |
| C02, C07      | Verify SMTP con budget applicativo di 2 secondi; timeout socket SMTP e curl readiness; refresh configurazione condiviso e chiusura del pool scaduto.                                                                                                                          |
| C09–C11       | Contratto Node allineato; gate formattazione aggiunto in CI; documentazione aggiornata; test GDPR/restore deterministici e regressioni dedicate. Build fingerprint verificato da `deploy.sh --no-build`.                                                                      |

Nuove tabelle: `rate_limit_buckets`, creata anche da sync sicuro; migrazione `20261010120000-rate-limit-buckets.js` disponibile per installazioni con `DB_SYNC_MODE=none`. Non sono state eseguite migrazioni sui database esistenti dell'utente.

## Verifiche

| Verifica                                                             | Esito                                                                                                      |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Backend SQLite, Europe/Rome, con coverage                            | 110 file e 1.879 test superati; 5 file e 19 test esclusi/skipped                                           |
| Backend SQLite, UTC                                                  | 110 file e 1.879 test superati; 5 file e 19 test esclusi/skipped                                           |
| Coverage backend                                                     | Statements 73,73%; branches 63,80%; functions 79,88%; lines 75,22%. Tutte le soglie rispettate             |
| Frontend con coverage                                                | 30 file, 287 test superati; soglie rispettate                                                              |
| PostgreSQL: vincoli, aggregazioni, regressioni, rate limit e restore | 6 file, 46 test superati                                                                                   |
| Bot su PostgreSQL                                                    | 28 test superati                                                                                           |
| Browser Chromium                                                     | 22 test workspace E2E e 3 test frontend superati; le 2 nuove regressioni ripetute dopo gli ultimi ritocchi |
| Controlli statici e build                                            | Lint senza errori, build frontend riuscita, sintassi shell e fingerprint della build verificati            |

Anche `format:check` e `git diff --check` sono superati. Il cluster PostgreSQL temporaneo è stato arrestato al termine delle prove.

I test usano SQLite in-memory, file SQLite temporanei e un cluster PostgreSQL 18 temporaneo su porta 55432. La produzione usa PostgreSQL 16: il controllo sul motore 16 resta al job CI configurato nel repository. I test esclusi comprendono suite dedicate ad altri motori o carichi opzionali; non sono conteggiati come superati.

## Procedura di ripristino 1.20

Il pulsante API non ripristina più il database durante il servizio. La procedura richiede un operatore sull'host del backend:

1. Arrestare **tutte** le istanze API, bot, scheduler e ogni altro processo che scrive sullo stesso database/storage. Per l'installazione PM2 standard: `pm2 stop cadenza-backend`. Controllare che nessun altro host condivida il database e continui a scrivere.
2. Eseguire dalla root, con configurazione DB corretta, `node backend/scripts/restore.js /percorso/backup.tar.gz --offline`. Il flag dichiara che l'arresto è già stato effettuato: la CLI non arresta automaticamente processi o host remoti.
3. La CLI valida l'archivio, crea un lock esclusivo su `backend/data/restore-maintenance.lock`, salva uno snapshot completo in `backend/data/snapshots/pre-restore-<timestamp>.tar.gz`, chiude il proprio pool e ripristina. L'archivio sorgente non viene sovrascritto dallo snapshot.
4. Solo dopo successo il lock è rimosso ed è possibile riavviare tutte le istanze. Verificare `/api/ready` e un flusso applicativo.
5. In caso di errore il lock resta e impedisce nuovi avvii. Lasciare il servizio fermo, verificare database e uploads, recuperare lo snapshot se necessario, e rimuovere il lock solo dopo la verifica. Non riavviare alla cieca.

Il database PostgreSQL è ripristinato in una transazione; database e filesystem uploads **non** costituiscono un'unica transazione distribuita. Un errore sugli uploads dopo il commit DB richiede il recupero operativo dello snapshot, con servizio ancora fermo. La prova su clone completo dell'installazione e la procedura PM2/PgBouncer reale restano necessarie prima del rollout.

## Inventario dei dati conservati dal flusso di cancellazione

La route anonimizza e disabilita l'utente, lo elimina logicamente, cancella le prenotazioni future confermate/in approvazione e rimuove le proposte Monte Ore. Le foto vengono rimosse fisicamente. Prenotazioni passate, prestiti, consensi e audit non sono eliminati da questo flusso; mantengono relazioni con l'identificatore utente. Le tabelle collegate non vengono tutte attraversate automaticamente dal soft-delete: tra queste binding/sessioni bot, token di reset e messaggi già accodati. L'accesso autenticato è negato all'utente eliminato, ma questo non equivale alla cancellazione fisica di ogni dato correlato.

La 1.20 corregge D09–D11; la revisione completa di contenuti storici, allegati, destinatari nella coda mail, backup e regole di retention richiede una policy esplicita. Questo report descrive il comportamento del codice, non certifica la conformità legale.

## Limiti della verifica

- Nessun accesso alla VPS o a dati reali; nessun deploy, push o commit.
- OAuth live Google/Microsoft, SMTP reale, Graph, adapter esterni, reverse proxy e PgBouncer non sono stati verificati con credenziali di produzione.
- Il test multi-processo riguarda il contatore condiviso. Non sostituisce una prova completa del cluster PM2 né un soak su staging.
- I test browser usano Chromium e dati sintetici. Non coprono ogni dispositivo, kiosk o integrazione hardware.
- La build può segnalare chunk oltre 600 kB e import Sentry sia statico sia dinamico: sono avvisi di ottimizzazione, non errori di compilazione.

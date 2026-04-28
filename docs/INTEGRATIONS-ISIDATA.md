# Integrazione Isidata — Liv A (import manuale CSV/XLSX)

Questa guida descrive come allineare l'anagrafica utenti di Cadenza con
quella della segreteria Isidata caricando un export del file XLSX/CSV.

> **Sicurezza**: Cadenza non cancella mai utenti locali. Gli utenti che
> non sono più presenti nell'export Isidata vengono **disattivati**
> (`isActive=false`) e marcati con una nota "external_orphan". Lo storico
> prenotazioni rimane intatto.

## Indice

1. [Esportare i dati da Isidata](#1-esportare-i-dati-da-isidata)
2. [Caricare il file in Cadenza](#2-caricare-il-file-in-cadenza)
3. [Anteprima e applica](#3-anteprima-e-applica)
4. [Cosa cambia nel database](#4-cosa-cambia-nel-database)
5. [Mapping campi e override avanzato](#5-mapping-campi-e-override-avanzato)
6. [Storico esecuzioni](#6-storico-esecuzioni)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Esportare i dati da Isidata

Le procedure variano leggermente fra release Isidata; il flusso tipico è:

1. Accedi al **Pannello Segreteria** Isidata con un account abilitato
   all'export anagrafica.
2. Vai in **Allievi → Stampe / Export → Esporta in formato Excel**, oppure
   l'analogo per Docenti (**Personale → Export → XLSX**).
3. Spunta i campi minimi richiesti da Cadenza:
   - **Matricola** (obbligatorio)
   - **Cognome**, **Nome** (obbligatori)
   - **Email istituzionale** (consigliato — se assente, Cadenza genera
     un placeholder e l'admin la modificherà al primo accesso)
   - **Codice corso** o **Descrizione corso** (consigliato)
   - **Stato** (Iscritto / Cessato / Sospeso) per discriminare attivi vs
     non attivi
4. Esporta in formato **XLSX**. CSV (UTF-8 o Latin1, delim `,` o `;`) è
   ugualmente accettato.

### Limiti

| Limite            | Valore                                                          |
| ----------------- | --------------------------------------------------------------- |
| Dimensione file   | **10 MB** (validato)                                            |
| Record per file   | **5000** (oltre, le righe successive sono ignorate con warning) |
| Formati accettati | `.xlsx`, `.xls`, `.csv`, `.tsv`, `.txt`                         |

---

## 2. Caricare il file in Cadenza

Vai in **Admin → Import Isidata** (sidebar `/admin/integrations/isidata`).

1. Trascina il file XLSX nell'area di drop, oppure clicca per scegliere.
2. (Opzionale) apri **Mapping campi** se gli header del tuo export non
   vengono riconosciuti automaticamente — vedi [§ 5](#5-mapping-campi-e-override-avanzato).
3. Premi **Anteprima**.

Il backend NON modifica nulla in questa fase: legge il file, calcola il
diff e lo persiste solo in `os.tmpdir()/cadenza-imports/` per 10 minuti.

---

## 3. Anteprima e applica

L'anteprima mostra tre sezioni colorate:

- **Verde — Da creare**: utenti presenti nel file ma non in Cadenza.
  Verranno creati con `status='pending'` (l'admin li approva
  esplicitamente dopo).
- **Blu — Da aggiornare**: utenti già esistenti i cui dati nel file
  divergono (cognome, email, ruolo, matricola, stato). Per ognuno è
  mostrato l'elenco preciso di campi modificati.
- **Ambra — Da disattivare**: utenti già linkati ad Isidata (per import
  precedenti) che non sono più nel file corrente. Verranno **disattivati**
  ma conservati. Il loro storico prenotazioni resta valido.

Verifica la lista, spunta **"Confermo di aver verificato il diff"** e
premi **Applica modifiche**. La sincronizzazione avviene in
**transazione SERIALIZABLE** (Postgres) o ACID singola (SQLite/MySQL):
o tutto o niente.

> **Anti-TOCTOU**: l'apply rispedisce al backend l'hash SHA-256 del file
> mostrato in preview. Se il file cached fosse stato sostituito (es.
> con un secondo upload concorrente da un'altra finestra), l'apply viene
> rifiutato con `HASH_MISMATCH`.

---

## 4. Cosa cambia nel database

Per ogni utente coinvolto, vengono valorizzate / aggiornate le colonne:

| Campo                | Significato                                                           |
| -------------------- | --------------------------------------------------------------------- |
| `externalSource`     | `'isidata'` — il sistema sorgente                                     |
| `externalId`         | Matricola Isidata (o externalId se presente nel file)                 |
| `lastExternalSyncAt` | Timestamp dell'apply                                                  |
| `externalStatusNote` | (solo orphan) `"Non più presente nell'export Isidata del YYYY-MM-DD"` |

L'unique index `users_external_source_id_uq` su
`(externalSource, externalId)` evita doppioni di import.

Le colonne **non legate al sorgente** (`passwordHash`, `tokenVersion`,
preferenze email, 2FA, `lastLogin`, etc.) **non vengono mai
sovrascritte** dall'import.

---

## 5. Mapping campi e override avanzato

Il backend riconosce automaticamente gli header italiani standard di
Isidata (`Matricola`, `Cognome`, `Nome`, `Email`, `Ruolo`, `Stato`,
`Codice corso`, …). Il match è **case-insensitive** e ignora spazi e
accenti, quindi `MATRICOLA`, `Matr ı` e `matricola` sono equivalenti.

Se il tuo export usa header non standard puoi specificare un override
JSON nella sezione **Mapping campi** della UI:

```json
{
  "externalId": "Numero matricola",
  "email": "Email istituzionale",
  "role": "Tipo utente",
  "courseCode": "Indirizzo"
}
```

I campi target supportati sono:
`externalId`, `email`, `firstName`, `lastName`, `role`, `matricola`,
`courseCode`, `courseName`, `status`, `birthDate`.

---

## 6. Storico esecuzioni

In fondo alla pagina trovi la lista degli ultimi 20 run, con:

- timestamp e admin che ha lanciato l'import
- contatori `letti / creati / aggiornati / disattivati / errori`
- status: `success`, `partial` (qualche errore non fatale), `failed`

Per investigare un errore:

```sql
SELECT errorPayload, diffSnapshot
FROM integration_sync_runs
WHERE id = <runId>;
```

---

## 7. Troubleshooting

### "Matricole con leading zero diventano numeri"

Excel converte le matricole tipo `00042` in `42`. Cadenza le tratta
come stringhe (parser XLSX con `raw:false`), quindi i leading zero
vengono preservati. Il diff engine inoltre normalizza `42` ≡ `00042`
per il matching, evitando falsi update.

### "Tutti gli utenti finiscono in `toCreate`"

Significa che il match per `matricola` non funziona. Verifica:

1. Che la colonna **Matricola** sia presente nel file (o che tu abbia
   specificato l'override `externalId`).
2. Che non ci siano caratteri invisibili (es. spazi accidentali) che
   alterano il match. Apri il file in un editor di testo e controlla
   l'header.

### "L'orphan count è inaspettatamente alto"

Vengono marcati come orphan **solo gli utenti con
`externalSource='isidata'`**. Se è il primo import del nuovo flusso,
nessun utente locale ha ancora quel marker — quindi il primo run avrà
`orphan = 0`. Il count "vero" si vede dal secondo import in poi, quando
gli utenti effettivamente cessati di Isidata vengono propagati come
disattivazioni.

### "HASH_MISMATCH all'apply"

L'admin ha caricato un file diverso fra preview e apply (probabile
seconda finestra/tab). Ricarica la preview con il file corretto.

### "TOKEN_EXPIRED — File scaduto"

Il file temporaneo viene cancellato dopo 10 minuti dall'upload. Se la
revisione del diff richiede più tempo, ricarica la preview.

### File grandi: `FILE_TOO_LARGE`

Il limite hard è 10 MB. Per export molto pesanti (>5000 record)
suddividi in più file (es. per anno o per corso) e applicali uno alla
volta — ciascun batch è additivo.

---

## Limitazioni note (Liv A)

- L'integrazione **non sincronizza il piano di studi** o gli esami:
  solo l'anagrafica utente (nome, email, ruolo, matricola, stato, corso).
- Non c'è uno scheduler automatico: Liv A è 100% manuale via UI.
- Pull SOAP e webhook in tempo reale (Liv B/C) sono nella roadmap; il
  diff engine è già pronto per riusarne il payload tramite l'interfaccia
  `Provider` (`backend/services/integrations/base.js`).

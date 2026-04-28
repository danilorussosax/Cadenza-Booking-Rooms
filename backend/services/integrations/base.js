'use strict';

/**
 * Interfaccia "Provider" delle integrazioni esterne.
 *
 * Ogni provider (isidata-csv, isidata-soap, isidata-webhook, …) implementa
 * questa interfaccia. Liv A copre solo `isidata-csv` (parsing manuale di
 * file XLSX/CSV caricato dall'admin); Liv B/C aggiungeranno il pull SOAP
 * e l'ascolto webhook senza modifiche al diff engine o ai consumer downstream.
 *
 * L'interfaccia è una "duck typing convention": un Provider è un oggetto
 * che espone alcuni dei seguenti metodi.
 *
 *   testConnection(config) → Promise<{ ok: boolean, message?: string }>
 *     Solo Liv B/C — verifica connettività/credenziali del sistema sorgente.
 *
 *   fetchUsers({ config, file?, signal }) → Promise<{
 *     users: ExternalUser[],
 *     warnings?: { row: number, msg: string }[],
 *   }>
 *     Restituisce gli utenti dal sistema sorgente. Per il provider CSV il
 *     parametro `file` è il Buffer del file caricato; per i provider live è
 *     ignorato (l'auth viene da `config.credentialsEncrypted`).
 *
 *   fetchCourses({ config, file?, signal }) → Promise<{ courses: ExternalCourse[] }>
 *     Opzionale. Quando non implementato, i corsi vengono creati on-demand
 *     dal nome stringa contenuto in ExternalUser.courseName.
 *
 * ExternalUser shape (lingua franca tra provider e diff engine):
 *
 *   {
 *     externalId: string,           // matricola Isidata o staff number
 *     email: string|null,           // se nullo, match per matricola
 *     firstName: string,
 *     lastName: string,
 *     role: 'docente'|'studente',   // mai 'admin'
 *     matricola: string|null,
 *     courseCode: string|null,      // codice corso (es. "CODI/21")
 *     courseName: string|null,      // descrittivo (fallback se code mancante)
 *     status: 'active'|'inactive',  // dal sistema sorgente; 'inactive' →
 *                                    // disattivato anche su Aula Book
 *     raw?: object,                 // riga sorgente (utile per debug)
 *   }
 */

module.exports = {
  // Re-export simbolico — non c'è codice qui, solo doc per il contratto.
};

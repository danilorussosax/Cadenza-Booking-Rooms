import type { QueryClient } from '@tanstack/react-query';

import { qk } from '@/lib/queryKeys';

/**
 * Invalidazioni per evento di dominio.
 *
 * Ogni funzione sa quali cache toccare quando succede qualcosa (es. "e'
 * cambiata la struttura"): le mutation chiamano l'evento invece di elencare
 * a mano le chiavi, cosi' un nuovo consumatore di un dato richiede una
 * modifica in un solo punto. Le chiavi vengono da `lib/queryKeys.ts`.
 *
 * Nota sui due prefissi simili: `['institute', 'public']` e' il branding
 * pubblico (nome, logo, flag moduli: `invalidateInstituteBranding`);
 * `['institutes', ...]` e' la struttura per l'admin (`invalidateStructure`).
 */

type Qc = Pick<QueryClient, 'invalidateQueries'>;

/** Invalida piu' chiavi in parallelo e risolve quando i refetch attivi finiscono. */
const invalidateAll = async (qc: Qc, keys: readonly (readonly unknown[])[]): Promise<void> => {
  await Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
};

/**
 * Aule/edifici/sedi creati, modificati, importati o eliminati.
 * Tocca: albero istituti admin, albero struttura (Quote/Regole/Annunci),
 * liste aule (Dashboard, Prenotazioni, Regole) e Display kiosk
 * (`/api/public/*`, che mostra codice/nome/piano/foto delle aule).
 */
export const invalidateStructure = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [
    qk.institutes.all(),
    qk.structure.institutesFull(),
    qk.rooms.all(),
    qk.public.all(),
  ]);

/**
 * Strumenti/attrezzatura di un'aula creati o modificati.
 * L'attrezzatura compare nell'albero istituti (Struttura, Aule, Display
 * admin) e nella ricerca aule per tipo di attrezzatura (`['rooms','search']`);
 * il Display kiosk pubblico non la mostra, quindi `['public']` non si tocca.
 */
export const invalidateEquipment = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.institutes.all(), qk.structure.institutesFull(), qk.rooms.all()]);

/** Branding pubblico dell'istituto (nome, logo, icona app, copyright, flag moduli). */
export const invalidateInstituteBranding = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.institute.public()]);

/** Anagrafica istituto (dati, logo): struttura admin + branding pubblico. */
export const invalidateInstituteProfile = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.institutes.all(), qk.institute.public()]);

/**
 * Eliminazione di istituto/edificio/aula: tutto quello che cambia con la
 * struttura piu' il branding pubblico (un istituto eliminato cambia il
 * branding risolto).
 */
export const invalidateStructureDeleted = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [
    qk.institutes.all(),
    qk.structure.institutesFull(),
    qk.institute.public(),
    qk.rooms.all(),
    qk.public.all(),
  ]);

/**
 * Prenotazione creata/modificata/annullata/approvata: elenchi prenotazioni
 * utente e admin (inclusi i conteggi pending) e disponibilita' aule.
 */
export const invalidateBookings = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.bookings.all(), qk.availability.all(), qk.adminBookings.all()]);

/** Monte ore (vista utente e admin): cambio anno accademico, import, impostazioni. */
export const invalidateMonteOre = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.monteOre.all(), qk.adminMonteOre.all()]);

/**
 * Facciata dell'API monte ore: riesporta tipi, client docente/admin e helper
 * dai moduli per dominio in `./monteOre/`.
 */
import type { Booking } from '@/types';

export * from './monteOre/types';
export { monteOreApi } from './monteOre/teacher';
export { monteOreAdminApi } from './monteOre/admin';
export { amendmentSummary } from './monteOre/amendmentSummary';

// Re-export per chi consuma il modulo
export type { Booking };

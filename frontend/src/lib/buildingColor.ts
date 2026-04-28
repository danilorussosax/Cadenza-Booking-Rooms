/**
 * Palette deterministica per assegnare un colore distintivo a ciascun edificio.
 *
 * Le classi Tailwind devono essere stringhe letterali, non costruite a runtime,
 * altrimenti il CSS purger non le include nel bundle. Per questo la palette è
 * un array di oggetti con classi pre-composte.
 *
 * - `text`  → classe di testo (per usi inline come "Nome edificio")
 * - `chip`  → bg + testo (per badge / pillole)
 * - `tile`  → bg + testo + ring (per tile-icone, es. struttura admin)
 */
const PALETTE = [
  {
    text: 'text-sky-700 dark:text-sky-300',
    chip: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
    tile: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  },
  {
    text: 'text-amber-700 dark:text-amber-300',
    chip: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    tile: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  },
  {
    text: 'text-emerald-700 dark:text-emerald-300',
    chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    tile: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
  {
    text: 'text-violet-700 dark:text-violet-300',
    chip: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
    tile: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  },
  {
    text: 'text-rose-700 dark:text-rose-300',
    chip: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
    tile: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  },
  {
    text: 'text-orange-700 dark:text-orange-300',
    chip: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
    tile: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  },
  {
    text: 'text-teal-700 dark:text-teal-300',
    chip: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
    tile: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
  },
  {
    text: 'text-indigo-700 dark:text-indigo-300',
    chip: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
    tile: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  },
] as const;

export type BuildingColor = (typeof PALETTE)[number];

/**
 * Restituisce le classi colore per un edificio in base al suo id.
 * Lo stesso edificio mantiene lo stesso colore tra render e refresh.
 */
export function buildingColor(id: number | null | undefined): BuildingColor {
  const i = Math.abs(id ?? 0) % PALETTE.length;
  return PALETTE[i];
}

/** Ritorna un nuovo Set con `id` aggiunto se assente, rimosso se presente. */
export function toggleSetItem<T>(prev: ReadonlySet<T>, id: T): Set<T> {
  const next = new Set(prev);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Se tutti gli `ids` sono già nel Set li rimuove, altrimenti li aggiunge tutti. */
export function toggleSetItems<T>(prev: ReadonlySet<T>, ids: readonly T[]): Set<T> {
  const next = new Set(prev);
  const allIn = ids.every((id) => next.has(id));
  if (allIn) for (const id of ids) next.delete(id);
  else for (const id of ids) next.add(id);
  return next;
}

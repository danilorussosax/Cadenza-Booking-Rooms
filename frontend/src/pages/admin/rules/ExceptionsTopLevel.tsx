import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { roomsApi } from '@/api/rooms';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { BookingRuleExceptionScope } from '@/types';
import { qk } from '@/lib/queryKeys';

import { ExceptionsSection } from './ExceptionsSection';

/**
 * Eccezioni promosse a tab top-level. Riusa ExceptionsSection (che resta
 * fonte unica per CRUD) ma con un selettore di filtro che permette anche
 * la vista "tutte le eccezioni" (admin only — l'API ritorna tutto se
 * `role` è omesso).
 */
export function ExceptionsTopLevel() {
  const [scopeRole, setScopeRole] = useState<BookingRuleExceptionScope | 'every'>('every');
  const [scopeRoom, setScopeRoom] = useState<'every' | number>('every');

  const SCOPES: { value: BookingRuleExceptionScope | 'every'; label: string }[] = [
    { value: 'every', label: 'Tutte le eccezioni' },
    { value: 'all', label: 'Tutti i ruoli (eccezioni globali)' },
    { value: 'studente', label: 'Studenti' },
    { value: 'docente', label: 'Docenti' },
    { value: 'admin', label: 'Admin' },
  ];

  const roomsQuery = useQuery({
    queryKey: qk.rooms.listAll(),
    queryFn: () => roomsApi.list(),
    staleTime: 5 * 60 * 1000,
  });
  // Aule raggruppate per edificio (ordinate sede → aula). Le aule senza
  // building noto finiscono in coda. La label mostra "Sede · Aula" così
  // l'admin distingue numeri ripetuti tra edifici diversi.
  const rooms = [...(roomsQuery.data?.rooms ?? [])].sort((a, b) => {
    const ba = a.building?.name ?? '￿';
    const bb = b.building?.name ?? '￿';
    if (ba !== bb) return ba.localeCompare(bb, 'it');
    return a.name.localeCompare(b.name, 'it');
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Ruolo</Label>
          <Select
            value={scopeRole}
            onValueChange={(v) => {
              setScopeRole(v as BookingRuleExceptionScope | 'every');
            }}
          >
            <SelectTrigger className="w-[240px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCOPES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Aula</Label>
          <Select
            value={String(scopeRoom)}
            onValueChange={(v) => {
              setScopeRoom(v === 'every' ? 'every' : Number(v));
            }}
          >
            <SelectTrigger className="w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="every">Tutte (globali + per aula)</SelectItem>
              {rooms.map((r) => (
                <SelectItem key={r.id} value={String(r.id)}>
                  {r.building?.name ? `${r.building.name} · ${r.name}` : r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <ExceptionsSection
        role={scopeRole === 'every' ? undefined : scopeRole}
        roomId={scopeRoom === 'every' ? undefined : scopeRoom}
      />
    </div>
  );
}

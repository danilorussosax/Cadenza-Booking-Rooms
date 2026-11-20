import { useState } from 'react';
import { History } from 'lucide-react';
import { amendmentSummary, type MonteOreAmendment } from '@/api/monteOre';
import { Badge } from '@/components/ui/badge';

export function AmendmentList({ amendments }: { amendments: MonteOreAmendment[] }) {
  const [open, setOpen] = useState(false);
  const pending = amendments.filter((a) => a.status === 'pending').length;
  const auto = amendments.filter((a) => a.status === 'auto_approved').length;
  return (
    <div className="rounded-lg border bg-muted/10">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex items-center gap-2">
          <History className="h-4 w-4" />
          Storico variazioni ({amendments.length})
        </span>
        <span className="flex items-center gap-2">
          {pending > 0 && <Badge variant="secondary">{pending} in attesa</Badge>}
          {auto > 0 && <Badge variant="success">{auto} auto-approvate</Badge>}
        </span>
      </button>
      {open && (
        <ul className="border-t px-3 py-2 text-xs">
          {amendments.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between border-b py-1.5 last:border-0"
            >
              <span>
                {a.kind === 'toggle_off' && 'Disattivazione'}
                {a.kind === 'toggle_on' && 'Riattivazione'}
                {a.kind === 'change_time' && 'Cambio orario'}
                {a.kind === 'add_new_day' && 'Nuovo giorno'}
                {a.kind === 'change_room' && 'Cambio aula'}
                {a.kind === 'move_to' && 'Spostamento'}
                {' — '}
                {a.operations?.length
                  ? a.operations
                      .map((op) =>
                        amendmentSummary({
                          ...a,
                          kind: op.kind,
                          slotId: op.slotId ?? null,
                          payload: op.payload,
                        }),
                      )
                      .join('; ')
                  : amendmentSummary(a)}
              </span>
              <Badge
                variant={
                  a.status === 'auto_approved' || a.status === 'approved'
                    ? 'success'
                    : a.status === 'rejected'
                      ? 'destructive'
                      : 'secondary'
                }
              >
                {a.status === 'pending' && 'In attesa'}
                {a.status === 'auto_approved' && 'Auto-approvata'}
                {a.status === 'approved' && 'Approvata'}
                {a.status === 'rejected' && 'Rifiutata'}
                {a.afterSnapshot?.map((slot) => (
                  <span key={slot.id} className="block text-xs text-muted-foreground">
                    {slot.date} {slot.startTime}–{slot.endTime} · Aula #{slot.roomId}
                    {!slot.isActive ? ' · cancellata' : ''}
                  </span>
                ))}
                {a.decisionNotes && (
                  <span className="block text-xs text-muted-foreground">{a.decisionNotes}</span>
                )}
                {a.emailStatus && (
                  <span className="block text-xs text-muted-foreground">
                    Email:{' '}
                    {a.emailStatus === 'sent'
                      ? 'inviata al server SMTP'
                      : a.emailStatus === 'dead'
                        ? 'invio fallito'
                        : 'accodata'}
                  </span>
                )}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

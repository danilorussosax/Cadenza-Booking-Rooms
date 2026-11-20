import { ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
export function SummaryTile({
  icon: Icon,
  value,
  label,
  color,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  label: string;
  color: 'emerald' | 'sky' | 'amber' | 'muted';
  active: boolean;
  onClick: () => void;
}) {
  const tones = {
    emerald:
      'bg-emerald-50 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/30',
    sky: 'bg-sky-50 text-sky-700 ring-sky-200/70 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/30',
    amber:
      'bg-amber-50 text-amber-800 ring-amber-200/70 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/30',
    muted: 'bg-muted text-foreground/80 ring-muted-foreground/20',
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 rounded-xl p-3 text-left ring-1 transition',
        tones[color],
        active && 'ring-2 ring-offset-2',
      )}
    >
      <Icon className="h-5 w-5" />
      <div>
        <p className="font-display text-2xl font-medium leading-none">{value}</p>
        <p className="mt-1 text-[0.625rem] uppercase tracking-wider opacity-80">{label}</p>
      </div>
    </button>
  );
}

export function Section({
  title,
  count,
  accent,
  warning,
  children,
}: {
  title: string;
  count: number;
  accent: 'emerald' | 'sky' | 'amber';
  warning?: boolean;
  children: React.ReactNode;
}) {
  const accents = {
    emerald:
      'border-emerald-300/60 bg-emerald-50/40 dark:border-emerald-500/30 dark:bg-emerald-500/5',
    sky: 'border-sky-300/60 bg-sky-50/40 dark:border-sky-500/30 dark:bg-sky-500/5',
    amber: 'border-amber-300/60 bg-amber-50/40 dark:border-amber-500/30 dark:bg-amber-500/5',
  } as const;
  return (
    <section className={cn('rounded-xl border p-4', accents[accent])}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-lg font-medium">
          {title} <span className="ml-2 text-sm text-muted-foreground">({count})</span>
        </h3>
        {warning && (
          <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300">
            <ShieldAlert className="mr-1 h-3 w-3" /> soft-disable
          </Badge>
        )}
      </div>
      {children}
    </section>
  );
}

export function DiffTable({
  rows,
  headers,
}: {
  rows: { key: string; cells: (string | number)[] }[];
  headers: string[];
}) {
  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="px-3 py-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 200).map((r) => (
            <tr key={r.key} className="border-t">
              {r.cells.map((c, i) => (
                <td key={i} className="px-3 py-2 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 200 && (
        <p className="border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          + {rows.length - 200} righe ulteriori non mostrate
        </p>
      )}
    </div>
  );
}

export function RunStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
    partial: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
    failed: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300',
    in_progress: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300',
    preview: 'bg-muted text-foreground/70',
  };
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[0.625rem] font-medium uppercase',
        map[status] ?? map.preview,
      )}
    >
      {status}
    </span>
  );
}

import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

// Soglia → variant badge: verde sotto warn, giallo tra warn-crit, rosso oltre.
export function levelBadge(
  value: number | null | undefined,
  warn: number,
  crit: number,
  label: string,
) {
  if (value == null) return <Badge variant="muted">—</Badge>;
  if (value >= crit) {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" />
        {label}
      </Badge>
    );
  }
  if (value >= warn) {
    return (
      <Badge variant="warning" className="gap-1">
        <AlertTriangle className="h-3 w-3" />
        {label}
      </Badge>
    );
  }
  return (
    <Badge variant="success" className="gap-1">
      <CheckCircle2 className="h-3 w-3" />
      {label}
    </Badge>
  );
}

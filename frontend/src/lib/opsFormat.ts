import type { OpsScheduler } from '@/api/ops';

export function fmtBytes(b: number | null | undefined): string {
  if (b == null || !Number.isFinite(b)) return '—';
  if (b < 1024) return `${b} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = b / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
  if (seconds < 86_400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${Math.round(seconds / 86_400)}g`;
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 0) return `tra ${fmtDuration(-ms / 1000)}`;
    const sec = ms / 1000;
    if (sec < 60) return `${Math.round(sec)}s fa`;
    if (sec < 3600) return `${Math.round(sec / 60)}min fa`;
    if (sec < 86_400) return `${(sec / 3600).toFixed(1)}h fa`;
    return `${Math.round(sec / 86_400)}g fa`;
  } catch {
    return iso;
  }
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('it-IT', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function isStale(s: OpsScheduler): boolean {
  if (!s.enabled) return false;
  if (!s.lastTickAt || !s.intervalMs) return false;
  const age = Date.now() - new Date(s.lastTickAt).getTime();
  // "Stale" se non ha tick-ato da oltre 2× il proprio intervallo nominale.
  return age > s.intervalMs * 2;
}

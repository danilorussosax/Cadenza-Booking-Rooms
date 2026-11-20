import { useEffect, useState } from 'react';
import { snapshotDebugInfo, type DebugInfo } from '@/lib/displayDebug';

/**
 * Overlay diagnostico: attivo solo con `?debug`. Aggiornato live su resize e
 * ogni secondo (utile per regolare manualmente lo zoom del browser TV).
 */
export function useDebugInfo(): DebugInfo | null {
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('debug')) return;
    const update = (): void => {
      setDebugInfo(snapshotDebugInfo());
    };
    update();
    window.addEventListener('resize', update);
    const id = setInterval(update, 1000);
    return () => {
      window.removeEventListener('resize', update);
      clearInterval(id);
    };
  }, []);
  return debugInfo;
}

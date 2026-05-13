import { PackageX, Phone } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Mostrata quando una pagina di modulo riceve `MODULE_DISABLED` dal backend.
 * Indica chiaramente all'utente che la funzionalità è stata disattivata
 * dalla Direzione (non c'è un bug né un errore di permessi).
 */
export function ModuleDisabledCard({
  moduleLabel,
  description,
}: {
  moduleLabel: string;
  description?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardContent className="py-10 text-center space-y-4">
          <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <PackageX className="h-7 w-7 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <h2 className="font-display text-2xl font-medium">{moduleLabel} — non attivo</h2>
            <p className="text-sm text-muted-foreground">
              {description ??
                'La Direzione ha temporaneamente disattivato questo modulo. Quando verrà riattivato, la funzionalità tornerà subito disponibile.'}
            </p>
          </div>
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Phone className="h-3.5 w-3.5" />
            Per informazioni contatta la Segreteria del Conservatorio.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// `isModuleDisabledError` è stato spostato in `@/lib/moduleFlags` per non
// mischiare componenti React e utility nello stesso file (react-refresh).

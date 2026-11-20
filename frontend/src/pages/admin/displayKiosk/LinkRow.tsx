import { Check, Copy, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface LinkRowProps {
  label: string;
  sublabel?: string;
  url: string;
  copied: boolean;
  onCopy: () => void;
}

/**
 * Riga compatta con label dell'edificio, URL "ready-to-paste" mostrato in
 * monospace, bottone "Apri" (link al kiosk) e bottone "Copia" con feedback
 * temporaneo "Copiato!".
 */
export function LinkRow({ label, sublabel, url, copied, onCopy }: LinkRowProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-stretch gap-2 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{label}</span>
          {sublabel && <span className="text-[11px] text-muted-foreground">· {sublabel}</span>}
        </div>
        <code className="mt-0.5 block truncate text-xs text-muted-foreground">{url}</code>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button asChild variant="outline" size="sm">
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3.5 w-3.5" />
            {t('admin.display.links_card.open')}
          </a>
        </Button>
        <Button
          variant={copied ? 'default' : 'outline'}
          size="sm"
          onClick={onCopy}
          className={cn(copied && 'bg-emerald-600 hover:bg-emerald-600')}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              {t('admin.display.links_card.copied')}
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              {t('admin.display.links_card.copy')}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

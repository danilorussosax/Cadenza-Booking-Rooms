import { useState } from 'react';
import { Link2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { slugifyBuilding } from '@/lib/displayUrl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import type { Building } from '@/types';
import { LinkRow } from './LinkRow';

/**
 * Card "Link diretti per sede" — URL ready-to-copy per i tabelloni di ingresso
 * che mostrano SOLO una sede invece della rotazione completa. Documenta anche
 * le 3 sintassi accettate (?b, ?building, ?<slug>) e il match a 3 livelli
 * (code esatto, nome esatto, substring del nome).
 */
export function LinksCard({ buildings }: { buildings: Building[] }) {
  const { t } = useTranslation();
  // Stato per il feedback "Copiato" sui bottoni dei link diretti per sede.
  // Si auto-resetta dopo 2 secondi così l'utente può copiare più link in
  // sequenza senza che il badge resti acceso su uno solo.
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyToClipboard = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // clipboard API non disponibile (browser vecchio o contesto non-secure):
      // fallback con prompt che mostra la stringa e l'utente la copia a mano.
      window.prompt(t('admin.display.links_card.copy_fallback'), text);
    }
  };
  const base = typeof window !== 'undefined' ? window.location.origin : 'https://…';
  const rotationUrl = `${base}/display`;

  return (
    <Card>
      <CardContent className="space-y-4 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-100 ring-1 ring-indigo-300/60 dark:bg-indigo-500/15 dark:ring-indigo-400/30">
            <Link2 className="h-5 w-5 text-indigo-700 dark:text-indigo-300" />
          </span>
          <div className="flex-1">
            <h2 className="text-base font-semibold">{t('admin.display.links_card.title')}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('admin.display.links_card.subtitle')}
            </p>
          </div>
        </div>

        {/* Help box con le 3 sintassi */}
        <Alert>
          <AlertDescription>
            <p className="text-xs font-medium">{t('admin.display.links_card.help_title')}</p>
            <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
              <li>
                <code className="rounded bg-muted px-1 py-0.5">/display</code> —{' '}
                {t('admin.display.links_card.help_rotation')}
              </li>
              <li>
                <code className="rounded bg-muted px-1 py-0.5">/display?b=&lt;codice&gt;</code> —{' '}
                {t('admin.display.links_card.help_code')}
              </li>
              <li>
                <code className="rounded bg-muted px-1 py-0.5">/display?&lt;slug&gt;</code> —{' '}
                {t('admin.display.links_card.help_slug')}
              </li>
            </ul>
          </AlertDescription>
        </Alert>

        {/* Lista URL per ogni building */}
        <div className="space-y-2">
          {/* URL rotazione (top) */}
          <LinkRow
            label={t('admin.display.links_card.rotation_label')}
            url={rotationUrl}
            copied={copiedKey === 'rotation'}
            onCopy={() => void copyToClipboard(rotationUrl, 'rotation')}
          />

          {/* URL per ogni building */}
          {buildings.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {t('admin.display.links_card.no_buildings')}
            </p>
          )}
          {buildings.map((b) => {
            // Preferiamo il code se valorizzato (più stabile rispetto al nome
            // che può cambiare). Altrimenti slugifichiamo il nome.
            const codeSlug = b.code ? slugifyBuilding(b.code) : null;
            const primarySlug = codeSlug ?? slugifyBuilding(b.name);
            const url = `${base}/display?${primarySlug}`;
            const key = `b-${b.id}`;
            return (
              <LinkRow
                key={b.id}
                label={b.name}
                sublabel={
                  b.code
                    ? t('admin.display.links_card.with_code', { code: b.code })
                    : t('admin.display.links_card.without_code')
                }
                url={url}
                copied={copiedKey === key}
                onCopy={() => void copyToClipboard(url, key)}
              />
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

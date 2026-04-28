import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SUPPORTED_LANGUAGES, LANGUAGE_NAMES, type SupportedLanguage } from '@/i18n';
import { cn } from '@/lib/utils';

interface Props {
  className?: string;
  /** "compact" = trigger compatto solo icona; "default" = mostra anche il codice lingua */
  variant?: 'compact' | 'default';
}

export function LanguageToggle({ className, variant = 'compact' }: Props) {
  const { i18n, t } = useTranslation();
  const current = ((i18n.resolvedLanguage ?? i18n.language) || 'it').split(
    '-',
  )[0] as SupportedLanguage;
  const safe = (SUPPORTED_LANGUAGES as readonly string[]).includes(current) ? current : 'it';

  return (
    <Select value={safe} onValueChange={(v) => i18n.changeLanguage(v)}>
      <SelectTrigger
        aria-label={t('language.select')}
        title={t('language.select')}
        className={cn(
          'h-9 w-auto gap-1.5 rounded-md border-transparent bg-transparent px-2 shadow-none hover:bg-accent focus:ring-0 focus:ring-offset-0',
          className,
        )}
      >
        <Globe className="h-4 w-4" aria-hidden />
        {variant === 'default' ? (
          <SelectValue />
        ) : (
          <span className="text-xs font-medium uppercase tracking-wider">{safe}</span>
        )}
      </SelectTrigger>
      <SelectContent align="end">
        {(SUPPORTED_LANGUAGES as readonly SupportedLanguage[]).map((lng) => (
          <SelectItem key={lng} value={lng}>
            {LANGUAGE_NAMES[lng]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

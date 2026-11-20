import { Wifi, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Dayjs } from 'dayjs';
import type { PublicInstitute } from '@/types';
import { FullscreenToggle } from '@/components/FullscreenToggle';
import { cn } from '@/lib/utils';

interface DisplayHeaderProps {
  institute: PublicInstitute | null;
  appIcon: string;
  now: Dayjs;
  isLive: boolean;
  hideUi: boolean;
}

/** Header compatto su singola riga: logo + nome istituto, data·orario·live + toggles. */
export function DisplayHeader({ institute, appIcon, now, isLive, hideUi }: DisplayHeaderProps) {
  const { t } = useTranslation();
  return (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2 lg:gap-6 lg:px-8 2xl:px-12 2xl:py-3">
      <div className="flex min-w-0 items-center gap-3 2xl:gap-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20 2xl:h-12 2xl:w-12">
          <img
            src={institute?.logoUrl?.trim() ? institute.logoUrl : appIcon}
            alt=""
            className="h-7 w-7 object-contain 2xl:h-9 2xl:w-9"
            onError={(e) => {
              // logoUrl rotto/404: cade sull'icona app dell'istituto.
              // Se anche quella fallisce, l'asset statico /logo3.png è
              // sempre presente in /public. Evita la broken-image al kiosk.
              const target = e.currentTarget;
              if (target.src !== window.location.origin + appIcon) {
                target.src = appIcon;
              } else if (!target.src.endsWith('/logo3.png')) {
                target.src = '/logo3.png';
              }
            }}
          />
        </div>
        <h1 className="truncate font-display text-base font-medium leading-tight sm:text-lg lg:text-xl 2xl:text-2xl">
          {institute?.name ?? t('display.title_default')}
        </h1>
      </div>

      <div className="flex shrink-0 items-center gap-3 2xl:gap-4">
        <div className="flex items-baseline gap-2 2xl:gap-3">
          <span className="hidden text-[0.6875rem] uppercase tracking-wider text-muted-foreground sm:inline 2xl:text-sm">
            {now.format('ddd D MMM')}
          </span>
          <span className="font-display text-xl font-medium tabular-nums tracking-tight sm:text-2xl lg:text-3xl 2xl:text-4xl">
            {now.format('HH:mm')}
            <span className="text-base text-muted-foreground sm:text-lg lg:text-xl 2xl:text-2xl">
              :{now.format('ss')}
            </span>
          </span>
          <span className="inline-flex items-center gap-1 text-[0.625rem] uppercase tracking-wider 2xl:text-xs">
            {isLive ? (
              <>
                <Wifi className="h-3 w-3 text-emerald-500 2xl:h-3.5 2xl:w-3.5" />
                <span className="hidden text-emerald-600 dark:text-emerald-400 lg:inline">
                  {t('display.live')}
                </span>
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3 text-amber-500 2xl:h-3.5 2xl:w-3.5" />
                <span className="hidden text-amber-600 dark:text-amber-400 lg:inline">
                  {t('display.reconnecting')}
                </span>
              </>
            )}
          </span>
        </div>
        {/* ThemeToggle nascosto: il tema è forzato chiaro su /display per
            avere kiosk con palette identica indipendente dall'OS. Lasciare
            il toggle confonderebbe (cambia, ma il primo refresh ritorna
            chiaro). FullscreenToggle resta invece utile sul kiosk. */}
        <div className={cn('flex items-center gap-1 transition-opacity', hideUi && 'opacity-0')}>
          <FullscreenToggle />
        </div>
      </div>
    </header>
  );
}

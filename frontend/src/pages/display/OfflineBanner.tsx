import { WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Offline banner: visibile solo se il backend non risponde da >2min ma il SW
 * ha dati cached. Discreto (stripe ambra) per non rovinare la UX del kiosk.
 */
export function OfflineBanner({ lastUpdateLabel }: { lastUpdateLabel: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-300/60 bg-amber-50 px-4 py-1.5 text-xs font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300 2xl:text-sm">
      <WifiOff className="h-3.5 w-3.5 2xl:h-4 2xl:w-4" />
      <span>{t('display.offline_banner', { time: lastUpdateLabel })}</span>
    </div>
  );
}

import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { BOOKING_TYPE_LABEL, BOOKING_TYPE_STYLES } from '@/lib/bookings';
import type { BookingType } from '@/types';

export function TypeBadge({ type, className }: { type: BookingType; className?: string }) {
  const { t } = useTranslation();
  const s = BOOKING_TYPE_STYLES[type];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        s.soft,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      {t(BOOKING_TYPE_LABEL[type])}
    </span>
  );
}

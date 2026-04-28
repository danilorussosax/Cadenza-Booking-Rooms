import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { BOOKING_STATUS_LABEL, BOOKING_STATUS_STYLES } from '@/lib/bookings';
import type { BookingStatus } from '@/types';

export function StatusBadge({ status, className }: { status: BookingStatus; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
        BOOKING_STATUS_STYLES[status],
        className,
      )}
    >
      {t(BOOKING_STATUS_LABEL[status])}
    </span>
  );
}

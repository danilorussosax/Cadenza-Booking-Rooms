import { Megaphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PublicAnnouncement } from '@/api/public';
import { dayjs } from '@/lib/date';

// Slide annuncio: layout istituzionale full-bleed con icona megafono,
// titolo grande e corpo a paragrafi. Le interruzioni di riga del corpo
// vengono mantenute (textarea preservation).
export function AnnouncementSlide({ announcement }: { announcement: PublicAnnouncement }) {
  const { t } = useTranslation();
  const paragraphs = announcement.body
    .split(/\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const published = dayjs(announcement.publishedAt);
  return (
    <section className="relative flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-linear-to-br from-rose-900 via-rose-700 to-amber-600 text-white">
      <div className="absolute -right-24 -top-24 h-105 w-105 rounded-full bg-white/10 blur-3xl" />
      <div className="absolute -bottom-32 -left-32 h-120 w-120 rounded-full bg-amber-300/20 blur-3xl" />

      {/* Etichetta tipologia in alto a sinistra: stesso pattern usato per la
          slide concerto (badge pill ambra, posizione assoluta, ring shadow). */}
      <div className="absolute left-6 top-6 z-10 inline-flex items-center gap-2.5 rounded-full bg-amber-400 px-5 py-2 text-base font-semibold uppercase tracking-wider text-slate-950 shadow-lg ring-2 ring-amber-200/80 2xl:left-10 2xl:top-10 2xl:gap-3 2xl:px-7 2xl:py-3 2xl:text-xl">
        <Megaphone className="h-5 w-5 2xl:h-6 2xl:w-6" />
        {announcement.isPinned
          ? t('display.announcement.pinned_label')
          : t('display.announcement.label')}
      </div>

      <div className="relative z-10 flex flex-1 flex-col justify-center gap-6 p-10 2xl:p-16">
        <p className="text-sm font-medium uppercase tracking-wider text-white/85 2xl:text-lg">
          {published.format('dddd D MMMM YYYY')}
        </p>
        <h2 className="font-display text-4xl font-semibold leading-tight tracking-tight md:text-5xl xl:text-6xl 2xl:text-7xl">
          {announcement.title}
        </h2>
        <div className="space-y-3 text-lg leading-relaxed text-white/95 md:text-xl xl:text-2xl 2xl:text-3xl">
          {paragraphs.slice(0, 6).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </div>
    </section>
  );
}

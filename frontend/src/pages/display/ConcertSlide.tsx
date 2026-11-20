import { Music4 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { dayjs } from '@/lib/date';
import { cn } from '@/lib/utils';
import type { PublicConcert } from '@/types';

// ===========================
// Concert slide
// ===========================
//
// Layout:
// - Sfondo: locandina caricata (object-cover, NESSUN blur) oppure
//   /assets/concerto.png blurato + scurito quando non c'è locandina.
// - Overlay (in basso): card con bordi arrotondati, sfondo translucido
//   ad alto contrasto rispetto allo sfondo (testo bianco su nero ~60%).
// - Info: titolo concerto, data/ora, sede (edificio + aula),
//   esecutori e programma autori. Le textarea contengono spesso
//   elenchi separati da newline → li renderizziamo riga per riga.
/**
 * Mappa eventType → tema chip (background + ring) sulla slide kiosk.
 * I colori sono leggibili sopra qualsiasi sfondo locandina (chiaro/scuro).
 */
const EVENT_TYPE_THEME: Record<
  string,
  { bg: string; ring: string; textColor: string; labelKey: string }
> = {
  concerto: {
    bg: 'bg-amber-400',
    ring: 'ring-amber-200/80',
    textColor: 'text-slate-950',
    labelKey: 'display.concert.upcoming_label',
  },
  saggio: {
    bg: 'bg-cyan-400',
    ring: 'ring-cyan-200/80',
    textColor: 'text-slate-950',
    labelKey: 'display.concert.label.saggio',
  },
  masterclass: {
    bg: 'bg-fuchsia-500',
    ring: 'ring-fuchsia-200/80',
    textColor: 'text-white',
    labelKey: 'display.concert.label.masterclass',
  },
  conferenza: {
    bg: 'bg-slate-300',
    ring: 'ring-slate-100/80',
    textColor: 'text-slate-950',
    labelKey: 'display.concert.label.conferenza',
  },
  lezione_aperta: {
    bg: 'bg-emerald-400',
    ring: 'ring-emerald-200/80',
    textColor: 'text-slate-950',
    labelKey: 'display.concert.label.lezione_aperta',
  },
};

/** ISO 639-1 → emoji bandiera (sottoinsieme controllato). */
const LANG_FLAG: Record<string, string> = {
  it: '🇮🇹',
  en: '🇬🇧',
  fr: '🇫🇷',
  de: '🇩🇪',
  es: '🇪🇸',
};

export function ConcertSlide({ concert }: { concert: PublicConcert }) {
  const { t } = useTranslation();
  const posterUrl = concert.posterUrl;
  const hasPoster = !!posterUrl;
  // Quando manca la locandina mostriamo la default blurata; con la locandina
  // dell'utente la rendiamo nitida (è già una scelta editoriale dell'admin).
  const bgSrc = hasPoster ? posterUrl : '/assets/concerto.png';
  const performers = concert.performers
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const program = concert.program
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const start = dayjs(concert.startTime);
  const venueName = concert.room?.building?.name
    ? `${concert.room.building.name} · ${concert.room.name}`
    : (concert.room?.name ?? '');
  const theme = EVENT_TYPE_THEME[concert.eventType] ?? EVENT_TYPE_THEME.concerto;
  const flag = concert.language ? LANG_FLAG[concert.language] : null;

  return (
    <section className="relative h-full w-full overflow-hidden rounded-2xl border bg-black">
      {/* Background: locandina o default blurata */}
      <img
        src={bgSrc}
        alt=""
        className={cn(
          'absolute inset-0 h-full w-full',
          hasPoster ? 'object-cover' : 'object-cover scale-110',
        )}
        style={hasPoster ? undefined : { filter: 'blur(6px) brightness(0.65)' }}
      />

      {/* Velo scuro per leggibilità del testo bianco */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: hasPoster
            ? 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.45) 35%, rgba(0,0,0,0.15) 60%, rgba(0,0,0,0) 100%)'
            : 'linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.55) 100%)',
        }}
        aria-hidden
      />

      {/* Etichetta in alto a sinistra: tipologia evento.
          Colore di sfondo dipende da concert.eventType (theme map sopra). */}
      <div
        className={cn(
          'absolute left-6 top-6 inline-flex items-center gap-2.5 rounded-full px-5 py-2 text-base font-semibold uppercase tracking-wider shadow-lg ring-2 2xl:left-10 2xl:top-10 2xl:gap-3 2xl:px-7 2xl:py-3 2xl:text-xl',
          theme.bg,
          theme.ring,
          theme.textColor,
        )}
      >
        <Music4 className="h-5 w-5 2xl:h-6 2xl:w-6" />
        {t(theme.labelKey)}
      </div>

      {/* Pannello info principale */}
      <div className="absolute inset-x-0 bottom-0 px-6 pb-8 pt-6 text-white lg:px-10 2xl:px-14 2xl:pb-12">
        <div className="mx-auto max-w-5xl space-y-3 2xl:space-y-5">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm font-medium uppercase tracking-wider text-white/85 2xl:text-lg">
            <span>{start.format('dddd D MMMM · HH:mm')}</span>
            {venueName && <span className="text-white/70">· {venueName}</span>}
            {flag && (
              <span aria-label={concert.language ?? ''} title={concert.language ?? ''}>
                {flag}
              </span>
            )}
          </div>
          <h2 className="font-display text-4xl font-medium leading-tight tracking-tight text-white drop-shadow-lg sm:text-5xl xl:text-6xl 2xl:text-7xl">
            {concert.title}
          </h2>
          {concert.description && (
            <p className="max-w-4xl text-lg leading-snug text-white/90 sm:text-xl 2xl:text-2xl">
              {concert.description}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2 2xl:gap-8">
            {performers.length > 0 && (
              <div>
                <p className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-white/70 2xl:text-sm">
                  {t('display.concert.performers')}
                </p>
                <ul className="space-y-0.5 text-base leading-snug text-white sm:text-lg 2xl:text-2xl">
                  {performers.slice(0, 6).map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {program.length > 0 && (
              <div>
                <p className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-white/70 2xl:text-sm">
                  {t('display.concert.program')}
                </p>
                <ul className="space-y-0.5 text-base leading-snug text-white sm:text-lg 2xl:text-2xl">
                  {program.slice(0, 6).map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

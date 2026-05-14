import { cn } from '@/lib/utils';

interface Props {
  className?: string;
  /** Variante badge (icona quadrata blu con sigla) o wordmark (testo esteso) */
  variant?: 'badge' | 'wordmark';
}

// =============================================================================
// IsidataLogo — logo stilizzato del gestionale ISIDATA.
//
// Il logo ufficiale di ISIDATA è una wordmark blu istituzionale. Riproduciamo
// l'estetica con tipografia bold + colore brand "Isidata blue" (#003e7e).
// Due varianti:
//   - badge:    box quadrato con sigla "iD" — utile per icone compatte (16-24px)
//   - wordmark: testo completo "isidata" — utile in card o hero
//
// Tutto inline SVG: nessun asset esterno da gestire, scala perfetta a qualsiasi
// risoluzione, può essere colorato via currentColor se serve.
// =============================================================================

const ISIDATA_BLUE = '#003e7e';
const ISIDATA_BLUE_LIGHT = '#0066cc';

export function IsidataLogo({ className, variant = 'badge' }: Props) {
  if (variant === 'wordmark') {
    return (
      <svg viewBox="0 0 120 32" className={cn('h-6', className)} aria-label="ISIDATA" role="img">
        <text
          x="0"
          y="24"
          fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif"
          fontSize="22"
          fontWeight="700"
          letterSpacing="-0.5"
          fill={ISIDATA_BLUE}
        >
          isi
        </text>
        <text
          x="32"
          y="24"
          fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif"
          fontSize="22"
          fontWeight="700"
          letterSpacing="-0.5"
          fill={ISIDATA_BLUE_LIGHT}
        >
          data
        </text>
      </svg>
    );
  }
  // badge
  return (
    <svg viewBox="0 0 32 32" className={cn('h-5 w-5', className)} aria-label="ISIDATA" role="img">
      <defs>
        <linearGradient id="isidata-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={ISIDATA_BLUE} />
          <stop offset="100%" stopColor={ISIDATA_BLUE_LIGHT} />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="32" height="32" rx="6" fill="url(#isidata-gradient)" />
      <text
        x="16"
        y="22"
        textAnchor="middle"
        fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif"
        fontSize="16"
        fontWeight="800"
        letterSpacing="-0.5"
        fill="#ffffff"
      >
        iD
      </text>
    </svg>
  );
}

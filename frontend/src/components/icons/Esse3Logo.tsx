import { cn } from '@/lib/utils';

interface Props {
  className?: string;
  /** Variante badge (icona quadrata indigo con sigla) o wordmark (testo esteso) */
  variant?: 'badge' | 'wordmark';
}

// =============================================================================
// Esse3Logo — logo stilizzato del gestionale ESSE3 (Suite Studenti CINECA).
//
// ESSE3 è il sistema di gestione studenti più diffuso negli atenei italiani,
// sviluppato da KION/CINECA. Riproduciamo l'estetica con tipografia bold +
// palette indigo/viola scuro che lo distingue visivamente dal blu di
// Isidata. Due varianti:
//   - badge:    box quadrato con sigla "e3" — per icone compatte (16-24px)
//   - wordmark: testo completo "esse3" — per header o card
//
// SVG inline come per IsidataLogo: nessun asset esterno, scala perfetta,
// colorabile via currentColor se serve.
// =============================================================================

const ESSE3_INDIGO = '#312e81';
const ESSE3_INDIGO_LIGHT = '#6366f1';

export function Esse3Logo({ className, variant = 'badge' }: Props) {
  if (variant === 'wordmark') {
    return (
      <svg viewBox="0 0 120 32" className={cn('h-6', className)} aria-label="ESSE3" role="img">
        <text
          x="0"
          y="24"
          fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif"
          fontSize="22"
          fontWeight="700"
          letterSpacing="-0.5"
          fill={ESSE3_INDIGO}
        >
          esse
        </text>
        <text
          x="60"
          y="24"
          fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif"
          fontSize="22"
          fontWeight="700"
          letterSpacing="-0.5"
          fill={ESSE3_INDIGO_LIGHT}
        >
          3
        </text>
      </svg>
    );
  }
  // badge
  return (
    <svg viewBox="0 0 32 32" className={cn('h-5 w-5', className)} aria-label="ESSE3" role="img">
      <defs>
        <linearGradient id="esse3-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={ESSE3_INDIGO} />
          <stop offset="100%" stopColor={ESSE3_INDIGO_LIGHT} />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="32" height="32" rx="6" fill="url(#esse3-gradient)" />
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
        e3
      </text>
    </svg>
  );
}

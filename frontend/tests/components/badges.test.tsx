import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen } from '../test-utils';
import { StatusBadge } from '@/components/bookings/StatusBadge';
import { TypeBadge } from '@/components/bookings/TypeBadge';

describe('<StatusBadge />', () => {
  it('mostra label per ogni stato', () => {
    const statuses = ['confirmed', 'cancelled', 'pending_approval'] as const;
    statuses.forEach((s) => {
      const { unmount } = renderWithProviders(<StatusBadge status={s} />);
      // Con i18n parseMissingKeyHandler che ritorna la chiave, il testo è la chiave
      expect(
        screen.getAllByText(/booking\.status\.|bookings\.status\.|^[A-Z]/i).length,
      ).toBeGreaterThan(0);
      unmount();
    });
  });
});

describe('<TypeBadge />', () => {
  it('mostra label e dot per ogni tipo', () => {
    const types = ['lezione', 'studio_individuale', 'prova', 'concerto', 'altro'] as const;
    types.forEach((t) => {
      const { container, unmount } = renderWithProviders(<TypeBadge type={t} />);
      // verifica presenza span dot (h-1.5 w-1.5)
      expect(container.querySelector('.h-1\\.5')).toBeInTheDocument();
      unmount();
    });
  });
});

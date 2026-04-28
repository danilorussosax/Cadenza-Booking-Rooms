import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen } from '../test-utils';
import { HeatmapGrid, type HeatmapCell } from '@/components/admin/HeatmapGrid';

function emptyMatrix(): HeatmapCell[][] {
  return Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ count: 0, hours: 0 })),
  );
}

describe('<HeatmapGrid />', () => {
  it('renderizza una griglia 7×24 con 168 celle', () => {
    renderWithProviders(<HeatmapGrid heatmap={emptyMatrix()} max={0} />);
    const cells = screen.getAllByTestId(/^heatmap-cell-/);
    expect(cells).toHaveLength(7 * 24);
  });

  it('mostra le 7 etichette dei giorni', () => {
    renderWithProviders(<HeatmapGrid heatmap={emptyMatrix()} max={0} />);
    for (const day of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
      expect(screen.getByTestId(`heatmap-day-${day}`)).toBeInTheDocument();
    }
  });

  it('riflette il count della matrice nelle celle (data-count)', () => {
    const matrix = emptyMatrix();
    matrix[0][9] = { count: 5, hours: 5 }; // lunedì ore 9
    matrix[6][23] = { count: 2, hours: 2 }; // domenica ore 23
    renderWithProviders(<HeatmapGrid heatmap={matrix} max={5} />);

    const monday9 = screen.getByTestId('heatmap-cell-0-9');
    expect(monday9).toHaveAttribute('data-count', '5');
    expect(monday9).toHaveAttribute('title', '5 prenotazioni · 5 h');

    const sunday23 = screen.getByTestId('heatmap-cell-6-23');
    expect(sunday23).toHaveAttribute('data-count', '2');
  });

  it('cella vuota usa la classe bg-muted, cella più calda usa rose-500', () => {
    const matrix = emptyMatrix();
    matrix[2][10] = { count: 10, hours: 10 };
    renderWithProviders(<HeatmapGrid heatmap={matrix} max={10} />);

    const empty = screen.getByTestId('heatmap-cell-0-0');
    expect(empty.className).toMatch(/bg-muted/);

    const hot = screen.getByTestId('heatmap-cell-2-10');
    expect(hot.className).toMatch(/bg-rose-500/);
  });
});

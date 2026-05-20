import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen } from '../test-utils';
import { BookingSuggestionsPanel } from '@/components/bookings/BookingSuggestionsPanel';
import type { BookingSuggestion, Room } from '@/types';

const rooms: Pick<Room, 'id' | 'name' | 'floor' | 'building'>[] = [
  {
    id: 11,
    name: 'Studio 12',
    floor: 'Piano 1',
    building: {
      id: 1,
      name: 'Edificio A',
      floors: ['Piano 1'],
      instituteId: 1,
      institute: undefined as never,
    } as never,
  },
];

const makeSuggestion = (over: Partial<BookingSuggestion> = {}): BookingSuggestion => ({
  roomId: 11,
  startTime: '2030-01-15T10:30:00.000Z',
  endTime: '2030-01-15T11:30:00.000Z',
  reason: 'same_room_shifted_30_after',
  ...over,
});

describe('<BookingSuggestionsPanel />', () => {
  it('mostra messaggio "none" quando suggestions = []', () => {
    renderWithProviders(
      <BookingSuggestionsPanel suggestions={[]} rooms={rooms} onPick={() => {}} />,
    );
    // Con parseMissingKeyHandler la chiave viene resa letterale.
    expect(screen.getByText('booking.suggestions.none')).toBeInTheDocument();
  });

  it('renderizza un listitem per ogni suggerimento', () => {
    const suggestions = [
      makeSuggestion({ reason: 'same_room_shifted_30_after' }),
      makeSuggestion({
        reason: 'similar_room_same_time',
        startTime: '2030-01-15T10:00:00.000Z',
        endTime: '2030-01-15T11:00:00.000Z',
      }),
      makeSuggestion({
        reason: 'same_room_next_day',
        startTime: '2030-01-16T10:00:00.000Z',
        endTime: '2030-01-16T11:00:00.000Z',
      }),
    ];
    renderWithProviders(
      <BookingSuggestionsPanel suggestions={suggestions} rooms={rooms} onPick={() => {}} />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('click su una chip invoca onPick con la suggestion corretta', async () => {
    const onPick = vi.fn();
    const target = makeSuggestion({ reason: 'same_room_shifted_60_after' });
    renderWithProviders(
      <BookingSuggestionsPanel suggestions={[target]} rooms={rooms} onPick={onPick} />,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
    await userEvent.click(buttons[0]);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(target);
  });

  it('mostra il banner "conflict owner" solo se conflictOwner è valorizzato', () => {
    const { rerender } = renderWithProviders(
      <BookingSuggestionsPanel
        suggestions={[makeSuggestion()]}
        rooms={rooms}
        onPick={() => {}}
        conflictOwner="Mario Rossi"
      />,
    );
    expect(screen.getByTestId('conflict-owner')).toBeInTheDocument();

    rerender(
      <BookingSuggestionsPanel
        suggestions={[makeSuggestion()]}
        rooms={rooms}
        onPick={() => {}}
        conflictOwner={null}
      />,
    );
    expect(screen.queryByTestId('conflict-owner')).not.toBeInTheDocument();
  });

  it('disabilita tutte le chip quando disabled=true', () => {
    renderWithProviders(
      <BookingSuggestionsPanel
        suggestions={[makeSuggestion(), makeSuggestion({ reason: 'similar_room_same_time' })]}
        rooms={rooms}
        onPick={() => {}}
        disabled
      />,
    );
    for (const btn of screen.getAllByRole('button')) {
      expect(btn).toBeDisabled();
    }
  });

  it('ogni chip espone un aria-label e contiene la label di reason tradotta', () => {
    renderWithProviders(
      <BookingSuggestionsPanel suggestions={[makeSuggestion()]} rooms={rooms} onPick={() => {}} />,
    );
    const btn = screen.getAllByRole('button')[0];
    expect(btn.getAttribute('aria-label')).toBeTruthy();
    // La chiave reason è renderizzata letterale (parseMissingKeyHandler).
    expect(
      screen.getByText('booking.suggestions.reason.same_room_shifted_30_after'),
    ).toBeInTheDocument();
  });
});

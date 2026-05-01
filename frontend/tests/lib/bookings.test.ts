import { describe, it, expect } from 'vitest';
import {
  BOOKING_TYPE_OPTIONS,
  BOOKING_TYPE_LABEL,
  BOOKING_TYPE_STYLES,
  BOOKING_STATUS_LABEL,
  BOOKING_STATUS_STYLES,
  ROOM_TYPE_LABEL,
} from '@/lib/bookings';

describe('lib/bookings constants', () => {
  it('BOOKING_TYPE_OPTIONS contiene almeno lezione e studio_individuale', () => {
    const values = BOOKING_TYPE_OPTIONS.map((o) => o.value);
    expect(values).toContain('lezione');
    expect(values).toContain('studio_individuale');
  });

  it('BOOKING_TYPE_LABEL ha la chiave i18n corretta per ogni tipo', () => {
    for (const opt of BOOKING_TYPE_OPTIONS) {
      expect(BOOKING_TYPE_LABEL[opt.value]).toBe(opt.labelKey);
      expect(BOOKING_TYPE_LABEL[opt.value]).toMatch(/^booking\.form\.type_/);
    }
  });

  it('BOOKING_TYPE_STYLES ha shape soft/solid/dot/ring per ogni tipo', () => {
    for (const opt of BOOKING_TYPE_OPTIONS) {
      const style = BOOKING_TYPE_STYLES[opt.value];
      expect(style).toBeDefined();
      expect(typeof style.soft).toBe('string');
      expect(typeof style.solid).toBe('string');
      expect(typeof style.dot).toBe('string');
      expect(typeof style.ring).toBe('string');
    }
  });

  it('BOOKING_STATUS_LABEL copre gli stati principali', () => {
    expect(BOOKING_STATUS_LABEL.confirmed).toBeDefined();
    expect(BOOKING_STATUS_LABEL.cancelled).toBeDefined();
    expect(BOOKING_STATUS_LABEL.pending_approval).toBeDefined();
  });

  it('BOOKING_STATUS_STYLES è una mappa di stringhe', () => {
    Object.values(BOOKING_STATUS_STYLES).forEach((v) => expect(typeof v).toBe('string'));
  });

  it('ROOM_TYPE_LABEL contiene almeno studio e aula_concerti', () => {
    expect(ROOM_TYPE_LABEL.studio).toBeDefined();
    expect(ROOM_TYPE_LABEL.aula_concerti).toBeDefined();
  });
});

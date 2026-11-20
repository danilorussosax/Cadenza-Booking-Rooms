'use strict';

const institutionTime = require('../../lib/institutionTime');
const {
  parseDayQuery,
  parseTimeRange,
  rangeToInstants,
  dayBounds,
  addDaysIso,
} = require('../../services/messaging/dateTimeParser');
const { formatSlot, mdSafe } = require('../../services/messaging/telegramText');

afterEach(() => institutionTime.resetClock());

// Mercoledì 2026-05-13, 10:00 UTC (12:00 a Roma)
const NOW = '2026-05-13T10:00:00Z';

describe('parseDayQuery (puro, senza DB)', () => {
  it('oggi/domani usano il giorno istituzionale dell’orologio', () => {
    institutionTime.setClock(institutionTime.fixedClock(NOW));
    expect(parseDayQuery('oggi')).toBe('2026-05-13');
    expect(parseDayQuery('Domani')).toBe('2026-05-14');
  });

  it('a cavallo di mezzanotte UTC il giorno resta quello di Roma', () => {
    // 22:30 UTC del 13 = 00:30 del 14 a Roma (CEST)
    institutionTime.setClock(institutionTime.fixedClock('2026-05-13T22:30:00Z'));
    expect(parseDayQuery('oggi')).toBe('2026-05-14');
  });

  it('nome giorno → prossima occorrenza (oggi incluso)', () => {
    institutionTime.setClock(institutionTime.fixedClock(NOW));
    expect(parseDayQuery('mer')).toBe('2026-05-13');
    expect(parseDayQuery('venerdì')).toBe('2026-05-15');
    expect(parseDayQuery('lun')).toBe('2026-05-18');
  });

  it('today iniettabile come secondo argomento', () => {
    expect(parseDayQuery('ven', '2026-05-15')).toBe('2026-05-15');
    expect(parseDayQuery('domani', '2026-12-31')).toBe('2027-01-01');
  });

  it('formati data espliciti e validazione calendario', () => {
    expect(parseDayQuery('2026-04-30', '2026-01-01')).toBe('2026-04-30');
    expect(parseDayQuery('30/04/2026', '2026-01-01')).toBe('2026-04-30');
    expect(parseDayQuery('30-04-2026', '2026-01-01')).toBe('2026-04-30');
    expect(parseDayQuery('3/4/2026', '2026-01-01')).toBe('2026-04-03');
    expect(parseDayQuery('2026-02-31', '2026-01-01')).toBeNull();
    expect(parseDayQuery('2026-13-01', '2026-01-01')).toBeNull();
  });

  it('input vuoti o sconosciuti → null', () => {
    expect(parseDayQuery('', '2026-01-01')).toBeNull();
    expect(parseDayQuery(null, '2026-01-01')).toBeNull();
    expect(parseDayQuery('boh', '2026-01-01')).toBeNull();
  });

  it('addDaysIso attraversa mesi/anni', () => {
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('parseTimeRange', () => {
  it('accetta i formati supportati', () => {
    expect(parseTimeRange('14-15')).toEqual({ startH: 14, startM: 0, endH: 15, endM: 0 });
    expect(parseTimeRange('9-10:30')).toEqual({ startH: 9, startM: 0, endH: 10, endM: 30 });
    expect(parseTimeRange('14:00–15:30')).toEqual({ startH: 14, startM: 0, endH: 15, endM: 30 });
  });

  it('rifiuta fasce invalide', () => {
    expect(parseTimeRange('15-14')).toBeNull();
    expect(parseTimeRange('14-14')).toBeNull();
    expect(parseTimeRange('14:30-14:10')).toBeNull();
    expect(parseTimeRange('24-25')).toBeNull();
    expect(parseTimeRange('pranzo')).toBeNull();
    expect(parseTimeRange('')).toBeNull();
  });
});

describe('conversione in istanti (ora istituzionale, indipendente da TZ processo)', () => {
  it('rangeToInstants: 14-15 a Roma in maggio = 12:00-13:00 UTC', () => {
    const { start, end } = rangeToInstants('2026-05-15', parseTimeRange('14-15'));
    expect(start.toISOString()).toBe('2026-05-15T12:00:00.000Z');
    expect(end.toISOString()).toBe('2026-05-15T13:00:00.000Z');
  });

  it('rangeToInstants: in inverno l’offset è +1', () => {
    const { start } = rangeToInstants('2026-01-15', parseTimeRange('14-15'));
    expect(start.toISOString()).toBe('2026-01-15T13:00:00.000Z');
  });

  it('dayBounds copre il giorno istituzionale', () => {
    const { start, end } = dayBounds('2026-05-15');
    expect(start.toISOString()).toBe('2026-05-14T22:00:00.000Z');
    expect(end.toISOString()).toBe('2026-05-15T21:59:59.999Z');
  });

  it('formatSlot rende giorno e ore in ora istituzionale', () => {
    const { start, end } = rangeToInstants('2026-05-15', parseTimeRange('14-15:30'));
    expect(formatSlot(start, end)).toBe('ven 15 mag 14:00–15:30');
  });

  it('mdSafe rimuove i caratteri Markdown', () => {
    expect(mdSafe('Aula_*5`[x]')).toBe('Aula 5 x');
  });
});

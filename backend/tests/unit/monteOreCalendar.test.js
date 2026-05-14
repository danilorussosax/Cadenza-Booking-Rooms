'use strict';

/**
 * Unit: monteOreCalendarService.computeWeeks — focus su come le
 * MonteOreSuspension inibiscono i giorni/settimane.
 *
 * Storicamente:
 *   - `kind='full_week'` → settimana intera nascosta
 *   - `kind='partial'`   → singoli giorni rossi
 *
 * Bug riportato: l'admin imposta "Vacanze di Natale" come kind=`partial`
 * con range che copre 2 settimane intere, e quelle settimane continuano
 * a comparire nella griglia (riga con 6 caselle rosse). Comportamento
 * desiderato: l'unione delle sospensioni che coprono Lun-Sab fa scomparire
 * la riga, indipendentemente dal `kind`.
 */

const { computeWeeks } = require('../../services/monteOreCalendarService');

const baseSettings = {
  lessonsStartDate: '2026-11-02', // lun
  lessonsEndDate: '2027-06-26', // sab
};

describe('computeWeeks — sospensioni e blocco giorni', () => {
  it('rende 6 giorni Lun-Sab per ogni settimana (sabato incluso)', () => {
    const weeks = computeWeeks(baseSettings, []);
    expect(weeks.length).toBeGreaterThan(0);
    for (const w of weeks) {
      expect(w.days).toHaveLength(6);
      expect(w.days[0].dayOfWeek).toBe(1); // lun
      expect(w.days[5].dayOfWeek).toBe(6); // sab
    }
  });

  it("nasconde una settimana coperta da kind='full_week'", () => {
    const weeks = computeWeeks(baseSettings, [
      {
        name: 'Vacanze di Natale',
        dateFrom: '2026-12-21',
        dateTo: '2027-01-03',
        kind: 'full_week',
      },
    ]);
    // La settimana 21–26 dic e la 28 dic–2 gen devono essere nascoste.
    const hidden1 = weeks.find((w) => w.weekStart === '2026-12-21');
    const hidden2 = weeks.find((w) => w.weekStart === '2026-12-28');
    expect(hidden1).toBeUndefined();
    expect(hidden2).toBeUndefined();
  });

  it("nasconde una settimana coperta da kind='partial' quando l'unione copre Lun-Sab", () => {
    // BUG STORICO: con kind='partial' e range che copriva l'intera settimana,
    // la riga restava visibile con tutti i 6 giorni rossi. Ora deve scomparire
    // anche in questo caso.
    const weeks = computeWeeks(baseSettings, [
      {
        name: 'Vacanze di Natale',
        dateFrom: '2026-12-21',
        dateTo: '2027-01-03',
        kind: 'partial',
        category: 'holiday',
      },
    ]);
    const hidden1 = weeks.find((w) => w.weekStart === '2026-12-21');
    const hidden2 = weeks.find((w) => w.weekStart === '2026-12-28');
    expect(hidden1).toBeUndefined();
    expect(hidden2).toBeUndefined();
  });

  it("blocca singoli giorni anche se la sospensione è kind='full_week' ma non copre l'intera settimana", () => {
    // Pasqua 2027 cade dom 28 marzo: il lunedì dell'angelo (29) e il martedì
    // pasquale opzionale (30) lasciano libera mercoledì-sabato. La sospensione
    // potrebbe essere salvata come full_week dall'admin per coerenza con
    // "vacanze di pasqua", ma copre solo 2 giorni della settimana → la riga
    // resta visibile con quei 2 giorni rossi.
    const weeks = computeWeeks(baseSettings, [
      {
        name: 'Vacanze di Pasqua',
        dateFrom: '2027-03-29',
        dateTo: '2027-03-30',
        kind: 'full_week',
        category: 'holiday',
      },
    ]);
    const w = weeks.find((x) => x.weekStart === '2027-03-29');
    expect(w).toBeDefined();
    expect(w.days[0].isLocked).toBe(true);
    expect(w.days[0].lockReason).toBe('Vacanze di Pasqua');
    expect(w.days[1].isLocked).toBe(true);
    expect(w.days[2].isLocked).toBe(false); // mercoledì libero
  });

  it("blocca un singolo giorno festivo (kind='partial', category='holiday')", () => {
    const weeks = computeWeeks(baseSettings, [
      {
        name: 'Immacolata',
        dateFrom: '2026-12-08',
        dateTo: '2026-12-08',
        kind: 'partial',
        category: 'holiday',
      },
    ]);
    const w = weeks.find((x) => x.weekStart === '2026-12-07');
    expect(w).toBeDefined();
    expect(w.days[0].isLocked).toBe(false); // lun
    expect(w.days[1].isLocked).toBe(true); // mar 8 dic
    expect(w.days[1].lockReason).toBe('Immacolata');
  });

  it('marca giorni fuori dal periodo lezioni come isLocked con motivo dedicato', () => {
    const weeks = computeWeeks(
      {
        lessonsStartDate: '2026-11-04', // mer
        lessonsEndDate: '2026-11-10', // mar successivo
      },
      [],
    );
    // Prima settimana: lun 2 e mar 3 sono "prima dell'inizio lezioni".
    const w = weeks[0];
    expect(w.days[0].lockReason).toMatch(/prima/i);
    expect(w.days[1].lockReason).toMatch(/prima/i);
    expect(w.days[2].isLocked).toBe(false); // mer 4 libero
  });
});

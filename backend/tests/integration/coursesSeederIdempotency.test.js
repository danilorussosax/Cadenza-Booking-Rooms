'use strict';

/**
 * Regression: i corsi AFAM eliminati (soft-delete) NON devono riapparire
 * a ogni riavvio del server. Prima del fix in seeders/initial.js il
 * blocco `if (course.deletedAt) await course.restore()` riportava in
 * vita ogni corso che l'admin aveva eliminato dalla UI.
 */

const { Course } = require('../../models');
const seedInitial = require('../../seeders/initial');

describe('seeder corsi AFAM — idempotenza vs soft-delete', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('primo seed crea i corsi AFAM', async () => {
    await seedInitial();
    const count = await Course.count();
    expect(count).toBeGreaterThan(0);
  });

  it('riseeding NON ricrea né ripristina i corsi soft-deleted', async () => {
    // 1) seed iniziale → catalogo AFAM presente
    await seedInitial();
    const sampleCode = 'AFAM001';
    const before = await Course.findOne({ where: { code: sampleCode } });
    expect(before).not.toBeNull();

    // 2) admin elimina un corso (soft-delete)
    await before.destroy();
    const afterDeletePresent = await Course.findOne({ where: { code: sampleCode } });
    expect(afterDeletePresent).toBeNull(); // paranoid esclude i soft-deleted di default

    // 3) riseeding (simula riavvio server)
    await seedInitial();

    // 4) il corso resta soft-deleted, NON deve essere riapparso
    const stillGone = await Course.findOne({ where: { code: sampleCode } });
    expect(stillGone).toBeNull();

    // ma esiste ancora come soft-deleted (paranoid:false lo trova)
    const stillSoftDeleted = await Course.findOne({
      where: { code: sampleCode },
      paranoid: false,
    });
    expect(stillSoftDeleted).not.toBeNull();
    expect(stillSoftDeleted.deletedAt).not.toBeNull();
  });

  it('riseeding non duplica i corsi presenti', async () => {
    await seedInitial();
    const c1 = await Course.count({ paranoid: false });
    await seedInitial();
    await seedInitial();
    const c2 = await Course.count({ paranoid: false });
    expect(c2).toBe(c1);
  });

  it('admin può sempre ricreare manualmente un corso eliminato', async () => {
    await seedInitial();
    const target = await Course.findOne({ where: { code: 'AFAM002' } });
    expect(target).not.toBeNull();
    await target.destroy();

    // Riseeding non ripristina (regression test fix)
    await seedInitial();
    const stillGone = await Course.findOne({ where: { code: 'AFAM002' } });
    expect(stillGone).toBeNull();

    // L'admin però può ricrearlo (lo scenario "ho cambiato idea") — basta
    // che il vincolo unique non blocchi: prima rimuove definitivamente la
    // riga soft-deleted o riusa una destroy con force.
    const soft = await Course.findOne({ where: { code: 'AFAM002' }, paranoid: false });
    await soft.destroy({ force: true });
    const recreated = await Course.create({
      code: 'AFAM002',
      name: "Ricreato dall'admin",
      isActive: true,
    });
    expect(recreated.code).toBe('AFAM002');
  });
});

'use strict';

/**
 * Integration: services/structureImporter.js (CSV → Building/Room/Equipment).
 *
 * importStructure() esercita end-to-end tutti gli helper interni (parseCSV,
 * normalizeHeader, rowsToObjects, parseBool, clampInt, pickEnum) sul path
 * normale, e copre la transazione Sequelize con findOrCreate + update
 * idempotenti su Building, Room, Equipment.
 *
 * Copre:
 *   - validazione input: instituteId mancante, CSV vuoto/whitespace,
 *     solo header, Institute non trovato
 *   - parseCSV: delimitatore auto-detect (, ; tab), BOM, virgolette
 *     escape (""), campi multilinea, righe vuote ignorate
 *   - parseBool: alias si/no/yes/x/true/0, default su valori sconosciuti
 *   - clampInt: parsing + clamp a min, fallback default
 *   - pickEnum: valori validi vs fallback su default
 *   - HEADER_MAP: alias IT/EN/varianti accentate
 *   - errors per riga: edificio mancante, aula senza piano
 *   - idempotenza: ri-import = update + counters (created/updated)
 *   - merge floors su edificio esistente
 *   - update campi vuoti (building.code/address, room.code/floor)
 *   - equipment: brand/model/quantity update solo se quantità cambia o
 *     campo vuoto si popola
 *   - riga senza aula → ignorata (può servire solo a definire l'edificio)
 */

const { Building, Room, Equipment, Institute } = require('../../models');
const {
  importStructure,
  parseCSV,
  rowsToObjects,
  ROOM_TYPES,
  EQUIPMENT_TYPES,
} = require('../../services/structureImporter');

async function createInstitute() {
  return Institute.create({ name: 'Conservatorio Test' });
}

describe('services/structureImporter — parseCSV (pure)', () => {
  it('virgola come delimitatore di default', () => {
    const rows = parseCSV('a,b\n1,2');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('auto-detect punto e virgola quando prevale', () => {
    const rows = parseCSV('a;b;c\n1;2;3');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('auto-detect tab quando prevale', () => {
    const rows = parseCSV('a\tb\tc\n1\t2\t3');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('strip BOM iniziale (UTF-8)', () => {
    const rows = parseCSV('﻿a,b\n1,2');
    expect(rows[0]).toEqual(['a', 'b']);
  });

  it('virgolette doppie ("") come escape', () => {
    const rows = parseCSV('a,b\n"con ""virgolette""","x"');
    expect(rows[1][0]).toBe('con "virgolette"');
  });

  it('campi quotati possono contenere newline (multilinea)', () => {
    const rows = parseCSV('a,b\n"riga1\nriga2","x"');
    expect(rows[1][0]).toBe('riga1\nriga2');
  });

  it('CR vengono ignorati (CRLF)', () => {
    const rows = parseCSV('a,b\r\n1,2');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('righe completamente vuote vengono saltate', () => {
    const rows = parseCSV('a,b\n\n1,2\n\n');
    expect(rows.length).toBe(2);
  });

  it('CSV vuoto/null → []', () => {
    expect(parseCSV('')).toEqual([]);
    expect(parseCSV(null)).toEqual([]);
  });
});

describe('services/structureImporter — rowsToObjects', () => {
  it('matrice vuota → headers/data vuoti', () => {
    expect(rowsToObjects([])).toEqual({ headers: [], data: [] });
  });

  it('mappa header (anche accentati) sui campi canonici', () => {
    const out = rowsToObjects([
      ['Edificio', 'Capacità', 'Tipo Aula'],
      ['Palazzo A', '20', 'studio'],
    ]);
    expect(out.data[0].building).toBe('Palazzo A');
    expect(out.data[0].capacity).toBe('20');
    expect(out.data[0].roomType).toBe('studio');
    expect(out.data[0]._line).toBe(2);
  });

  it('header sconosciuti vengono passati come chiave grezza', () => {
    const out = rowsToObjects([
      ['edificio', 'pippo'],
      ['A', 'val'],
    ]);
    expect(out.data[0].pippo).toBe('val');
  });

  it('celle vuote non vengono incluse nel record', () => {
    const out = rowsToObjects([
      ['edificio', 'piano'],
      ['A', ''],
    ]);
    expect(out.data[0]).not.toHaveProperty('floor');
  });

  it('ROOM_TYPES e EQUIPMENT_TYPES sono enum non vuoti', () => {
    expect(ROOM_TYPES.length).toBeGreaterThan(0);
    expect(EQUIPMENT_TYPES.length).toBeGreaterThan(0);
    expect(ROOM_TYPES).toContain('studio');
    expect(EQUIPMENT_TYPES).toContain('pianoforte');
  });
});

describe('services/structureImporter — importStructure validazione', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('throw 400 se instituteId mancante', async () => {
    await expect(importStructure({ csv: 'a,b\n1,2' })).rejects.toMatchObject({
      status: 400,
      message: /instituteId/i,
    });
  });

  it('throw 400 se csv vuoto/whitespace', async () => {
    const inst = await createInstitute();
    await expect(importStructure({ instituteId: inst.id, csv: '' })).rejects.toMatchObject({
      status: 400,
      message: /vuoto/i,
    });
    await expect(importStructure({ instituteId: inst.id, csv: '   \n  ' })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('throw 404 se Institute non esiste', async () => {
    await expect(
      importStructure({ instituteId: 999999, csv: 'edificio,aula,piano\nA,Aula1,T' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('throw 400 se CSV ha solo header (nessuna riga dati)', async () => {
    const inst = await createInstitute();
    await expect(
      importStructure({ instituteId: inst.id, csv: 'edificio,aula,piano\n' }),
    ).rejects.toMatchObject({ status: 400, message: /almeno una riga/i });
  });
});

describe('services/structureImporter — importStructure path nominale', () => {
  let institute;
  beforeEach(async () => {
    await globalThis.resetDatabase();
    institute = await createInstitute();
  });

  it('crea building+room+equipment minimi con header italiani', async () => {
    const csv = [
      'edificio;aula;piano;capienza;tipo aula;attrezzatura;tipo attrezzatura',
      'Palazzo A;Aula 1;Piano Terra;30;studio;Piano Yamaha;pianoforte',
    ].join('\n');

    const out = await importStructure({ instituteId: institute.id, csv });

    expect(out.parsed).toBe(1);
    expect(out.buildings).toEqual({ created: 1, updated: 0 });
    expect(out.rooms).toEqual({ created: 1, updated: 0 });
    expect(out.equipment).toEqual({ created: 1, updated: 0 });
    expect(out.skipped).toBe(0);
    expect(out.errors).toEqual([]);

    const b = await Building.findOne({ where: { instituteId: institute.id, name: 'Palazzo A' } });
    expect(b).not.toBeNull();
    expect(b.floors).toContain('Piano Terra');

    const r = await Room.findOne({ where: { buildingId: b.id, name: 'Aula 1' } });
    expect(r.capacity).toBe(30);
    expect(r.type).toBe('studio');
    expect(r.isBookable).toBe(true);
    expect(r.floor).toBe('Piano Terra');

    const eq = await Equipment.findOne({ where: { roomId: r.id, name: 'Piano Yamaha' } });
    expect(eq.type).toBe('pianoforte');
    expect(eq.quantity).toBe(1);
  });

  it('header inglesi e codice edificio/aula vengono salvati', async () => {
    const csv = [
      'building,building code,address,floor,room,room code,capacity,room type,bookable',
      'Main,M1,Via Roma 1,1,Studio A,SA01,15,studio,si',
    ].join('\n');

    await importStructure({ instituteId: institute.id, csv });

    const b = await Building.findOne({ where: { name: 'Main' } });
    expect(b.code).toBe('M1');
    expect(b.address).toBe('Via Roma 1');

    const r = await Room.findOne({ where: { name: 'Studio A' } });
    expect(r.code).toBe('SA01');
    expect(r.floor).toBe('1');
  });

  it('parseBool: prenotabile=no → isBookable=false', async () => {
    const csv = 'edificio,aula,piano,prenotabile\nA,Aula NB,T,no';
    await importStructure({ instituteId: institute.id, csv });
    const r = await Room.findOne({ where: { name: 'Aula NB' } });
    expect(r.isBookable).toBe(false);
  });

  it('parseBool: valore sconosciuto → default true', async () => {
    const csv = 'edificio,aula,piano,prenotabile\nA,Aula MB,T,forse';
    await importStructure({ instituteId: institute.id, csv });
    const r = await Room.findOne({ where: { name: 'Aula MB' } });
    expect(r.isBookable).toBe(true);
  });

  it('pickEnum: tipo aula non valido → fallback "studio"', async () => {
    const csv = 'edificio,aula,piano,tipo aula\nA,Aula X,T,inventato';
    await importStructure({ instituteId: institute.id, csv });
    const r = await Room.findOne({ where: { name: 'Aula X' } });
    expect(r.type).toBe('studio');
  });

  it('clampInt: capacity non valida → default 1; negativi → 1', async () => {
    const csv = 'edificio,aula,piano,capienza\nA,A1,T,abc\nA,A2,T,-5\nA,A3,T,12';
    await importStructure({ instituteId: institute.id, csv });
    const r1 = await Room.findOne({ where: { name: 'A1' } });
    const r2 = await Room.findOne({ where: { name: 'A2' } });
    const r3 = await Room.findOne({ where: { name: 'A3' } });
    expect(r1.capacity).toBe(1);
    expect(r2.capacity).toBe(1);
    expect(r3.capacity).toBe(12);
  });

  it('merge floors su edificio multi-piano + raggruppamento aule', async () => {
    const csv = [
      'edificio,aula,piano',
      'Palazzo,A1,Piano Terra',
      'Palazzo,A2,Primo Piano',
      'Palazzo,A3,Secondo Piano',
    ].join('\n');

    const out = await importStructure({ instituteId: institute.id, csv });
    expect(out.buildings.created).toBe(1);
    expect(out.rooms.created).toBe(3);

    const b = await Building.findOne({ where: { name: 'Palazzo' } });
    expect(b.floors).toEqual(
      expect.arrayContaining(['Piano Terra', 'Primo Piano', 'Secondo Piano']),
    );
  });

  it('equipment multipli sulla stessa aula (righe diverse)', async () => {
    const csv = [
      'edificio;aula;piano;attrezzatura;tipo attrezzatura;quantita',
      'P;A1;T;Piano;pianoforte;1',
      'P;A1;T;Leggio;leggio;3',
    ].join('\n');

    const out = await importStructure({ instituteId: institute.id, csv });
    expect(out.equipment.created).toBe(2);
    expect(out.rooms.created).toBe(1); // stessa aula

    const r = await Room.findOne({ where: { name: 'A1' } });
    const eqs = await Equipment.findAll({ where: { roomId: r.id } });
    expect(eqs.map((e) => e.name).sort()).toEqual(['Leggio', 'Piano']);
    const leggio = eqs.find((e) => e.name === 'Leggio');
    expect(leggio.quantity).toBe(3);
  });
});

describe('services/structureImporter — importStructure errori per riga', () => {
  let institute;
  beforeEach(async () => {
    await globalThis.resetDatabase();
    institute = await createInstitute();
  });

  it('riga senza colonna edificio: skipped + error con numero riga', async () => {
    const csv = 'edificio,aula,piano\n,A1,T\nP,A2,T';
    const out = await importStructure({ instituteId: institute.id, csv });
    expect(out.skipped).toBe(1);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toMatchObject({ line: 2, msg: /edificio/i });
    expect(out.buildings.created).toBe(1);
    expect(out.rooms.created).toBe(1);
  });

  it('aula senza piano: skipped + error', async () => {
    const csv = 'edificio,aula,piano\nP,A1,\nP,A2,T';
    const out = await importStructure({ instituteId: institute.id, csv });
    expect(out.skipped).toBe(1);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toMatchObject({ line: 2, msg: /piano/i });
    expect(out.rooms.created).toBe(1);
  });

  it('riga con solo edificio (no aula) viene ignorata silenziosamente', async () => {
    const csv = 'edificio,aula,piano\nSoloEdificio,,\nSoloEdificio,A1,T';
    const out = await importStructure({ instituteId: institute.id, csv });
    expect(out.errors).toEqual([]);
    expect(out.skipped).toBe(0);
    expect(out.buildings.created).toBe(1);
    expect(out.rooms.created).toBe(1);
  });
});

describe('services/structureImporter — idempotenza', () => {
  let institute;
  beforeEach(async () => {
    await globalThis.resetDatabase();
    institute = await createInstitute();
  });

  it("ri-import identico: 0 created, eventuali updated solo dove c'è cambio", async () => {
    const csv = [
      'edificio,codice edificio,indirizzo,aula,codice aula,piano,capienza,tipo aula',
      'Palazzo,P1,Via Verdi,A1,A001,T,20,studio',
    ].join('\n');

    const first = await importStructure({ instituteId: institute.id, csv });
    expect(first.buildings.created).toBe(1);
    expect(first.rooms.created).toBe(1);

    const second = await importStructure({ instituteId: institute.id, csv });
    expect(second.buildings.created).toBe(0);
    expect(second.rooms.created).toBe(0);
    expect(second.buildings.updated).toBe(0);
    expect(second.rooms.updated).toBe(0);
  });

  it('seconda import popola code/address vuoti su building esistente', async () => {
    // Prima import senza code/address
    await importStructure({
      instituteId: institute.id,
      csv: 'edificio,aula,piano\nPalazzo,A1,T',
    });

    // Seconda con codice + indirizzo
    const out = await importStructure({
      instituteId: institute.id,
      csv: 'edificio,codice edificio,indirizzo,aula,piano\nPalazzo,P1,Via Verdi,A1,T',
    });
    expect(out.buildings.updated).toBe(1);

    const b = await Building.findOne({ where: { name: 'Palazzo' } });
    expect(b.code).toBe('P1');
    expect(b.address).toBe('Via Verdi');
  });

  it('seconda import popola code vuoto su room esistente', async () => {
    await importStructure({
      instituteId: institute.id,
      csv: 'edificio,aula,piano\nPalazzo,A1,T',
    });
    const out = await importStructure({
      instituteId: institute.id,
      csv: 'edificio,aula,codice aula,piano\nPalazzo,A1,A001,T',
    });
    expect(out.rooms.updated).toBe(1);
    const r = await Room.findOne({ where: { name: 'A1' } });
    expect(r.code).toBe('A001');
  });

  it('seconda import: cambia floor di aula esistente → update', async () => {
    await importStructure({
      instituteId: institute.id,
      csv: 'edificio,aula,piano\nPalazzo,A1,T',
    });
    const out = await importStructure({
      instituteId: institute.id,
      csv: 'edificio,aula,piano\nPalazzo,A1,Primo Piano',
    });
    expect(out.rooms.updated).toBe(1);
    const r = await Room.findOne({ where: { name: 'A1' } });
    expect(r.floor).toBe('Primo Piano');
  });

  it('equipment: aumento quantità → updated', async () => {
    const base = 'edificio;aula;piano;attrezzatura;quantita\nP;A1;T;Leggio;2';
    await importStructure({ instituteId: institute.id, csv: base });

    const out = await importStructure({
      instituteId: institute.id,
      csv: 'edificio;aula;piano;attrezzatura;quantita\nP;A1;T;Leggio;5',
    });
    expect(out.equipment.updated).toBe(1);
    const eq = await Equipment.findOne({ where: { name: 'Leggio' } });
    expect(eq.quantity).toBe(5);
  });

  it('equipment: popola brand/model vuoti su esistente', async () => {
    await importStructure({
      instituteId: institute.id,
      csv: 'edificio;aula;piano;attrezzatura\nP;A1;T;Piano',
    });
    const out = await importStructure({
      instituteId: institute.id,
      csv: 'edificio;aula;piano;attrezzatura;marca;modello\nP;A1;T;Piano;Yamaha;U1',
    });
    expect(out.equipment.updated).toBe(1);
    const eq = await Equipment.findOne({ where: { name: 'Piano' } });
    expect(eq.brand).toBe('Yamaha');
    expect(eq.model).toBe('U1');
  });
});

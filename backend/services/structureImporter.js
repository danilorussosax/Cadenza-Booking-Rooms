'use strict';

const { sequelize, Building, Room, Equipment, Institute } = require('../models');

// Tipi consentiti dai modelli (devono restare allineati agli ENUM)
const ROOM_TYPES = ['studio', 'sala_prove', 'aula_concerti', 'classe', 'aula_didattica', 'altro'];
const EQUIPMENT_TYPES = [
  'pianoforte',
  'pianoforte_a_coda',
  'organo',
  'clavicembalo',
  'leggio',
  'amplificatore',
  'mixer',
  'microfono',
  'computer',
  'proiettore',
  'lavagna',
  'sedia',
  'altro',
];

// Mappa header → campo canonico (case-insensitive, accenti tollerati)
const HEADER_MAP = {
  edificio: 'building',
  'nome edificio': 'building',
  nome_edificio: 'building',
  building: 'building',

  'codice edificio': 'buildingCode',
  codice_edificio: 'buildingCode',
  'building code': 'buildingCode',

  indirizzo: 'buildingAddress',
  'indirizzo edificio': 'buildingAddress',
  indirizzo_edificio: 'buildingAddress',
  address: 'buildingAddress',

  piano: 'floor',
  floor: 'floor',

  aula: 'room',
  'nome aula': 'room',
  nome_aula: 'room',
  room: 'room',

  'codice aula': 'roomCode',
  codice_aula: 'roomCode',
  'room code': 'roomCode',

  capienza: 'capacity',
  capacita: 'capacity',
  capacità: 'capacity',
  capacity: 'capacity',

  'tipo aula': 'roomType',
  tipo_aula: 'roomType',
  tipo: 'roomType',
  'room type': 'roomType',

  prenotabile: 'bookable',
  bookable: 'bookable',

  attrezzatura: 'equipment',
  'nome attrezzatura': 'equipment',
  nome_attrezzatura: 'equipment',
  equipment: 'equipment',

  'tipo attrezzatura': 'equipmentType',
  tipo_attrezzatura: 'equipmentType',
  'equipment type': 'equipmentType',

  marca: 'equipmentBrand',
  brand: 'equipmentBrand',
  modello: 'equipmentModel',
  model: 'equipmentModel',

  quantita: 'equipmentQuantity',
  quantità: 'equipmentQuantity',
  qty: 'equipmentQuantity',
  quantity: 'equipmentQuantity',
};

/**
 * Parser CSV minimale: gestisce delimitatore (,/;), virgolette, escape, multilinea.
 * Auto-detect del delimitatore sulla prima riga (prevale ; se più frequente).
 */
function parseCSV(text) {
  if (!text) return [];
  // Strip BOM se presente
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  // Auto-detect delimitatore
  const head = text.split(/\r?\n/)[0] || '';
  const semi = (head.match(/;/g) || []).length;
  const comma = (head.match(/,/g) || []).length;
  const tab = (head.match(/\t/g) || []).length;
  let delim = ',';
  if (semi >= comma && semi >= tab) delim = ';';
  else if (tab > comma) delim = '\t';

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === delim) {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        field = '';
        if (row.some((f) => f.trim() !== '')) rows.push(row);
        row = [];
      } else if (c === '\r') {
        /* skip */
      } else field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some((f) => f.trim() !== '')) rows.push(row);
  }
  return rows;
}

function normalizeHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase();
}

function rowsToObjects(matrix) {
  if (matrix.length === 0) return { headers: [], data: [] };
  const headers = matrix[0].map(normalizeHeader);
  const data = matrix.slice(1).map((cells, idx) => {
    const obj = { _line: idx + 2 }; // line number nel CSV originale (1=header)
    headers.forEach((h, i) => {
      const key = HEADER_MAP[h] || h;
      const val = (cells[i] || '').trim();
      if (val !== '') obj[key] = val;
    });
    return obj;
  });
  return { headers, data };
}

function parseBool(v, def = true) {
  if (v == null || v === '') return def;
  const s = String(v).trim().toLowerCase();
  if (['no', 'false', '0', 'n', 'off'].includes(s)) return false;
  if (['si', 'sì', 'yes', 'true', '1', 'y', 'on', 'x'].includes(s)) return true;
  return def;
}

function clampInt(v, def, min = 1) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= min ? n : def;
}

function pickEnum(v, allowed, def) {
  if (!v) return def;
  const s = String(v).trim().toLowerCase();
  return allowed.includes(s) ? s : def;
}

/**
 * Importa la struttura nel DB.
 * Comportamento idempotente: chiavi di matching (instituteId+nome) per upsert.
 *
 * @returns {{
 *   parsed: number,
 *   buildings: { created: number, updated: number },
 *   rooms: { created: number, updated: number },
 *   equipment: { created: number, updated: number },
 *   skipped: number,
 *   errors: Array<{ line: number, msg: string }>
 * }}
 */
async function importStructure({ instituteId, csv }) {
  if (!instituteId) throw Object.assign(new Error('instituteId obbligatorio'), { status: 400 });
  if (!csv || !csv.trim()) throw Object.assign(new Error('CSV vuoto'), { status: 400 });

  const institute = await Institute.findByPk(instituteId);
  if (!institute) throw Object.assign(new Error('Istituto non trovato'), { status: 404 });

  const matrix = parseCSV(csv);
  if (matrix.length < 2) {
    throw Object.assign(new Error("CSV deve contenere almeno una riga oltre all'intestazione"), {
      status: 400,
    });
  }
  const { data: rows } = rowsToObjects(matrix);

  const summary = {
    parsed: rows.length,
    buildings: { created: 0, updated: 0 },
    rooms: { created: 0, updated: 0 },
    equipment: { created: 0, updated: 0 },
    skipped: 0,
    errors: [],
  };

  // Raggruppa per edificio (case-insensitive sul nome ma preserva il primo casing visto)
  const buildingGroups = new Map();
  for (const r of rows) {
    if (!r.building) {
      summary.errors.push({ line: r._line, msg: 'colonna "edificio" mancante' });
      summary.skipped++;
      continue;
    }
    const key = r.building.toLowerCase();
    if (!buildingGroups.has(key)) buildingGroups.set(key, { name: r.building, rows: [] });
    buildingGroups.get(key).rows.push(r);
  }

  await sequelize.transaction(async (t) => {
    for (const { name: buildingName, rows: bRows } of buildingGroups.values()) {
      const first = bRows[0];

      const [building, created] = await Building.findOrCreate({
        where: { instituteId, name: buildingName },
        defaults: {
          instituteId,
          name: buildingName,
          code: first.buildingCode || null,
          address: first.buildingAddress || null,
          floors: [],
        },
        transaction: t,
      });
      if (created) summary.buildings.created++;

      // Aggiorna metadati edificio se vuoti e disponibili nel CSV
      const updates = {};
      if (!building.code && first.buildingCode) updates.code = first.buildingCode;
      if (!building.address && first.buildingAddress) updates.address = first.buildingAddress;

      // Merge piani: tutti i piani citati dalle righe di questo edificio
      const csvFloors = bRows.map((r) => r.floor).filter(Boolean);
      const merged = Array.from(new Set([...(building.floors || []), ...csvFloors]));
      if (merged.length !== (building.floors || []).length) updates.floors = merged;

      if (Object.keys(updates).length > 0) {
        await building.update(updates, { transaction: t });
        if (!created) summary.buildings.updated++;
      }

      // Raggruppa righe per aula
      const roomGroups = new Map();
      for (const r of bRows) {
        if (!r.room) {
          // Riga senza aula → ignorata (può essere solo per definire un edificio)
          continue;
        }
        if (!r.floor) {
          summary.errors.push({
            line: r._line,
            msg: `aula "${r.room}" senza piano: salto la riga`,
          });
          summary.skipped++;
          continue;
        }
        const key = r.room.toLowerCase();
        if (!roomGroups.has(key))
          roomGroups.set(key, { name: r.room, first: r, equipmentRows: [] });
        if (r.equipment) roomGroups.get(key).equipmentRows.push(r);
      }

      for (const { name: roomName, first: r, equipmentRows } of roomGroups.values()) {
        const [room, roomCreated] = await Room.findOrCreate({
          where: { buildingId: building.id, name: roomName },
          defaults: {
            buildingId: building.id,
            name: roomName,
            code: r.roomCode || null,
            floor: r.floor,
            capacity: clampInt(r.capacity, 1),
            type: pickEnum(r.roomType, ROOM_TYPES, 'studio'),
            isBookable: parseBool(r.bookable, true),
          },
          transaction: t,
        });
        if (roomCreated) summary.rooms.created++;

        // Aggiorna campi vuoti dell'aula esistente con dati dal CSV
        if (!roomCreated) {
          const upd = {};
          if (!room.code && r.roomCode) upd.code = r.roomCode;
          // floor sovrascritto solo se diverso e CSV lo specifica
          if (r.floor && room.floor !== r.floor) upd.floor = r.floor;
          if (Object.keys(upd).length > 0) {
            await room.update(upd, { transaction: t });
            summary.rooms.updated++;
          }
        }

        // Equipment per questa aula
        for (const er of equipmentRows) {
          const [equip, eqCreated] = await Equipment.findOrCreate({
            where: { roomId: room.id, name: er.equipment },
            defaults: {
              roomId: room.id,
              name: er.equipment,
              type: pickEnum(er.equipmentType, EQUIPMENT_TYPES, 'altro'),
              brand: er.equipmentBrand || null,
              model: er.equipmentModel || null,
              quantity: clampInt(er.equipmentQuantity, 1),
            },
            transaction: t,
          });
          if (eqCreated) summary.equipment.created++;
          else {
            const eqUpd = {};
            if (!equip.brand && er.equipmentBrand) eqUpd.brand = er.equipmentBrand;
            if (!equip.model && er.equipmentModel) eqUpd.model = er.equipmentModel;
            const newQty = clampInt(er.equipmentQuantity, equip.quantity);
            if (newQty !== equip.quantity) eqUpd.quantity = newQty;
            if (Object.keys(eqUpd).length > 0) {
              await equip.update(eqUpd, { transaction: t });
              summary.equipment.updated++;
            }
          }
        }
      }
    }
  });

  return summary;
}

module.exports = { importStructure, parseCSV, rowsToObjects, ROOM_TYPES, EQUIPMENT_TYPES };

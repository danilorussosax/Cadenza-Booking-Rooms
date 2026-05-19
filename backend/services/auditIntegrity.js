'use strict';

/**
 * Verifica l'integrità della hash-chain di `audit_log`.
 *
 * Itera la tabella in ordine `(createdAt ASC, id ASC)` e ricalcola lo
 * `rowHash` di ogni riga. Qualsiasi divergenza dal valore persistito
 * (o nel link al `prevHash`) viene riportata come issue.
 *
 * Categorizzazione issue:
 *   - `legacy`     : riga senza rowHash (pre-migration) — informativa
 *   - `hash_mismatch`: rowHash ricalcolato ≠ rowHash persistito → tampering
 *                     della riga stessa (campi modificati after the fact)
 *   - `chain_gap`  : prevHash della riga ≠ rowHash della precedente →
 *                    riga cancellata, riordinata o inserita fuori tx
 *
 * Limite di scansione: opzionale `limit` per non scandire l'intera tabella
 * su istanze con milioni di righe (di default scandiamo tutto, è chiamato
 * solo manualmente o dallo scheduler settimanale notturno).
 */

const PAGE = 500;

async function verifyAuditIntegrity({ AuditLog }, { limit } = {}) {
  const issues = [];
  let scanned = 0;
  let prevHash = null;
  let prevIsLegacy = true;

  for (let offset = 0; ; offset += PAGE) {
    const rows = await AuditLog.findAll({
      order: [
        ['createdAt', 'ASC'],
        ['id', 'ASC'],
      ],
      limit: PAGE,
      offset,
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned++;
      const persisted = row.rowHash;

      if (!persisted) {
        issues.push({
          type: 'legacy',
          id: row.id,
          createdAt: row.createdAt,
          message: 'Riga pre-migration: nessun rowHash persistito',
        });
        prevHash = null;
        prevIsLegacy = true;
        if (limit && scanned >= limit) return summarize(issues, scanned);
        continue;
      }

      // Hash della riga: ricalcola sui campi attuali.
      const expected = AuditLog.computeRowHash(row.toJSON(), row.prevHash || null);
      if (expected !== persisted) {
        issues.push({
          type: 'hash_mismatch',
          id: row.id,
          createdAt: row.createdAt,
          expected,
          got: persisted,
          message: 'rowHash ricalcolato non corrisponde — campi modificati dopo l’insert',
        });
      }

      // Chain link: prevHash della riga deve essere il rowHash della
      // riga precedente. Non controlliamo la chain quando la precedente
      // è legacy (non ha hash da confrontare).
      if (!prevIsLegacy && row.prevHash !== prevHash) {
        issues.push({
          type: 'chain_gap',
          id: row.id,
          createdAt: row.createdAt,
          expectedPrev: prevHash,
          gotPrev: row.prevHash,
          message: 'prevHash non punta alla riga precedente — possibile cancellazione/riordino',
        });
      }

      prevHash = row.rowHash;
      prevIsLegacy = false;

      if (limit && scanned >= limit) return summarize(issues, scanned);
    }
    if (rows.length < PAGE) break;
  }

  return summarize(issues, scanned);
}

function summarize(issues, scanned) {
  const tampering = issues.filter((i) => i.type !== 'legacy');
  return {
    ok: tampering.length === 0,
    scanned,
    issuesCount: issues.length,
    tamperingCount: tampering.length,
    issues: issues.slice(0, 100), // cap nella response, dettagli completi in log
  };
}

module.exports = { verifyAuditIntegrity };

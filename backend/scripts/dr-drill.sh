#!/usr/bin/env bash
# Cadenza — Disaster Recovery drill (NON-DISTRUTTIVO).
#
# Esegue un restore del backup specificato (o dell'ultimo disponibile) in un
# database sandbox separato (`cadenza_dr_sandbox`), valida schema + FK
# integrity, e droppa il sandbox al termine. Mai tocca il DB di produzione.
#
# Usage:
#   bash backend/scripts/dr-drill.sh                   # ultimo backup
#   bash backend/scripts/dr-drill.sh path/to/backup.tar.gz
#   bash backend/scripts/dr-drill.sh --keep-sandbox    # non droppa al termine (debug)
#
# Env (override):
#   PSQL_BIN          (default: /Library/PostgreSQL/18/bin/psql se esiste, altrimenti psql)
#   PG_HOST           (default: localhost)
#   PG_PORT           (default: 5432)
#   PG_USER           (default: postgres)
#   PG_PASSWORD       (default: letto da .env, fallback prompt)
#   SANDBOX_DB        (default: cadenza_dr_sandbox)
#
# Vedi docs/DISASTER_RECOVERY.md §7 per la procedura e i target RTO.

set -euo pipefail

# ── Config
PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_ROOT/backups}"

if [[ -z "${PSQL_BIN:-}" ]]; then
  if [[ -x "/Library/PostgreSQL/18/bin/psql" ]]; then
    PSQL_BIN="/Library/PostgreSQL/18/bin/psql"
  else
    PSQL_BIN="psql"
  fi
fi

PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-postgres}"
SANDBOX_DB="${SANDBOX_DB:-cadenza_dr_sandbox}"

# Carica DB_PASSWORD dal .env del backend se non è esplicito
if [[ -z "${PG_PASSWORD:-}" && -f "$PROJECT_ROOT/backend/.env" ]]; then
  PG_PASSWORD=$(grep -E '^DB_PASSWORD=' "$PROJECT_ROOT/backend/.env" | head -1 | cut -d= -f2-)
fi

KEEP_SANDBOX=0
ARCHIVE=""
for arg in "$@"; do
  case "$arg" in
    --keep-sandbox) KEEP_SANDBOX=1 ;;
    -h|--help)
      head -n 22 "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *.tar.gz) ARCHIVE="$arg" ;;
  esac
done

if [[ -z "$ARCHIVE" ]]; then
  ARCHIVE=$(ls -t "$BACKUP_DIR"/backup-*.tar.gz 2>/dev/null | head -1 || true)
fi

if [[ -z "$ARCHIVE" || ! -f "$ARCHIVE" ]]; then
  echo "ERROR: archivio non trovato. Specificalo come arg o crea un backup." >&2
  exit 1
fi

ARCHIVE=$(cd "$(dirname "$ARCHIVE")" && pwd)/$(basename "$ARCHIVE")
SIZE_KB=$(($(stat -f%z "$ARCHIVE" 2>/dev/null || stat -c%s "$ARCHIVE") / 1024))

echo "=========================================================="
echo "Cadenza — Disaster Recovery Drill"
echo "=========================================================="
echo "Archivio:    $ARCHIVE (${SIZE_KB} KB)"
echo "Sandbox DB:  $SANDBOX_DB on $PG_HOST:$PG_PORT (user $PG_USER)"
echo "psql:        $PSQL_BIN"
echo

run_psql() {
  PGPASSWORD="$PG_PASSWORD" "$PSQL_BIN" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" "$@"
}

now() { python3 -c "import time;print(time.time())"; }
diff_s() { python3 -c "print(f'{$2-$1:.2f}')"; }

# ── Pre-check: sandbox non deve esistere già
if run_psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$SANDBOX_DB'" | grep -q 1; then
  echo "ERROR: il database '$SANDBOX_DB' esiste già. Droppalo prima:" >&2
  echo "  PGPASSWORD=... $PSQL_BIN -h $PG_HOST -U $PG_USER -d postgres -c \"DROP DATABASE $SANDBOX_DB;\"" >&2
  exit 1
fi

STAGING=$(mktemp -d -t cadenza-dr-drill-XXXX)
trap 'rm -rf "$STAGING"; if [[ $KEEP_SANDBOX -eq 0 ]]; then run_psql -d postgres -q -c "DROP DATABASE IF EXISTS $SANDBOX_DB;" 2>/dev/null || true; fi' EXIT

# ── PHASE 1: extract
T0=$(now)
tar -xzf "$ARCHIVE" -C "$STAGING"
T1=$(now)
P1=$(diff_s $T0 $T1)
echo "PHASE 1 (extract):       ${P1}s"

if [[ ! -f "$STAGING/database.sql" ]]; then
  echo "ERROR: archivio non contiene database.sql (è un backup SQLite? Questo drill è solo Postgres)" >&2
  exit 1
fi

cat "$STAGING/manifest.json" 2>/dev/null | head -20 || true
echo

# ── PHASE 2: create sandbox DB (encoding/locale C, compatibile con dump prod)
T0=$(now)
run_psql -d postgres -v ON_ERROR_STOP=1 -q -c \
  "CREATE DATABASE $SANDBOX_DB WITH ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;"
T1=$(now)
P2=$(diff_s $T0 $T1)
echo "PHASE 2 (createdb):      ${P2}s"

# ── PHASE 3: restore
T0=$(now)
run_psql -d "$SANDBOX_DB" -v ON_ERROR_STOP=1 -q -f "$STAGING/database.sql" >/dev/null 2>&1
T1=$(now)
P3=$(diff_s $T0 $T1)
echo "PHASE 3 (psql restore):  ${P3}s"

# ── PHASE 4: validate
T0=$(now)
echo "  --- Conteggi tabelle critiche ---"
run_psql -d "$SANDBOX_DB" -At -c "
SELECT '  tables=' || count(*) FROM information_schema.tables WHERE table_schema='public';
SELECT '  indexes=' || count(*) FROM pg_indexes WHERE schemaname='public';
SELECT '  fk_constraints=' || count(*) FROM information_schema.table_constraints WHERE constraint_schema='public' AND constraint_type='FOREIGN KEY';
SELECT '  check_constraints=' || count(*) FROM information_schema.table_constraints WHERE constraint_schema='public' AND constraint_type='CHECK';
SELECT '  users=' || count(*) FROM users;
SELECT '  institutes=' || count(*) FROM institutes;
SELECT '  rooms=' || count(*) FROM rooms;
SELECT '  bookings=' || count(*) FROM bookings;
SELECT '  audit_log=' || count(*) FROM audit_log;
"
T1=$(now)
P4=$(diff_s $T0 $T1)
echo "PHASE 4 (validate):      ${P4}s"

# ── PHASE 5: FK integrity
T0=$(now)
FK_OUT=$(run_psql -d "$SANDBOX_DB" -v ON_ERROR_STOP=1 -q -c "
DO \$\$
DECLARE r RECORD; bad_rows BIGINT; tot INT := 0; bad INT := 0;
BEGIN
  FOR r IN
    SELECT tc.table_name, kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name
    WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I a WHERE a.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.%I b WHERE b.%I=a.%I)',
      r.table_name, r.column_name, r.ref_table, r.ref_column, r.column_name) INTO bad_rows;
    tot := tot + 1;
    IF bad_rows > 0 THEN
      bad := bad + 1;
      RAISE WARNING 'FK violation: %.% -> %.% (% orphans)', r.table_name, r.column_name, r.ref_table, r.ref_column, bad_rows;
    END IF;
  END LOOP;
  RAISE NOTICE 'FK summary: % checked, % violated', tot, bad;
END \$\$;
" 2>&1 | grep -E 'NOTICE|WARNING')
echo "$FK_OUT" | sed 's/^/  /'
T1=$(now)
P5=$(diff_s $T0 $T1)
echo "PHASE 5 (fk integrity):  ${P5}s"

# ── PHASE 6: anti-overlap EXCLUDE constraint preserved?
EXCL=$(run_psql -d "$SANDBOX_DB" -At -c "SELECT conname FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.contype='x' AND t.relname='bookings';")
if [[ -n "$EXCL" ]]; then
  echo "  ✓ EXCLUDE constraint preservato: $EXCL"
else
  echo "  ⚠ EXCLUDE constraint anti-overlap NON trovato — il dump non lo include?"
fi

TOT=$(python3 -c "print(f'{${P1}+${P2}+${P3}+${P4}+${P5}:.2f}')")
echo
echo "=========================================================="
echo "RTO totale (extract+createdb+restore+validate+fk): ${TOT}s"
echo "=========================================================="
echo

# Determina esito
if echo "$FK_OUT" | grep -q "0 violated"; then
  echo "✅ DRILL PASS — backup è restorable e self-consistent"
  RC=0
else
  echo "❌ DRILL FAIL — vedi WARNING sopra (FK violations rilevate)"
  RC=1
fi

if [[ $KEEP_SANDBOX -eq 1 ]]; then
  echo
  echo "Sandbox DB '$SANDBOX_DB' lasciato in piedi per ispezione (--keep-sandbox)."
  echo "Per droppare manualmente:"
  echo "  PGPASSWORD=... $PSQL_BIN -h $PG_HOST -U $PG_USER -d postgres -c \"DROP DATABASE $SANDBOX_DB;\""
  trap 'rm -rf "$STAGING"' EXIT
fi

exit $RC

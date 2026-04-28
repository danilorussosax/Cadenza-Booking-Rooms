#!/bin/bash
# Read-only: conta righe nei snapshot SQLite (data/conservatory.sqlite*)
set -u
DATA_DIR="$(cd "$(dirname "$0")/.." && pwd)/data"

TABLES="users institutes buildings rooms courses bookings instruments instrument_loans monte_ore_proposals monte_ore_schedules audit_log"

printf "%-50s %-10s %-10s %-7s" "file" "mtime" "size" "tot"
for t in $TABLES; do
  printf " %-9s" "${t:0:9}"
done
echo

for f in "$DATA_DIR"/conservatory.sqlite*; do
  [ -f "$f" ] || continue
  name=$(basename "$f")
  mtime=$(stat -f "%Sm" -t "%H:%M:%S" "$f")
  size=$(stat -f "%z" "$f")
  total=0
  declare -a cnts=()
  for t in $TABLES; do
    c=$(sqlite3 "$f" "SELECT count(*) FROM $t" 2>/dev/null)
    [ -z "$c" ] && c="-"
    [ "$c" != "-" ] && total=$((total + c))
    cnts+=("$c")
  done
  printf "%-50s %-10s %-10s %-7s" "${name: -50}" "$mtime" "$size" "$total"
  for c in "${cnts[@]}"; do printf " %-9s" "$c"; done
  echo
done

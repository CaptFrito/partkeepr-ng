#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# migrate-from-upstream.sh — apply the additive schema migrations that
# turn an existing PartKeepr 1.4.0 database into a partkeepr-ng database.
#
# Run order matters; this script enforces it. Each migration is applied
# in its own mysql invocation so a failure shows you exactly which file
# went wrong.
#
# Usage:
#   ./scripts/migrate-from-upstream.sh -h HOST -u USER -p PASS -d DBNAME
#
# Options:
#   -h HOST   MySQL/MariaDB host (default: localhost)
#   -P PORT   port (default: 3306)
#   -u USER   DB user
#   -p PASS   DB password (omit to be prompted)
#   -d DB     target database name
#   -n        dry-run: print what would run, don't apply
#   -y        skip the "have you got a backup" confirmation
#
# See docs/migrating-from-partkeepr-1.4.0.md for the full procedure.

set -euo pipefail

HOST="localhost"
PORT="3306"
USER=""
PASS=""
DB=""
DRY_RUN=0
SKIP_CONFIRM=0

while getopts "h:P:u:p:d:nyhelp" opt; do
    case $opt in
        h) HOST="$OPTARG" ;;
        P) PORT="$OPTARG" ;;
        u) USER="$OPTARG" ;;
        p) PASS="$OPTARG" ;;
        d) DB="$OPTARG" ;;
        n) DRY_RUN=1 ;;
        y) SKIP_CONFIRM=1 ;;
        *)
            sed -n '4,/^$/p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
    esac
done

if [[ -z "$USER" || -z "$DB" ]]; then
    echo "error: -u USER and -d DB are required" >&2
    echo "usage: $0 -h HOST -u USER -p PASS -d DB [-n] [-y]" >&2
    exit 2
fi

# Discover migrations relative to this script, regardless of where it's
# called from. Files are prefixed `NNNN-` and applied in numeric order.
# Add new migrations with the next prefix (e.g. 0007-foo.sql).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MIG_DIR="$SCRIPT_DIR/migrations"

if [[ ! -d "$MIG_DIR" ]]; then
    echo "error: migration dir not found at $MIG_DIR" >&2
    exit 1
fi

mapfile -t MIGRATIONS < <(ls "$MIG_DIR"/[0-9]*.sql 2>/dev/null | sort)

if [[ ${#MIGRATIONS[@]} -eq 0 ]]; then
    echo "error: no migrations found in $MIG_DIR" >&2
    exit 1
fi

# Build mysql args. Don't pass -p to mysql at all when no password —
# avoids the "Access denied for user 'foo'@'localhost'" prompt confusion.
MYSQL_ARGS=(-h "$HOST" -P "$PORT" -u "$USER" "$DB")
if [[ -n "$PASS" ]]; then
    MYSQL_ARGS=(-h "$HOST" -P "$PORT" -u "$USER" -p"$PASS" "$DB")
fi

cat <<EOF
About to apply ${#MIGRATIONS[@]} migration(s) to:
  host:     $HOST:$PORT
  user:     $USER
  database: $DB

Migrations (in order):
EOF
for f in "${MIGRATIONS[@]}"; do
    echo "  • $(basename "$f")"
done
echo

if [[ "$SKIP_CONFIRM" -eq 0 && "$DRY_RUN" -eq 0 ]]; then
    echo "These migrations are additive (new tables, nullable columns) but"
    echo "you should still have a current mysqldump backup before continuing."
    read -r -p "Proceed? [y/N] " ANSWER
    case "$ANSWER" in
        [yY]|[yY][eE][sS]) ;;
        *) echo "aborted."; exit 0 ;;
    esac
fi

# Verify connectivity before doing anything.
if [[ "$DRY_RUN" -eq 0 ]]; then
    if ! mysql "${MYSQL_ARGS[@]}" -e "SELECT 1" >/dev/null; then
        echo "error: cannot connect to $DB on $HOST:$PORT as $USER" >&2
        exit 1
    fi
fi

# Apply each migration in sequence; abort on the first failure.
for f in "${MIGRATIONS[@]}"; do
    name="$(basename "$f")"
    if [[ "$DRY_RUN" -eq 1 ]]; then
        echo "[dry-run]  $name"
        continue
    fi
    printf "applying  %-50s " "$name"
    if mysql "${MYSQL_ARGS[@]}" < "$f" 2>/tmp/migrate-err.$$; then
        echo "OK"
    else
        echo "FAILED"
        echo
        echo "----- mysql stderr -----"
        cat /tmp/migrate-err.$$
        echo "------------------------"
        rm -f /tmp/migrate-err.$$
        echo
        echo "Stopped at $name. Earlier migrations stayed applied."
        echo "Inspect the error, fix, then re-run — already-applied"
        echo "migrations will fail noisily on duplicate columns/tables;"
        echo "skip past them by editing this script's MIGRATIONS list,"
        echo "or apply the remaining ones manually with mysql." >&2
        exit 1
    fi
    rm -f /tmp/migrate-err.$$
done

echo
echo "Done. ${#MIGRATIONS[@]} migration(s) applied to $DB on $HOST."
echo "Next step: rsync your file-storage tree into PARTKEEPR_STORAGE_DIR,"
echo "configure backend/.env, and start partkeepr-api."
echo
echo "See docs/migrating-from-partkeepr-1.4.0.md for the full procedure."

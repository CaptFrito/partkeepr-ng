#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Dev-workstation helper: migrate the jlcparts SQLite from the per-user
# ~/.local/share/partkeepr-ng/ location to the system-wide
# /var/lib/partkeepr-ng/ that the ebuild + OpenRC service expect. Run
# this on felder ONCE during the dev → system-paths transition.
#
# Idempotent: re-runs are no-ops. Needs sudo for the /var/lib writes.
#
# Production install on chrisbuck does NOT need this — the
# `app-spectraq/partkeepr-api` ebuild creates /var/lib/partkeepr-ng
# with correct ownership during pkg_postinst, and the /etc/cron.d/
# entry handles the weekly sync.
#
# Usage:
#   ./scripts/setup-jlcparts-paths.sh [-u USER] [-A ARCHIVE_DIR]
#
#     -u USER         own /var/lib/partkeepr-ng as this user (default: $USER)
#     -A ARCHIVE_DIR  point archives at this dir instead of $DATA_DIR/jlc-archive
#                     (typically an NFS-mounted ZFS path; not used on chrisbuck
#                     where the data lives on the same box)
#     -h              help

set -euo pipefail

OWNER="${USER}"
ARCHIVE_DIR=""
while getopts "u:A:h" opt; do
    case $opt in
        u) OWNER="$OPTARG" ;;
        A) ARCHIVE_DIR="$OPTARG" ;;
        h)
            sed -n '4,/^$/p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *) exit 2 ;;
    esac
done

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="/var/lib/partkeepr-ng"
LOG_DIR="/var/log/partkeepr-ng"
ENV_FILE="$REPO_ROOT/backend/.env"
DEV_SQLITE="$HOME/.local/share/partkeepr-ng/jlcparts.sqlite3"
PROD_SQLITE="$DATA_DIR/jlcparts.sqlite3"

step() { printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

# ---- 1. Create the system data + log dirs -----------------------------------

step "creating $DATA_DIR + $LOG_DIR (sudo)"
sudo mkdir -p "$DATA_DIR" "$LOG_DIR"
if [[ -z "$ARCHIVE_DIR" ]]; then
    sudo mkdir -p "$DATA_DIR/jlc-archive"
fi
sudo chown -R "$OWNER":"$(id -gn "$OWNER")" "$DATA_DIR" "$LOG_DIR"

# ---- 2. Migrate the dev SQLite if present ----------------------------------

if [[ -f "$PROD_SQLITE" ]]; then
    step "$PROD_SQLITE already exists — leaving alone"
elif [[ -f "$DEV_SQLITE" ]]; then
    step "moving $DEV_SQLITE → $PROD_SQLITE"
    mv "$DEV_SQLITE" "$PROD_SQLITE"
    rmdir "$(dirname "$DEV_SQLITE")" 2>/dev/null || true
else
    step "no dev SQLite found — first sync will create one"
fi

# ---- 3. Update backend/.env to point at the prod path ----------------------

if [[ -f "$ENV_FILE" ]]; then
    if grep -q '^PARTKEEPR_JLCPARTS_DB_PATH=' "$ENV_FILE"; then
        step "rewriting PARTKEEPR_JLCPARTS_DB_PATH in $ENV_FILE"
        sed -i "s|^PARTKEEPR_JLCPARTS_DB_PATH=.*|PARTKEEPR_JLCPARTS_DB_PATH=$PROD_SQLITE|" "$ENV_FILE"
    else
        step "appending PARTKEEPR_JLCPARTS_DB_PATH to $ENV_FILE"
        printf '\nPARTKEEPR_JLCPARTS_DB_PATH=%s\n' "$PROD_SQLITE" >> "$ENV_FILE"
    fi
else
    step "no $ENV_FILE — set PARTKEEPR_JLCPARTS_DB_PATH yourself"
fi

# ---- 4. Summary ------------------------------------------------------------

cat <<EOF

[done]
  data dir:    $DATA_DIR  (owned by $OWNER:$(id -gn "$OWNER"))
  archive dir: ${ARCHIVE_DIR:-$DATA_DIR/jlc-archive}
  log file:    $LOG_DIR/jlcparts-sync.log
  env updated: PARTKEEPR_JLCPARTS_DB_PATH=$PROD_SQLITE

Manual sync (since this is a dev box without the ebuild's cron entry):
  ./scripts/jlcparts-sync.sh \\
      -o $DATA_DIR \\
      ${ARCHIVE_DIR:+-A "$ARCHIVE_DIR"} \\
      >> $LOG_DIR/jlcparts-sync.log 2>&1

Restart the backend to pick up the new env value.
EOF

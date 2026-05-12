#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# jlcparts-sync.sh — refresh the local jlcparts SQLite mirror.
#
# Today (Plan A): downloads the pre-built cache.sqlite3 from
# https://yaqwsx.github.io/jlcparts/data/ (~2 GB compressed across 41
# zip shards, ~27 GB uncompressed), atomically swaps it into place,
# adds the mfr index partkeepr-ng's handler needs.
#
# Plan B (if upstream is unreachable / removed): run the vendored
# Python pipeline at scripts/jlcparts-build/ — requires LCSC + JLCPCB
# API credentials in the environment. Not wired by default; see
# scripts/jlcparts-build/README.md.
#
# Usage:
#   ./scripts/jlcparts-sync.sh [-o /var/lib/partkeepr-ng] [-a 4]
#
#     -o DIR     destination directory (default: $PARTKEEPR_JLCPARTS_DIR
#                or /var/lib/partkeepr-ng)
#     -a N       keep N weekly archives (default 4)
#     -n         dry run — show what would happen, don't act
#     -h         help

set -euo pipefail

OUT_DIR="${PARTKEEPR_JLCPARTS_DIR:-/var/lib/partkeepr-ng}"
KEEP_ARCHIVES=4
DRY_RUN=0

while getopts "o:a:nh" opt; do
    case $opt in
        o) OUT_DIR="$OPTARG" ;;
        a) KEEP_ARCHIVES="$OPTARG" ;;
        n) DRY_RUN=1 ;;
        h)
            sed -n '4,/^$/p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *) exit 2 ;;
    esac
done

UPSTREAM="https://yaqwsx.github.io/jlcparts/data"
DEST="$OUT_DIR/jlcparts.sqlite3"
ARCHIVE_DIR="$OUT_DIR/jlc-archive"
STAGE_DIR="$OUT_DIR/jlc-staging.$$"

log() { printf '[jlcparts-sync] %s\n' "$*"; }

require_tool() {
    command -v "$1" >/dev/null 2>&1 || {
        echo "error: $1 not found in PATH" >&2
        exit 1
    }
}

require_tool curl
require_tool 7z
require_tool sqlite3
require_tool zstd

# ---- 1. Stage the download ---------------------------------------------------

if [[ "$DRY_RUN" -eq 1 ]]; then
    log "DRY RUN — would mkdir -p $OUT_DIR $ARCHIVE_DIR"
    log "DRY RUN — would download upstream cache.zip + 40 shards"
    log "DRY RUN — would extract, index, swap into $DEST"
    log "DRY RUN — would archive previous $DEST to $ARCHIVE_DIR/<date>.sqlite3.zst"
    log "DRY RUN — would prune archive to most-recent $KEEP_ARCHIVES"
    exit 0
fi

mkdir -p "$OUT_DIR" "$ARCHIVE_DIR" "$STAGE_DIR"
trap 'rm -rf "$STAGE_DIR"' EXIT

log "staging in $STAGE_DIR"
cd "$STAGE_DIR"

# 40 numbered shards + 1 final cache.zip with the central directory.
log "downloading cache.zip + 40 shards from $UPSTREAM"
curl -sS --fail -O "$UPSTREAM/cache.zip"
for n in $(seq -w 1 40); do
    curl -sS --fail -O "$UPSTREAM/cache.z${n}"
done

# ---- 2. Extract --------------------------------------------------------------

log "extracting (~27 GB) — this takes ~1 min on SSD"
7z x -y -bso0 -bse0 cache.zip
[[ -f cache.sqlite3 ]] || { echo "error: 7z produced no cache.sqlite3" >&2; exit 1; }

# ---- 3. Sanity check + add index --------------------------------------------

log "verifying integrity"
sqlite3 cache.sqlite3 "PRAGMA integrity_check;" | head -1 | grep -q '^ok$' || {
    echo "error: SQLite integrity_check did not return 'ok'" >&2
    exit 1
}

row_count=$(sqlite3 cache.sqlite3 "SELECT COUNT(*) FROM components")
log "components table: $row_count rows"
[[ "$row_count" -gt 1000000 ]] || {
    echo "error: components row count $row_count looks too low" >&2
    exit 1
}

log "adding idx_components_mfr_upper (~150 MB, ~1 min)"
# Expression index on UPPER(mfr) so the handler's case-insensitive
# GLOB pattern can use the index. ANALYZE updates stats so the planner
# picks the index reliably.
sqlite3 cache.sqlite3 \
    "CREATE INDEX IF NOT EXISTS idx_components_mfr_upper ON components(UPPER(mfr));
     ANALYZE;"

# ---- 4. Atomic swap, archive the old copy -----------------------------------

if [[ -f "$DEST" ]]; then
    ts=$(date -u -r "$DEST" +%Y-%m-%d)
    archive_file="$ARCHIVE_DIR/$ts.sqlite3.zst"
    if [[ ! -f "$archive_file" ]]; then
        log "archiving previous DB to $archive_file"
        zstd -q -T0 -19 -o "$archive_file" "$DEST"
    fi
fi

log "atomic swap → $DEST"
mv -f cache.sqlite3 "$DEST"

# ---- 5. Prune archive --------------------------------------------------------

cd "$ARCHIVE_DIR"
mapfile -t archives < <(ls -1t *.sqlite3.zst 2>/dev/null)
if [[ "${#archives[@]}" -gt "$KEEP_ARCHIVES" ]]; then
    for old in "${archives[@]:$KEEP_ARCHIVES}"; do
        log "pruning old archive $old"
        rm -f "$old"
    done
fi

log "done. $DEST is ~$(du -h "$DEST" | awk '{print $1}'), $(ls -1 *.sqlite3.zst 2>/dev/null | wc -l) archive(s) retained."
log "restart partkeepr-api or just let sqlx re-open on next query."

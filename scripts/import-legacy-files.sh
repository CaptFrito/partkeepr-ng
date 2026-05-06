#!/bin/bash
# Import attachment/image files from a legacy PartKeepr install into the
# new partkeepr-ng storage tree.
#
# Legacy PartKeepr stores files under TWO trees within the install dir:
#
#     data/files/PartAttachment/       — datasheets, docs (per-Part)
#     data/files/FootprintAttachment/  — per-Footprint non-image files
#     data/images/footprint/           — per-Footprint image files
#     data/images/iclogo/              — Manufacturer logos
#     data/images/storagelocation/     — StorageLocation photos (uncommon)
#
# Filenames are `{uuid}.{ext}` UUIDs that match each table's `filename`
# column. Our target layout flattens everything to one PascalCase
# subdir per table:
#
#     $DEST/PartAttachment/{uuid}.{ext}
#     $DEST/FootprintAttachment/{uuid}.{ext}
#     $DEST/FootprintImage/{uuid}.{ext}
#     $DEST/ManufacturerICLogo/{uuid}.{ext}
#     $DEST/StorageLocationImage/{uuid}.{ext}
#
# Idempotent — safe to re-run before, during, and after cutover. Skips
# missing source dirs cleanly.
#
# Usage:
#     scripts/import-legacy-files.sh
#         (defaults to root@parts.spectraq.com:/var/www/com.spectraq.parts/data)
#     scripts/import-legacy-files.sh /local/path/to/data
#     scripts/import-legacy-files.sh user@host:/some/path/data
#
# After rsync the script invokes clamdscan with --fdpass on the
# destination, so files are virus-scanned before they can be served.

set -euo pipefail

SRC="${1:-root@parts.spectraq.com:/var/www/com.spectraq.parts/data}"
DEST="${PARTKEEPR_STORAGE_DIR:-$HOME/.local/share/partkeepr-ng/files}"
SRC_TRIMMED="${SRC%/}"

echo "Source:      $SRC_TRIMMED"
echo "Destination: $DEST"
echo

mkdir -p "$DEST"

# Map of dest-table → relative source path inside the legacy data root.
# Order in this list controls the order of progress output.
TABLES=(
    "PartAttachment        files/PartAttachment"
    "FootprintAttachment   files/FootprintAttachment"
    "FootprintImage        images/footprint"
    "ManufacturerICLogo    images/iclogo"
    "StorageLocationImage  images/storagelocation"
)

for entry in "${TABLES[@]}"; do
    # Split each entry into table name + source subpath (any whitespace).
    read -r table src_sub <<< "$entry"
    src_path="$SRC_TRIMMED/$src_sub/"
    dest_path="$DEST/$table/"
    mkdir -p "$dest_path"
    echo "==> $table   <—  $src_sub"
    if ! rsync -ah --info=progress2 --ignore-missing-args \
            "$src_path" "$dest_path" 2>&1 | tail -3; then
        echo "    (skipped — source dir not present)"
    fi
done

echo
echo "File counts now in $DEST:"
for entry in "${TABLES[@]}"; do
    read -r table _ <<< "$entry"
    count=$(find "$DEST/$table" -maxdepth 1 -type f 2>/dev/null | wc -l)
    printf "  %-25s %d\n" "$table" "$count"
done

# --------------------------------------------------------------------------
# Virus scan — legacy PartKeepr did NOT scan uploads.
# --------------------------------------------------------------------------
echo
if command -v clamdscan >/dev/null 2>&1; then
    if ! clamdscan --version >/dev/null 2>&1; then
        echo "clamdscan installed but not responsive — skipping scan."
        echo "Run again once clamd is up, or scan manually:"
        echo "    clamdscan --fdpass --infected --multiscan \"$DEST\""
        exit 0
    fi
    echo "Scanning $DEST with clamdscan…"
    # --fdpass: clamdscan opens the file as the invoking user and
    #           hands the fd to clamd over the socket. Without this,
    #           clamd would try to open the file as the clamav user,
    #           which can't read files in $HOME/.local. fdpass is the
    #           portable answer for cross-user dev setups.
    if clamdscan --fdpass --infected --multiscan --no-summary "$DEST"; then
        echo "Scan complete — no infections found."
    else
        rc=$?
        echo
        echo "*** clamdscan reported issues (exit $rc). ***"
        echo "Exit codes: 1 = virus found, 2 = error / unreadable file."
        echo "Review the FOUND lines above and quarantine as needed."
        exit "$rc"
    fi
else
    echo "clamdscan not installed — skipping scan."
    echo "When clamd is set up, re-run this script or scan manually:"
    echo "    clamdscan --fdpass --infected --multiscan \"$DEST\""
fi

#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Build a source distribution tarball for the spectraq overlay ebuild.
# Vendored Cargo deps so the build doesn't need network on chrisbuck.
# Run from the project root.
#
# Output: /tmp/partkeepr-ng-<version>.tar.xz

set -euo pipefail

VERSION=$(grep '^version' backend/Cargo.toml | head -1 | sed 's/.*"\(.*\)"/\1/')
DIST_NAME="partkeepr-ng-${VERSION}"
DIST_DIR="/tmp/${DIST_NAME}"
TARBALL="/tmp/${DIST_NAME}.tar.xz"

echo "Building ${DIST_NAME} source tarball..."

rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"

# ---- 1. Copy the source tree, minus build artifacts + dev cruft -----------

# Backend code + lockfile.
cp -r backend "${DIST_DIR}/"
rm -rf "${DIST_DIR}/backend/target"
rm -f  "${DIST_DIR}/backend/.env"        # never ship the dev env

# Frontend static assets (Webix + bwip-js + our own JS + assets + index).
cp -r frontend "${DIST_DIR}/"
rm -rf "${DIST_DIR}/frontend/dist"        # vestigial dev artifact if present

# Helper scripts + SQL migrations + vendored jlcparts Python pipeline.
mkdir -p "${DIST_DIR}/scripts"
cp scripts/migrate-from-upstream.sh \
   scripts/jlcparts-sync.sh \
   scripts/setup-jlcparts-paths.sh \
   "${DIST_DIR}/scripts/"
cp -r scripts/migrations    "${DIST_DIR}/scripts/"
cp -r scripts/jlcparts-build "${DIST_DIR}/scripts/"

# Docs the ebuild's dodoc references.
mkdir -p "${DIST_DIR}/docs"
cp docs/migrating-from-partkeepr-1.4.0.md "${DIST_DIR}/docs/"
cp docs/manual-smoke-tests.md             "${DIST_DIR}/docs/"
cp README.md LICENSE                      "${DIST_DIR}/"
[[ -f CHANGELOG.md ]] && cp CHANGELOG.md  "${DIST_DIR}/" || true

# ---- 2. Vendor Cargo dependencies into the tarball -----------------------

# cargo vendor outputs to <dir>/vendor; we want it relative to the
# backend manifest because that's where cargo build runs from.
( cd "${DIST_DIR}/backend" \
  && cargo vendor --quiet >/dev/null )

# Tell cargo to use the vendored copy when building. The .cargo/config.toml
# goes next to the manifest.
mkdir -p "${DIST_DIR}/backend/.cargo"
cat > "${DIST_DIR}/backend/.cargo/config.toml" <<'EOF'
[source.crates-io]
replace-with = "vendored-sources"

[source.vendored-sources]
directory = "vendor"
EOF

# ---- 3. Tarball ----------------------------------------------------------

cd /tmp
tar cJf "${TARBALL}" "${DIST_NAME}"
rm -rf "${DIST_DIR}"

echo "Created: ${TARBALL}"
echo "Size:    $(du -h "${TARBALL}" | cut -f1)"
echo
echo "Next step — upload to chrisbuck:"
echo "  scp ${TARBALL} chrisbuck:/tmp/"
echo "  ssh -t chrisbuck \"sudo mv /tmp/${DIST_NAME}.tar.xz /var/www/com.spectraq.sqgit/htdocs/files/ && sudo chown apache:apache /var/www/com.spectraq.sqgit/htdocs/files/${DIST_NAME}.tar.xz\""
echo
echo "Or just push a v${VERSION} tag and let the gitolite hook do it:"
echo "  git tag v${VERSION} && git push origin master v${VERSION}"

# Webix Standard (vendored)

- Upstream: https://github.com/webix-hub/webix
- Version: **11.4.0**
- License: GPL v3 (see `LICENSE.txt`)
- Imported: 2026-05-07

## Why vendored

Webix is the rendering toolkit for the partkeepr-ng frontend. We vendor a
pinned copy so the project is offline-buildable and the version is locked
to a known-good build — no CDN dependency at runtime, no surprise upgrades.

## Files used at runtime

The frontend (`../index.html`) loads:

- `webix.min.js`  — runtime
- `webix.min.css` — base styling
- `skins/` — optional theme variants
- `fonts/` — Webix's bundled font files

Everything else here is reference (sources, type defs, minified maps).

## Updating

To update to a newer Webix release:

```bash
git clone --depth 1 https://github.com/webix-hub/webix.git /tmp/webix-new
cp -r /tmp/webix-new/codebase/* frontend/vendor/webix/
cp /tmp/webix-new/license.txt frontend/vendor/webix/LICENSE.txt
cp /tmp/webix-new/whatsnew.md frontend/vendor/webix/CHANGELOG.md
# Update the version stamp at the top of this file.
```

## License compatibility

partkeepr-ng inherits PartKeepr's GPL lineage, so consuming Webix Standard
under GPL v3 is compatible. If the project's licensing ever changes,
revisit this dependency — Webix's commercial-license tier is the
non-GPL alternative.

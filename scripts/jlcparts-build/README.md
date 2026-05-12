# Vendored jlcparts build pipeline

This directory holds a **snapshot** of the Python data-build pipeline
from [`yaqwsx/jlcparts`](https://github.com/yaqwsx/jlcparts) — the
project that scrapes / queries the LCSC and JLCPCB APIs and assembles
the `cache.sqlite3` file that partkeepr-ng's `🟡 Cross-ref LCSC`
feature queries.

## Why is this here?

partkeepr-ng's `scripts/jlcparts-sync.sh` ordinarily downloads the
pre-built `cache.sqlite3` from upstream's GitHub Pages
(`https://yaqwsx.github.io/jlcparts/data/`). That's the path of least
resistance and it works today.

The vendored copy here is a **Plan B**: if upstream goes away
(maintainer burnout, repo deleted, GH Pages stops serving, API key
revoked, JLC objects), we can run the same pipeline ourselves on the
workshop box and produce our own `cache.sqlite3`. Same schema, same
query code, no upstream dependency.

To activate Plan B you'd need:

1. LCSC partner API credentials (`LCSC_KEY` + `LCSC_SECRET`).
2. JLCPCB API credentials (`JLCPCB_APP_ID` + `JLCPCB_ACCESS_KEY` +
   `JLCPCB_SECRET_KEY`).
3. Switch `scripts/jlcparts-sync.sh` from `wget upstream` mode to
   `python -m jlcparts ...` mode (a config flag — code already
   handles both).

We're not running Plan B today; this directory is dormant code we
preserve in case we need it.

## Upstream snapshot info

| | |
|---|---|
| Source | https://github.com/yaqwsx/jlcparts |
| Snapshot commit | `93fd417` ("Skip malformed LCSC extra records") |
| Date snapshotted | 2026-05-12 |
| License | MIT (see `LICENSE.upstream`) |
| Author | Jan ("Honza") Mrázek |

## What's omitted from upstream

- `web/` — their React frontend. partkeepr-ng has its own UI; we
  only need the data pipeline.
- `test/` — unit tests for the Python pipeline. Re-fetch from
  upstream if you ever need to maintain or fix this code.

## Refreshing the snapshot

When jlcparts ships a fix or schema change you want to pick up:

```bash
cd /tmp && git clone --depth 1 https://github.com/yaqwsx/jlcparts.git
cd /path/to/partkeepr-ng/scripts/jlcparts-build
rm -rf jlcparts setup.py LCSC-API.md
cp -r /tmp/jlcparts/jlcparts .
cp /tmp/jlcparts/setup.py .
cp /tmp/jlcparts/LCSC-API.md .
cp /tmp/jlcparts/LICENSE LICENSE.upstream
# update the "Snapshot commit" line in this README
git add . && git commit -m "Refresh vendored jlcparts to <commit>"
```

## License

Vendored code in this directory is © Jan Mrázek under the MIT License
(`LICENSE.upstream`). partkeepr-ng as a whole is GPL-3.0-or-later;
GPL is compatible with consuming MIT-licensed dependencies.

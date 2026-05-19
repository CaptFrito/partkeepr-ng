# partkeepr-ng

A from-scratch Rust + Webix rewrite of the abandoned upstream
[PartKeepr](https://github.com/partkeepr/PartKeepr) (Symfony 2.7 / PHP 5.6
/ Doctrine 2.5 / ExtJS 6 — all years EOL), for managing an electronic-parts
inventory in a small workshop. Same MariaDB schema, modern stack
underneath, drop-in compatible with existing 1.4.0 installs.

> **Status: alpha.** The author's workshop runs partkeepr-ng on the LAN
> for parity testing alongside a legacy PartKeepr 1.4.0 install that
> remains the daily-driver until feature parity closes. Treat this as
> "works on my workshop bench, no warranty, no support guarantees." If
> you want a feature, fork.

## What it does

The core PartKeepr 1.4.0 surface is fully preserved:

- **Parts catalog** with a nested-set Category tree, parametric search,
  meta-parts (named criteria that match real parts), and a full-text
  index across name/IPN/description/manufacturer-MPN/distributor-SKU.
- **Storage tree** (nested-set), with `(NOWHERE)` as a system-managed
  default bin for not-yet-placed stock.
- **Footprint catalog** with images + attachments.
- **Multi-distributor** PartDistributor rows, **multi-manufacturer**
  PartManufacturer rows.
- **Stock history** via the existing `StockEntry` append-only log,
  with the upstream `recomputeStockLevels()` math preserved verbatim
  so partkeepr-ng and the legacy PHP would compute identical numbers
  against the same DB.
- **Projects** with bill-of-materials, runs, and stock decrements.
- **Attachments** (datasheets, photos, BOM files) with optional clamd
  virus scanning, thumbnails, and inline upload-by-URL.
- **Auth** compatible with the upstream FOSUserBundle password hashes
  (sha512 + 5000-iter + per-user salt), so existing user accounts log
  in unchanged.

And several additions on top:

- **Packaging tab** — `PartStorageLocation` rows describe the physical
  containers stock lives in (Reel / CutTape / Loose / Tray / Tube /
  Feeder / Bag / Other), each in its own storage bin, with lot + date
  code. Consume directly from a specific container via 🔻 buttons.
- **Container traceability** — every `StockEntry` can FK-link to the
  exact `PartStorageLocation` it came from / went to.
- **2D barcode scanning** for Digi-Key / Mouser / Mini-Circuits labels
  with three-way dispatch (matched + qty → confirm; matched only →
  navigate + lot-toast; no match → import).
- **Digi-Key Product Information V4** and **Mouser Search v2** for
  importing parts with parameters, datasheets, and logos.
- **Digi-Key Order Status v4** and **Mouser Order History v1** for
  receiving stock against placed orders, with partial-shipment
  tracking that lets a two-shipment order be received in two
  sessions without double-counting.
- **TrustedParts.com live distributor compare** — ECIA-backed
  cross-distributor stock and price lookup. Authorized franchised
  distributors only (DK, Mouser, Arrow, Newark, ...).
- **LCSC / JLCPCB cross-reference** via the
  [yaqwsx/jlcparts](https://github.com/yaqwsx/jlcparts) catalog — find
  the right LCSC part number for any USA-distributor MPN, see whether
  it's in JLC's Basic / Preferred / Extended library, plan PCBA orders.
- **Brother PT-D410 label printing** via `ptouch-print`.

## Stack

- **Backend:** Rust + Axum 0.7 + sqlx 0.8 + tokio. ~14 KLOC. Reads and
  writes the upstream 49-table PartKeepr 1.4.0 MariaDB schema verbatim;
  six small additive migrations introduce new tables and nullable
  columns for the additions above.
- **Frontend:** [Webix Standard 11.4.0](https://webix.com) (GPL) +
  vanilla JS. No build step — vendored at `frontend/vendor/webix/`,
  served as static files. Split across an ~240-line bootstrap (`app.js`)
  and seven view modules in `frontend/views/`.
- **Database:** MariaDB 10.6+ (the upstream 10.1 dump still imports
  cleanly for migration purposes; runtime requires 10.6+).
- **Optional services:** clamd (virus scanning), ptouch-print (label
  printing). All cleanly disable when their env vars are unset.

## Migrating from PartKeepr 1.4.0

The project is built on **schema-as-contract** — the existing 49
PartKeepr tables are the durable interface. To migrate an existing
1.4.0 install:

1. `mysqldump` your prod database.
2. Restore on a fresh DB.
3. Run the six additive migrations in `scripts/migrations/` in numeric
   order (or use `scripts/migrate-from-upstream.sh`).
4. Rsync your file storage tree into `$PARTKEEPR_STORAGE_DIR`.
5. Set env vars (see `backend/.env.example`) and start the `partkeepr-ng` service.

Full walkthrough: [`docs/migrating-from-partkeepr-1.4.0.md`](docs/migrating-from-partkeepr-1.4.0.md).

## Quick start (development)

```bash
# 1. MariaDB up locally with a partkeepr_dev DB seeded from a schema dump.
mysql -u root < docs/live-schema/partkeepr-schema.sql

# 2. Apply the additive migrations in order.
./scripts/migrate-from-upstream.sh -u partkeepr_dev -p '<pwd>' -d partkeepr_dev

# 3. Configure backend env (see backend/.env.example for all the knobs).
cp backend/.env.example backend/.env
$EDITOR backend/.env   # set DATABASE_URL + PARTKEEPR_SESSION_SECRET at minimum

# 4. Run.
(cd backend && cargo run --bin partkeepr-api)

# 5. Open http://localhost:8080/  (default login: admin / admin)
```

API integrations (Digi-Key, Mouser, TrustedParts, jlcparts) all start
disabled and need their env vars set. The app boots clean without any
of them.

## Optional features — provisioning

### LCSC / JLCPCB cross-reference (jlcparts)

Mirrors the [`yaqwsx/jlcparts`](https://github.com/yaqwsx/jlcparts)
SQLite catalog locally — `~7.1M` LCSC parts, refreshed weekly. After
a one-shot setup, the **`🟡 Cross-ref LCSC`** button appears on the
part-detail toolbar.

```bash
# Lay down the prod paths + cron + initial sync.
./scripts/setup-jlcparts-paths.sh     # needs sudo
sudo /etc/cron.weekly/partkeepr-ng-jlcparts-sync   # first-run download (~2 GB)
```

Plan B if upstream ever goes away: `scripts/jlcparts-build/` ships a
vendored snapshot of yaqwsx/jlcparts' MIT-licensed Python build
pipeline — combined with LCSC + JLCPCB partner API credentials, we can
generate the catalog ourselves.

### TrustedParts.com live compare

Request a free Inventory API key at
[trustedparts.com](https://www.trustedparts.com/) (My Account →
Additional Features → Inventory API), set `PARTKEEPR_TRUSTEDPARTS_API_KEY`
in `backend/.env`, and the **`💲 Compare`** button appears on the
part-detail toolbar.

### Digi-Key / Mouser

Apply for production credentials with each vendor (see
`docs/migrating-from-partkeepr-1.4.0.md` for the env var contract).

## Repository layout

```
backend/                    Rust + Axum API server
  src/handlers/             Per-route handler modules
  src/models/               Doctrine-derived structs (codegen + handwritten)
  src/bin/                  One-off CLI utilities (reset-password)
frontend/                   Static Webix Standard SPA, served by the backend
  app.js                    Bootstrap (~240 lines)
  views/                    Feature modules (api, trees, parts-grid,
                              part-editor, dialogs, scan, admin)
  vendor/webix/             Webix Standard 11.4.0 GPL bundle
  vendor/bwip-js/           Barcode rendering for label printing
  assets/                   Logo + favicon + trustedparts attribution logo
docs/
  schema.md, schema.json    Doctrine-entity-derived schema reference
  live-schema/              Production schema dump (data/secrets stripped)
  upstream-issues/          JSON archive of upstream PartKeepr's issue tracker
  migrating-from-partkeepr-1.4.0.md
  manual-smoke-tests.md     Walk-through checklist for risky changes
scripts/
  migrations/               Numbered additive SQL migrations
  jlcparts-build/           Vendored yaqwsx/jlcparts Python pipeline (MIT, Plan B)
  jlcparts-sync.sh          Weekly LCSC SQLite refresh (called by cron)
  migrate-from-upstream.sh  One-shot migration applier
  setup-jlcparts-paths.sh   Lay down prod /var/lib + /etc/cron.weekly
ebuild/files/               Gentoo OpenRC service + cron + ptouch helpers
debian/                     (TBD) Debian packaging
```

## License & attribution

partkeepr-ng is **GPL-3.0-or-later** — see [`LICENSE`](LICENSE). The
license is inherited from the dependencies below, not chosen independently.

### Upstream code we directly port or re-use

- **[PartKeepr 1.4.0](https://github.com/partkeepr/PartKeepr)** (GPLv3) —
  by Christian Strauf / "Felicitus" + the PartKeepr contributors. We
  port the database schema unchanged, the
  `Part::recomputeStockLevels()` accounting logic in
  `backend/src/handlers/stock.rs`, the file-storage on-disk layout
  (`data/files/PartAttachment/`, `data/images/iclogo/`, etc.), the
  FOSUserBundle password hash format, and the loading-screen "P" logo
  at `frontend/assets/logo.svg`. Schema and core math are direct
  transliterations; everything else is freshly written.
- **[yaqwsx/jlcparts](https://github.com/yaqwsx/jlcparts)** (MIT) — by
  Honza Mrázek. Their daily-rebuilt SQLite catalog is what our weekly
  cron mirrors into `/var/lib/partkeepr-ng/jlcparts.sqlite3` for the
  LCSC cross-reference feature. The Python build pipeline is vendored
  at `scripts/jlcparts-build/` (with `LICENSE.upstream`) as a Plan B.

### Bundled libraries

- **[Webix Standard 11.4.0](https://webix.com)** (GPLv3) — vendored at
  `frontend/vendor/webix/`; license preserved at
  `frontend/vendor/webix/LICENSE.txt`.
- **[bwip-js](https://github.com/metafloor/bwip-js)** (MIT) — barcode
  rendering for QR-label printing. Vendored at `frontend/vendor/bwip-js/`.
- **Rust crates** — see `backend/Cargo.toml` for the full dependency
  list, all under MIT / Apache-2.0 / dual MIT-Apache (GPL-compatible).

### Brand notes

The "PartKeepr" name is not a registered trademark and is reused in
its descriptive sense ("a fork-ish reimplementation of PartKeepr").
The `-ng` suffix follows the Unix convention for next-generation
rewrites. TrustedParts.com attribution per their docs page is rendered
in the Compare-distributors modal footer.

## Authorship

- Don Bishop \<dbishop@spectraq.com\>

This project is a workshop tool. Pull requests are welcome but not
guaranteed to be reviewed; issues may sit. If you need a feature, fork.

## No warranty

```
This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.
```

(See `LICENSE` sections 15–16 for the full disclaimer.)

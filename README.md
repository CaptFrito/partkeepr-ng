# partkeepr-ng

A from-scratch rewrite of the abandoned [PartKeepr](https://github.com/partkeepr/PartKeepr)
(Symfony 2.7 / PHP 5.6 / Doctrine 2.5 / ExtJS 6 — all years EOL) for managing
electronic-parts inventory in a small workshop. Same MariaDB schema, modern
stack underneath.

**Status: alpha.** Runs the author's daily inventory workflow at
parts.spectraq.com. Treat as "works on my workshop bench" — not packaged for
general consumption yet, no support guarantees, no warranty.

## Stack

- **Backend:** Rust + Axum 0.7 + sqlx 0.8 + tokio. ~10 KLOC. Reads and writes
  the upstream PartKeepr 1.4.0 MariaDB schema verbatim, with additive
  migrations for new features (multi-location packaging, container
  traceability, distributor receipt attribution).
- **Frontend:** [Webix Standard 11.4.0](https://webix.com) (GPL) + vanilla JS.
  No build step — vendored at `frontend/vendor/webix/`, served as static
  files. Replaced an earlier Leptos UI in 2026-05.
- **Database:** MariaDB 10.6+ (the upstream 10.1 dump still imports cleanly
  for migration purposes; runtime requires 10.6+).
- **Auth:** FOSUserBundle-compatible password hashing (sha512 + 5000 iter +
  per-user salt) so existing PartKeepr 1.4.0 user accounts log in unchanged.

## Migrating from PartKeepr 1.4.0

The whole project is built on **schema-as-contract** — the existing 49
PartKeepr tables are the durable interface. Migrating an existing 1.4.0
install means:

1. Take a `mysqldump` of your prod database.
2. Restore on a fresh DB.
3. Run the four additive migrations in `scripts/migrations/` in order
   (or use the wrapper at `scripts/migrate-from-upstream.sh`).
4. Rsync your file storage tree into `$PARTKEEPR_STORAGE_DIR`.
5. Set env vars and start `partkeepr-api`.

Step-by-step: see [`docs/migrating-from-partkeepr-1.4.0.md`](docs/migrating-from-partkeepr-1.4.0.md).

## Quick start (development)

```bash
# 1. MariaDB up locally with a partkeepr_dev DB seeded from a schema dump.
mysql -u root < docs/live-schema/partkeepr-schema.sql

# 2. Apply additive migrations.
ls scripts/migrations/*.sql | xargs -I {} mysql -u partkeepr_dev partkeepr_dev < {}

# 3. Configure backend env (see backend/.env.example for the full list).
cp backend/.env.example backend/.env
# Edit DATABASE_URL, PARTKEEPR_SESSION_SECRET (≥16 chars), …

# 4. Run.
(cd backend && cargo run --bin partkeepr-api)

# 5. Open http://localhost:8080/  (default login: admin / admin)
```

For the full env-var contract, see [`docs/runtime-env.md`](docs/runtime-env.md).
DK / Mouser API integration requires keys in env; the app starts without them
(those features will just appear disabled).

## Repository layout

```
backend/                 Rust + Axum API server
  src/handlers/          Per-route handler modules
  src/models/            Doctrine-derived structs (codegen + handwritten)
  src/bin/               One-off CLI utilities (reset-password)
frontend/                Static Webix Standard SPA, served by the backend
  app.js                 Single-file UI (~7 KLOC; refactor planned)
  vendor/webix/          Webix Standard 11.4.0 GPL bundle
  vendor/bwip-js/        Barcode rendering for label printing
  assets/                Logo + favicon
docs/                    Schema reference, migration guide, upstream archive
  schema.md, schema.json    Doctrine-entity-derived schema reference
  live-schema/              Production schema dump (data/secrets stripped)
  upstream-issues/          JSON archive of upstream PartKeepr's issue tracker
                            (preserved here against the day GitHub goes away)
scripts/migrations/      Additive SQL migrations applied on top of upstream
scripts/                 Migration + helper shell scripts
ebuild/files/            Gentoo OpenRC service files
debian/                  (TBD) Debian packaging
```

## License & attribution

partkeepr-ng is licensed under the **GNU GPL v3 or later** — see
[`LICENSE`](LICENSE).

This license is inherited from upstream dependencies, not chosen
independently:

- **PartKeepr 1.4.0** (GPLv3) — original by Christian Strauf / "Felicitus" /
  the PartKeepr contributors. partkeepr-ng ports the database schema, the
  `Part::recomputeStockLevels()` accounting logic in `backend/src/handlers/stock.rs`,
  the file-storage on-disk layout convention (`PartAttachment/`, `images/iclogo/`,
  etc.), the FOSUserBundle password hash format, and the loading-screen "P"
  logo in `frontend/assets/logo.svg`. Schema and core math are direct
  transliterations; everything else is fresh.
- **Webix Standard 11.4.0** (GPLv3) — vendored at `frontend/vendor/webix/`.
  License preserved at `frontend/vendor/webix/LICENSE.txt`.
- **bwip-js** (MIT) — barcode rendering for QR-label printing. Vendored at
  `frontend/vendor/bwip-js/`.
- **Rust crates** — see `backend/Cargo.toml` for the full dependency list,
  all under MIT / Apache-2.0 / dual MIT-Apache (GPLv3-compatible).

The PartKeepr name is not registered as a trademark and is reused here in
its descriptive sense ("a fork-ish reimplementation of PartKeepr"). The
"-ng" suffix follows the long Unix convention for next-generation rewrites.

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

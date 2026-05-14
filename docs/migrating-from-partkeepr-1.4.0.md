# Migrating from PartKeepr 1.4.0

partkeepr-ng is a from-scratch reimplementation that **uses the upstream
PartKeepr 1.4.0 database schema unchanged**. This means an existing 1.4.0
install can be migrated by:

1. Dumping your prod database.
2. Restoring it on a fresh DB.
3. Applying a small set of additive SQL migrations.
4. Rsyncing your file-storage tree.
5. Pointing partkeepr-ng at it.

No data is touched destructively. The migration adds new tables and
nullable columns; existing rows keep working unchanged. If something
goes wrong, you still have your original database to fall back to.

## What's preserved verbatim

- Every table, column, index, and foreign key from the 49-table 1.4.0
  schema.
- All your `Part`, `PartCategory`, `StorageLocation`, `Manufacturer`,
  `Distributor`, `StockEntry`, `Project`, `ProjectRun`, etc., rows.
- `FOSUser` password hashes (sha512 + 5000 iter + per-user salt).
  Existing user accounts log in unchanged.
- The on-disk file layout: `data/files/PartAttachment/{uuid}.{ext}`,
  `data/images/iclogo/{uuid}.{ext}`, etc. partkeepr-ng reads from the
  same paths as upstream.

## What's added

Six additive migrations in `scripts/migrations/`, applied in numeric
prefix order:

| File | What it adds |
|---|---|
| `0001-attribution-backfill.sql` | Adds a "system" `PartKeeprUser` row and assigns it to legacy `Project`/`StockEntry` rows that had a NULL `user_id`. Lets every history row attribute to *someone*. |
| `0002-multi-location-parts.sql` | New `PartStorageLocation` table — per-physical-container row breakdown of a part's stock (the "Reel A holds 1000, Loose pile holds 200" model). Adds nothing to existing tables. |
| `0003-stock-entry-order-tracking.sql` | Adds nullable `StockEntry.distributor_id` + `salesOrderNumber` columns + index. Backfills receipts attributed to known sales orders. |
| `0004-container-rows-backfill.sql` | Drops NOT NULL on `PartStorageLocation.storageLocation_id`, then backfills a `Loose` row covering existing stock for every part with stock but no PSL row. |
| `0005-partunit-cleanup.sql` | Drops vestigial reel/cut-tape PartUnit rows (their role is now played by `PartStorageLocation.form`); seeds standard measurement units (Metres, Litres, Kilograms, etc.). |
| `0006-stock-entry-container-tracking.sql` | Adds nullable `StockEntry.partStorageLocation_id` FK. Lets the system tie each receipt/draw to a specific physical container. |

All migrations are additive (new tables, nullable columns, INSERTs).
Running one twice fails loudly on the duplicate `ALTER TABLE` /
`CREATE TABLE`, not silently — re-running the wrapper after a fix is
generally safe, but expect noisy errors past the point of last success.

## Step-by-step

### 1. Dump prod

On the legacy host:

```bash
mysqldump -u <user> -p --single-transaction --routines --triggers \
    partkeepr > /tmp/partkeepr-prod.sql

# The file storage tree (paths match your PartKeepr install):
tar -czf /tmp/partkeepr-files.tar.gz -C /var/www/com.example.parts data/
```

### 2. Restore on the target host

```bash
# Create a target DB and grant the new dev user.
mysql -u root <<EOF
CREATE DATABASE partkeepr_ng;
CREATE USER 'partkeepr_ng'@'localhost' IDENTIFIED BY '<password>';
GRANT ALL ON partkeepr_ng.* TO 'partkeepr_ng'@'localhost';
EOF

mysql -u partkeepr_ng -p partkeepr_ng < /tmp/partkeepr-prod.sql
```

Sanity-check the restore:

```bash
mysql -u partkeepr_ng -p partkeepr_ng -e "SELECT COUNT(*) FROM Part;"
```

The number should match what you saw on the legacy host.

### 3. Apply additive migrations

The wrapper script runs all migrations in order, with one-line progress
output:

```bash
./scripts/migrate-from-upstream.sh \
    -h localhost -u partkeepr_ng -p '<password>' -d partkeepr_ng
```

Or run them manually:

```bash
for f in scripts/migrations/*.sql; do
    echo "--- $f ---"
    mysql -u partkeepr_ng -p partkeepr_ng < "$f"
done
```

(Glob order matches the dependency order — current file names sort
correctly.)

If a migration fails partway through, the rest of that file rolls back
(`ALTER TABLE` is atomic per statement on InnoDB). Earlier migrations
that succeeded stay applied. Re-running after fixing the issue is
generally safe — failed `ALTER`s leave nothing behind.

### 4. Rsync the file storage tree

```bash
# On the target:
mkdir -p /var/lib/partkeepr-ng/files
tar -xzf /tmp/partkeepr-files.tar.gz -C /var/lib/partkeepr-ng/

# Files now live at /var/lib/partkeepr-ng/files/PartAttachment/...
# images/ likewise.
```

The `data/files/Temporary/` and `data/images/cache/` and
`data/images/temp/` subtrees can be skipped — they're transient on the
PartKeepr side and partkeepr-ng doesn't read them.

### 5. Configure and start the backend

```bash
cp backend/.env.example backend/.env
$EDITOR backend/.env
```

Required:

```env
DATABASE_URL=mysql://partkeepr_ng:<password>@localhost:3306/partkeepr_ng
PARTKEEPR_SESSION_SECRET=<openssl rand -base64 48>
PARTKEEPR_STORAGE_DIR=/var/lib/partkeepr-ng/files
```

Optional (leave unset to disable the corresponding feature):

```env
PARTKEEPR_CLAMD=tcp://127.0.0.1:3310           # virus scanning on uploads
PARTKEEPR_PTOUCH_BIN=/usr/bin/ptouch-print     # Brother PT-D410 label printing
PARTKEEPR_MOUSER_SEARCH_KEY=...                # Mouser API
PARTKEEPR_MOUSER_ORDER_KEY=...
PARTKEEPR_DIGIKEY_CLIENT_ID=...                # Digi-Key API
PARTKEEPR_DIGIKEY_CLIENT_SECRET=...
PARTKEEPR_DIGIKEY_CUSTOMER_ID=...              # required for OrderStatus only
PARTKEEPR_TRUSTEDPARTS_API_KEY=...             # TrustedParts.com live compare
```

Start the API:

```bash
(cd backend && cargo run --release --bin partkeepr-api)
```

Open `http://localhost:8080/` and log in with your existing 1.4.0
credentials.

## Verifying the migration

A few spot checks once the new app is up:

- Parts list — number should match `SELECT COUNT(*) FROM Part`.
- Stock levels — pick a high-volume part and confirm `Part.stockLevel`
  matches what 1.4.0 showed.
- Open the Packaging tab on a part — there should be a `Loose` row
  covering its stock (added by `0004-container-rows-backfill.sql`).
- Storage tree — categories and locations should look identical to
  1.4.0.
- Login — your existing user accounts work without password reset.

If a known-good user can't log in, the most likely cause is the user is
in `FOSUser` but not `PartKeeprUser` (an upstream orphan). Run:

```sql
SELECT username FROM FOSUser
  WHERE username NOT IN (SELECT username FROM PartKeeprUser);
```

Add a corresponding `PartKeeprUser` row for any user you want to keep.

## Rollback

partkeepr-ng never deletes data and never modifies upstream columns. If
you decide to go back to PartKeepr 1.4.0:

1. Stop the `partkeepr-ng` service.
2. Re-point your 1.4.0 install at the original DB. The new tables
   (`PartStorageLocation`) and new columns (`StockEntry.distributor_id`,
   `salesOrderNumber`, `partStorageLocation_id`) will be ignored by
   1.4.0 — Doctrine reads only the columns it knows about.

If you instead want to drop the partkeepr-ng additions cleanly:

```sql
ALTER TABLE StockEntry
    DROP FOREIGN KEY fk_StockEntry_psl,
    DROP COLUMN partStorageLocation_id,
    DROP FOREIGN KEY fk_StockEntry_distributor,
    DROP COLUMN distributor_id,
    DROP COLUMN salesOrderNumber;
DROP TABLE PartStorageLocation;
```

(Drop indexes / FKs first, columns second; check `SHOW CREATE TABLE
StockEntry` for current constraint names.)

## Schema changes since slice 13d (2026-05)

New migrations land in `scripts/migrations/` over time. Always run them
in filename order; the wrapper script enforces this. Check
`CHANGELOG.md` or the git log for what each one does.

## Known caveats

- **MariaDB version**: upstream worked on 10.1; partkeepr-ng requires
  10.6 or newer. The 10.1 dump still imports cleanly into 10.6 — the
  jump is in *runtime* features (CTEs, window functions in some
  queries), not schema. Upgrade your DB before you upgrade your app.
- **Stock-level recompute**: partkeepr-ng's recompute treats correction
  entries as pure quantity adjustments (preserves `averagePrice`).
  Upstream's recompute folded corrections into the cost-basis math.
  After the first `StockEntry` write under partkeepr-ng, the
  `averagePrice` may shift on parts that had correction entries. This
  is documented in `backend/src/handlers/stock.rs::recompute` and is
  the only intentional divergence.
- **Orphan entities**: 1.4.0 has two unused tables (`PartImage`,
  `PageBasicLayout`) left over from removed features. partkeepr-ng
  doesn't read or write them, but doesn't drop them either — your dump
  preserves them as-is. You can drop them manually if you want.

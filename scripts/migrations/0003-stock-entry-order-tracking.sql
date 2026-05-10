-- Slice 12b.2 follow-on: structured order tracking on StockEntry.
--
-- Adds two columns so we can answer "which sales orders contributed
-- to this part's stock?" without parsing the freeform `comment`
-- field. Both NULL for legacy rows + manual entries; populated by
-- the Digi-Key Order Status receive flow (and Mouser Order History
-- once that ships).
--
-- Backfills any rows the receive flow already wrote (slice 12b.2
-- shipped 2026-05-08; the comment format is "Digi-Key SO #N line K").
-- Idempotent: safe to re-run — uses IF NOT EXISTS / IF NOT NULL
-- predicates throughout.
--
-- Apply with:
--   mariadb -u partkeepr_dev -p... partkeepr_dev \
--     < scripts/migrations/stock-entry-order-tracking.sql

-- 1. Schema additions. MariaDB doesn't support IF NOT EXISTS on
--    individual ADD COLUMN clauses (8.0.29+ does in MySQL but not
--    MariaDB stable), so guard via information_schema lookups.

SET @col_exists := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'StockEntry'
      AND COLUMN_NAME = 'distributor_id'
);
SET @sql := IF(@col_exists = 0,
    'ALTER TABLE StockEntry ADD COLUMN distributor_id INT(11) NULL DEFAULT NULL',
    'SELECT "distributor_id already present" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'StockEntry'
      AND COLUMN_NAME = 'salesOrderNumber'
);
SET @sql := IF(@col_exists = 0,
    'ALTER TABLE StockEntry ADD COLUMN salesOrderNumber VARCHAR(64) NULL DEFAULT NULL',
    'SELECT "salesOrderNumber already present" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. Index on the lookup pair. Used by the per-part receipts
--    aggregation endpoint and "find every part that came from this
--    SO" admin queries.

SET @idx_exists := (
    SELECT COUNT(*)
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'StockEntry'
      AND INDEX_NAME = 'idx_se_dist_so'
);
SET @sql := IF(@idx_exists = 0,
    'CREATE INDEX idx_se_dist_so ON StockEntry (distributor_id, salesOrderNumber)',
    'SELECT "idx_se_dist_so already present" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Foreign key — soft (no CASCADE; orphans get a NULL distributor_id
--    if a Distributor is deleted, but we hard-block delete in the
--    Distributor merge handler anyway).

SET @fk_exists := (
    SELECT COUNT(*)
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'StockEntry'
      AND CONSTRAINT_NAME = 'fk_StockEntry_distributor'
);
SET @sql := IF(@fk_exists = 0,
    'ALTER TABLE StockEntry ADD CONSTRAINT fk_StockEntry_distributor \
     FOREIGN KEY (distributor_id) REFERENCES Distributor(id) ON DELETE SET NULL',
    'SELECT "fk_StockEntry_distributor already present" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4. Backfill: rows whose comment matches "Digi-Key SO #<N>..." get
--    the structured fields populated. Match the SO# greedily up to
--    the next non-digit. Only touch rows where distributor_id IS NULL
--    so re-running this is a no-op.

SET @dk_id := (SELECT id FROM Distributor WHERE LOWER(name) = 'digi-key' LIMIT 1);

-- MariaDB's REGEXP_SUBSTR is 2-arg (str, pattern); we want the first
-- run of digits after "SO #", which is also "the only digit run in
-- the comment up to the trailing ' line K'". Split off the prefix
-- before the digits, then take everything up to (but not including)
-- the next space.
UPDATE StockEntry
SET distributor_id   = @dk_id,
    salesOrderNumber = SUBSTRING_INDEX(
                         SUBSTRING(comment, LENGTH('Digi-Key SO #') + 1),
                         ' ', 1)
WHERE @dk_id IS NOT NULL
  AND distributor_id IS NULL
  AND comment LIKE 'Digi-Key SO #%';

SELECT COUNT(*) AS backfilled_rows
FROM StockEntry
WHERE distributor_id = @dk_id
  AND salesOrderNumber IS NOT NULL;

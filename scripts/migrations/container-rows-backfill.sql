-- Slice 13b follow-on: auto-populate Container rows for parts that
-- already have stock.
--
-- The Containers tab (PartStorageLocation rows) was added later than
-- the rest of the schema, so existing parts with positive stockLevel
-- have zero rows. Operator was forced to create a "Loose" container
-- row covering the existing stock just to start using the feature.
-- Backfill takes care of all of them in one shot.
--
-- Also: relax NOT NULL on storageLocation_id so a "loose, not yet
-- binned" container is representable. The original schema required
-- a bin be picked even for stock the operator hadn't yet placed.
--
-- Idempotent: re-runnable. Backfill skips parts that already have
-- rows; nullability change is a no-op when applied twice.
--
-- Apply with:
--   mariadb -u partkeepr_dev -p... partkeepr_dev \
--     < scripts/migrations/container-rows-backfill.sql

-- 1. Drop NOT NULL on storageLocation_id. MariaDB MODIFY COLUMN
--    is idempotent (specifying NULL twice is harmless).

ALTER TABLE PartStorageLocation
    MODIFY COLUMN storageLocation_id INT(11) NULL DEFAULT NULL;

-- 2. Backfill: for every Part with stockLevel > 0 that has zero
--    PartStorageLocation rows, insert one Loose row with the full
--    quantity. storage_location_id = the part's primary
--    Part.storageLocation_id (which is already a valid leaf in
--    StorageLocation), or NULL if unset.
--
--    This preserves total stock balance: sum(PartStorageLocation.quantity)
--    will equal Part.stockLevel for these parts immediately after.

INSERT INTO PartStorageLocation
    (part_id, storageLocation_id, form, quantity, lotNumber, comment,
     user_id, created, lastModified)
SELECT
    p.id,
    p.storageLocation_id,
    'Loose',
    p.stockLevel,
    NULL,
    'Auto-backfilled from existing stock',
    NULL,
    NOW(),
    NOW()
FROM Part p
LEFT JOIN PartStorageLocation psl ON psl.part_id = p.id
WHERE p.stockLevel > 0
GROUP BY p.id
HAVING COUNT(psl.id) = 0;

-- Report rows inserted (informational; the INSERT count is also
-- visible in MariaDB's row-count output).

SELECT COUNT(*) AS containers_after_backfill,
       SUM(quantity) AS total_qty_in_containers
FROM PartStorageLocation;

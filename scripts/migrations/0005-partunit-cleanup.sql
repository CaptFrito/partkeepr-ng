-- PartUnit cleanup: drop the vestigial Reel / Cut Tape rows.
--
-- The PartUnit table is meant to be the unit-of-measurement for
-- `Part.stockLevel` ("how many of <unit> do you have?"). It got
-- populated historically with reel/cut-tape sizes (8mm/12mm/16mm/
-- 24mm × Reel/CutTape) when there was no other way to record
-- container form on a part. PartStorageLocation.form now captures
-- that per physical container (slice 13b), making the reel/cut-
-- tape PartUnit rows redundant and confusing.
--
-- Adds proper non-electronic measurement units (Metres, Litres,
-- Kilograms, etc.) so the lookup can serve the broader inventory
-- (mechanical, automotive, tools, supplies).
--
-- Idempotent: skip rows already deleted, INSERT IGNORE on the
-- new ones (UNIQUE on name).
--
-- Apply with:
--   mariadb -u partkeepr_dev -p... partkeepr_dev \
--     < scripts/migrations/partunit-cleanup.sql

-- 1. Repoint any Part still using a reel/cut-tape PartUnit to
--    Pieces (id 1). Container form is now in PartStorageLocation.

UPDATE Part p
JOIN PartUnit pu ON pu.id = p.partUnit_id
SET p.partUnit_id = 1
WHERE pu.name LIKE '%Parts Reel'
   OR pu.name LIKE '%Cut Tape';

-- 2. Delete the eight vestigial rows. The UPDATE above guarantees
--    no Part references them, so this won't FK-violate.

DELETE FROM PartUnit
WHERE name IN (
     '8mm Parts Reel',
    '12mm Parts Reel',
    '16mm Parts Reel',
    '24mm Parts Reel',
     '8mm Cut Tape',
    '12mm Cut Tape',
    '16mm Cut Tape',
    '24mm Cut Tape'
);

-- 3. Seed proper measurement units for non-electronic inventory.
--    INSERT IGNORE relies on UNIQUE on name (or just no-ops on
--    duplicate-key error if name isn't unique). PartUnit table in
--    PartKeepr 1.4.0 has no UNIQUE on name so we guard via NOT EXISTS.

INSERT INTO PartUnit (name, shortName, is_default)
SELECT * FROM (
    SELECT 'Metres'      AS n, 'm'   AS s, 0 AS d UNION ALL
    SELECT 'Centimetres',     'cm',     0 UNION ALL
    SELECT 'Litres',          'L',      0 UNION ALL
    SELECT 'Millilitres',     'mL',     0 UNION ALL
    SELECT 'Kilograms',       'kg',     0 UNION ALL
    SELECT 'Grams',           'g',      0 UNION ALL
    SELECT 'Pairs',           'pr',     0 UNION ALL
    SELECT 'Sets',            'set',    0
) AS new_units
WHERE NOT EXISTS (
    SELECT 1 FROM PartUnit pu WHERE pu.name = new_units.n
);

-- 4. Report final state.

SELECT id, name, shortName, is_default
FROM PartUnit
ORDER BY is_default DESC, name;

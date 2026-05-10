-- Slice 10c-1: per-user attribution backfill
--
-- Adds a "system" PartKeeprUser row, then assigns it to every Project
-- and StockEntry that currently has user_id IS NULL (everything written
-- by partkeepr-ng before slice 10c, plus any legacy-import gaps).
--
-- Idempotent: safe to re-run. Uses INSERT ... WHERE NOT EXISTS for the
-- system row and UPDATE ... WHERE user_id IS NULL for the backfill.
--
-- Run against partkeepr_dev (cutover: against prod copy, post import,
-- pre service start).

INSERT INTO PartKeeprUser (username, password, admin, lastSeen, provider_id,
                           email, legacy, active, protected)
  SELECT 'system', NULL, 0, NULL, 1, NULL, 0, 0, 1
  FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM PartKeeprUser WHERE username = 'system');

SET @sysid := (SELECT id FROM PartKeeprUser WHERE username = 'system');

UPDATE StockEntry SET user_id = @sysid WHERE user_id IS NULL;
UPDATE Project    SET user_id = @sysid WHERE user_id IS NULL;

SELECT @sysid AS system_user_id,
       (SELECT COUNT(*) FROM StockEntry WHERE user_id IS NULL) AS stock_null_after,
       (SELECT COUNT(*) FROM Project    WHERE user_id IS NULL) AS project_null_after;

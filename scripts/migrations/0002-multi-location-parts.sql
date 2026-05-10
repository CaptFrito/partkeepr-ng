-- Multi-location parts (PartStorageLocation join table).
--
-- Adds a per-part breakdown of where stock physically lives — loose
-- in a bin, on a reel, mounted to a P&P feeder, etc. Existing
-- `Part.storageLocation_id` and `Part.stockLevel` continue to be the
-- "primary location" + "total on hand"; this table is descriptive,
-- kept in sync by the operator. See plan: docs of W7c.X for the
-- rationale (descriptive-only v1).
--
-- Idempotent: re-runnable without effect if the table already exists.
-- Apply with:
--   mariadb -u partkeepr_dev -p... partkeepr_dev \
--     < scripts/migrations/multi-location-parts.sql

CREATE TABLE IF NOT EXISTS PartStorageLocation (
    id                  INT(11) NOT NULL AUTO_INCREMENT,
    part_id             INT(11) NOT NULL,
    storageLocation_id  INT(11) NOT NULL,
    form                ENUM('Loose','Reel','CutTape','Tray','Tube',
                             'Feeder','Bag','Other')
                        NOT NULL DEFAULT 'Loose',
    quantity            INT(11) NOT NULL DEFAULT 0,
    lotNumber           VARCHAR(255) DEFAULT NULL,
    comment             TEXT DEFAULT NULL,
    created             DATETIME DEFAULT NULL,
    lastModified        DATETIME DEFAULT NULL,
    user_id             INT(11) DEFAULT NULL,
    PRIMARY KEY (id),
    KEY IDX_PSL_part (part_id),
    KEY IDX_PSL_loc  (storageLocation_id),
    CONSTRAINT FK_PSL_part FOREIGN KEY (part_id)
      REFERENCES Part (id) ON DELETE CASCADE,
    CONSTRAINT FK_PSL_loc  FOREIGN KEY (storageLocation_id)
      REFERENCES StorageLocation (id),
    CONSTRAINT FK_PSL_user FOREIGN KEY (user_id)
      REFERENCES PartKeeprUser (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

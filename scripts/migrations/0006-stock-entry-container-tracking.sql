-- Slice 13c: tie each StockEntry to the specific PartStorageLocation
-- row it added to / drew from. Nullable for back-compat: legacy entries
-- (pre-2026-05-09) keep NULL, new entries from add/remove flows populate
-- it. Combined with the auto-update of PartStorageLocation.quantity in
-- the handler, this gives shop-floor accuracy for "which reel did this
-- 50-piece draw come from?" without breaking the existing aggregate
-- Part.stockLevel accounting.
--
-- Why nullable: existing 1036 StockEntry rows pre-date PartStorageLocation
-- and there is no reliable way to retroactively assign them to specific
-- containers. Leaving them NULL preserves history without inventing
-- attributions that would be wrong half the time.
--
-- ON DELETE SET NULL: deleting a PartStorageLocation row should not
-- cascade-delete the StockEntry history; the audit trail outlives the
-- container. The FK is maintained so we can still join when present.

ALTER TABLE StockEntry
  ADD COLUMN partStorageLocation_id INT(11) DEFAULT NULL AFTER salesOrderNumber;

ALTER TABLE StockEntry
  ADD KEY idx_se_psl (partStorageLocation_id);

ALTER TABLE StockEntry
  ADD CONSTRAINT fk_StockEntry_psl
    FOREIGN KEY (partStorageLocation_id)
    REFERENCES PartStorageLocation (id)
    ON DELETE SET NULL;

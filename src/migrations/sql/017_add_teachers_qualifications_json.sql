ALTER TABLE `teachers`
  ADD COLUMN `qualifications` json DEFAULT NULL AFTER `pg_university`;

-- Backfill from legacy single-value column.
UPDATE `teachers`
SET `qualifications` =
  CASE
    WHEN `qualification` IS NULL OR TRIM(`qualification`) = '' THEN JSON_ARRAY()
    ELSE JSON_ARRAY(TRIM(`qualification`))
  END
WHERE `qualifications` IS NULL;


-- Add area_of_interest as multi-value JSON field.

SET @exist_area_of_interest := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'teachers'
    AND COLUMN_NAME = 'area_of_interest'
);
SET @sql_area_of_interest := IF(@exist_area_of_interest = 0,
  'ALTER TABLE teachers ADD COLUMN area_of_interest json DEFAULT NULL AFTER subjects_taught',
  'SELECT 1'
);
PREPARE _add_area_of_interest FROM @sql_area_of_interest;
EXECUTE _add_area_of_interest;
DEALLOCATE PREPARE _add_area_of_interest;


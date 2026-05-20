SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'teachers'
    AND COLUMN_NAME = 'additional_education'
);
SET @sql := IF(@exist = 0,
  'ALTER TABLE teachers ADD COLUMN additional_education JSON DEFAULT NULL AFTER certifications',
  'SELECT 1');
PREPARE _add_additional_education FROM @sql;
EXECUTE _add_additional_education;
DEALLOCATE PREPARE _add_additional_education;

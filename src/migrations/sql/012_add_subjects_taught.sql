-- Add subjects_taught as multi-value JSON field.

SET @exist_subjects_taught := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'teachers'
    AND COLUMN_NAME = 'subjects_taught'
);
SET @sql_subjects_taught := IF(@exist_subjects_taught = 0,
  'ALTER TABLE teachers ADD COLUMN subjects_taught json DEFAULT NULL AFTER certifications',
  'SELECT 1'
);
PREPARE _add_subjects_taught FROM @sql_subjects_taught;
EXECUTE _add_subjects_taught;
DEALLOCATE PREPARE _add_subjects_taught;


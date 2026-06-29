-- Ensure teachers.custom_fields exists (JSON object).
-- It may have been dropped by older destructive migrations.

SET @exist_custom_fields := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'teachers'
    AND COLUMN_NAME = 'custom_fields'
);

SET @sql_custom_fields := IF(
  @exist_custom_fields = 0,
  'ALTER TABLE teachers ADD COLUMN custom_fields json DEFAULT NULL AFTER internal_notes',
  'SELECT 1'
);

PREPARE _add_custom_fields FROM @sql_custom_fields;
EXECUTE _add_custom_fields;
DEALLOCATE PREPARE _add_custom_fields;


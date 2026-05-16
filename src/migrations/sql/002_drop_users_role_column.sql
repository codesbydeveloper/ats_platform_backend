SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'role'
);
SET @sql := IF(@exist > 0, 'ALTER TABLE users DROP COLUMN role', 'SELECT 1');
PREPARE _drop_role FROM @sql;
EXECUTE _drop_role;
DEALLOCATE PREPARE _drop_role;

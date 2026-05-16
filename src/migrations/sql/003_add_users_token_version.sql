SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'token_version'
);
SET @sql := IF(@exist = 0,
  'ALTER TABLE users ADD COLUMN token_version INT UNSIGNED NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE _add_token_version FROM @sql;
EXECUTE _add_token_version;
DEALLOCATE PREPARE _add_token_version;

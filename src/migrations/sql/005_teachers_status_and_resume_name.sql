SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'teachers'
    AND COLUMN_NAME = 'status'
);
SET @sql := IF(@exist = 0,
  "ALTER TABLE teachers ADD COLUMN status varchar(20) NOT NULL DEFAULT 'active'",
  'SELECT 1');
PREPARE _add_status FROM @sql;
EXECUTE _add_status;
DEALLOCATE PREPARE _add_status;

SET @exist2 := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'teachers'
    AND COLUMN_NAME = 'resume_original_name'
);
SET @sql2 := IF(@exist2 = 0,
  'ALTER TABLE teachers ADD COLUMN resume_original_name varchar(512) DEFAULT NULL',
  'SELECT 1');
PREPARE _add_resume_name FROM @sql2;
EXECUTE _add_resume_name;
DEALLOCATE PREPARE _add_resume_name;

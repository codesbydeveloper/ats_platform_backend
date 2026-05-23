CREATE TABLE IF NOT EXISTS `teacher_form_config` (
  `id` tinyint unsigned NOT NULL DEFAULT '1',
  `config` json NOT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exist := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'teachers'
    AND COLUMN_NAME = 'custom_fields'
);
SET @sql := IF(
  @exist = 0,
  'ALTER TABLE teachers ADD COLUMN custom_fields json DEFAULT NULL AFTER internal_notes',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

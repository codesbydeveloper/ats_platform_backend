-- Add additional teacher profile fields (non-destructive).
-- - country: scalar
-- - reason_to_join: JSON array of strings
-- - where_did_you_hear_about_us: JSON array of strings
-- - subjects_taught: JSON array of strings (keep legacy subject_taught varchar)
-- - area_of_interest: JSON array of strings (keep legacy area_of_interest varchar)

SET @exist_country := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'teachers'
    AND COLUMN_NAME = 'country'
);
SET @sql_country := IF(@exist_country = 0,
  "ALTER TABLE teachers ADD COLUMN country varchar(128) NOT NULL DEFAULT '' AFTER address",
  'SELECT 1'
);
PREPARE _add_country FROM @sql_country;
EXECUTE _add_country;
DEALLOCATE PREPARE _add_country;

SET @exist_subjects := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'teachers'
    AND COLUMN_NAME = 'subjects_taught'
);
SET @sql_subjects := IF(@exist_subjects = 0,
  'ALTER TABLE teachers ADD COLUMN subjects_taught json DEFAULT NULL AFTER subject_taught',
  'SELECT 1'
);
PREPARE _add_subjects_taught FROM @sql_subjects;
EXECUTE _add_subjects_taught;
DEALLOCATE PREPARE _add_subjects_taught;

SET @exist_areas := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'teachers'
    AND COLUMN_NAME = 'area_of_interest'
);
SET @sql_areas := IF(@exist_areas = 0,
  'ALTER TABLE teachers ADD COLUMN area_of_interest json DEFAULT NULL AFTER area_of_interest',
  'SELECT 1'
);
PREPARE _add_area_of_interest FROM @sql_areas;
EXECUTE _add_area_of_interest;
DEALLOCATE PREPARE _add_area_of_interest;

SET @exist_reason := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'teachers'
    AND COLUMN_NAME = 'reason_to_join'
);
SET @sql_reason := IF(@exist_reason = 0,
  'ALTER TABLE teachers ADD COLUMN reason_to_join json DEFAULT NULL AFTER preferred_location',
  'SELECT 1'
);
PREPARE _add_reason_to_join FROM @sql_reason;
EXECUTE _add_reason_to_join;
DEALLOCATE PREPARE _add_reason_to_join;

SET @exist_where := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'teachers'
    AND COLUMN_NAME = 'where_did_you_hear_about_us'
);
SET @sql_where := IF(@exist_where = 0,
  'ALTER TABLE teachers ADD COLUMN where_did_you_hear_about_us json DEFAULT NULL AFTER reason_to_join',
  'SELECT 1'
);
PREPARE _add_where_did_you_hear_about_us FROM @sql_where;
EXECUTE _add_where_did_you_hear_about_us;
DEALLOCATE PREPARE _add_where_did_you_hear_about_us;


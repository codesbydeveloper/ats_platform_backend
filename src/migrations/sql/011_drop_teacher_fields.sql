-- Drop teacher fields that are no longer needed (destructive).
-- Removes:
-- - additional_education
-- - subject_taught + subjects_taught
-- - area_of_interest + area_of_interest
-- - custom_fields

SET @exist_additional_education := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'teachers'
    AND COLUMN_NAME = 'additional_education'
);
SET @sql_additional_education := IF(@exist_additional_education = 1,
  'ALTER TABLE teachers DROP COLUMN additional_education',
  'SELECT 1'
);
PREPARE _drop_additional_education FROM @sql_additional_education;
EXECUTE _drop_additional_education;
DEALLOCATE PREPARE _drop_additional_education;

SET @exist_subject_taught := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'teachers'
    AND COLUMN_NAME = 'subject_taught'
);
SET @sql_subject_taught := IF(@exist_subject_taught = 1,
  'ALTER TABLE teachers DROP COLUMN subject_taught',
  'SELECT 1'
);
PREPARE _drop_subject_taught FROM @sql_subject_taught;
EXECUTE _drop_subject_taught;
DEALLOCATE PREPARE _drop_subject_taught;

SET @exist_subjects_taught := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'teachers'
    AND COLUMN_NAME = 'subjects_taught'
);
SET @sql_subjects_taught := IF(@exist_subjects_taught = 1,
  'ALTER TABLE teachers DROP COLUMN subjects_taught',
  'SELECT 1'
);
PREPARE _drop_subjects_taught FROM @sql_subjects_taught;
EXECUTE _drop_subjects_taught;
DEALLOCATE PREPARE _drop_subjects_taught;

SET @exist_area_of_interest := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'teachers'
    AND COLUMN_NAME = 'area_of_interest'
);
SET @sql_area_of_interest := IF(@exist_area_of_interest = 1,
  'ALTER TABLE teachers DROP COLUMN area_of_interest',
  'SELECT 1'
);
PREPARE _drop_area_of_interest FROM @sql_area_of_interest;
EXECUTE _drop_area_of_interest;
DEALLOCATE PREPARE _drop_area_of_interest;

SET @exist_area_of_interest := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'teachers'
    AND COLUMN_NAME = 'area_of_interest'
);
SET @sql_area_of_interest := IF(@exist_area_of_interest = 1,
  'ALTER TABLE teachers DROP COLUMN area_of_interest',
  'SELECT 1'
);
PREPARE _drop_area_of_interest FROM @sql_area_of_interest;
EXECUTE _drop_area_of_interest;
DEALLOCATE PREPARE _drop_area_of_interest;

SET @exist_custom_fields := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'teachers'
    AND COLUMN_NAME = 'custom_fields'
);
SET @sql_custom_fields := IF(@exist_custom_fields = 1,
  'ALTER TABLE teachers DROP COLUMN custom_fields',
  'SELECT 1'
);
PREPARE _drop_custom_fields FROM @sql_custom_fields;
EXECUTE _drop_custom_fields;
DEALLOCATE PREPARE _drop_custom_fields;


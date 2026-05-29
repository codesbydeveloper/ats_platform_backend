-- Add OTP-based password reset fields to users.

SET @exist_hash := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'reset_otp_hash'
);
SET @sql_hash := IF(@exist_hash = 0,
  'ALTER TABLE users ADD COLUMN reset_otp_hash varchar(255) DEFAULT NULL',
  'SELECT 1'
);
PREPARE _add_reset_otp_hash FROM @sql_hash;
EXECUTE _add_reset_otp_hash;
DEALLOCATE PREPARE _add_reset_otp_hash;

SET @exist_exp := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'reset_otp_expires_at'
);
SET @sql_exp := IF(@exist_exp = 0,
  'ALTER TABLE users ADD COLUMN reset_otp_expires_at datetime DEFAULT NULL',
  'SELECT 1'
);
PREPARE _add_reset_otp_expires FROM @sql_exp;
EXECUTE _add_reset_otp_expires;
DEALLOCATE PREPARE _add_reset_otp_expires;

SET @exist_attempts := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'reset_otp_attempts'
);
SET @sql_attempts := IF(@exist_attempts = 0,
  'ALTER TABLE users ADD COLUMN reset_otp_attempts int unsigned NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE _add_reset_otp_attempts FROM @sql_attempts;
EXECUTE _add_reset_otp_attempts;
DEALLOCATE PREPARE _add_reset_otp_attempts;

SET @exist_sent := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'reset_otp_sent_at'
);
SET @sql_sent := IF(@exist_sent = 0,
  'ALTER TABLE users ADD COLUMN reset_otp_sent_at datetime DEFAULT NULL',
  'SELECT 1'
);
PREPARE _add_reset_otp_sent_at FROM @sql_sent;
EXECUTE _add_reset_otp_sent_at;
DEALLOCATE PREPARE _add_reset_otp_sent_at;


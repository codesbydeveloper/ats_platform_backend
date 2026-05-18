CREATE TABLE IF NOT EXISTS `activity_logs` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `message` varchar(512) NOT NULL,
  `entity_type` varchar(64) DEFAULT NULL,
  `entity_id` int unsigned DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `activity_logs_created_at_idx` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

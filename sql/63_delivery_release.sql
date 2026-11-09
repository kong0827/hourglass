USE hourglass;

DROP PROCEDURE IF EXISTS hg_delivery_column;
DELIMITER $$
CREATE PROCEDURE hg_delivery_column(IN table_name_value VARCHAR(64), IN column_name_value VARCHAR(64), IN definition_value TEXT)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = DATABASE() AND table_name = table_name_value AND column_name = column_name_value) THEN
    SET @delivery_ddl = CONCAT('ALTER TABLE `', table_name_value, '` ADD COLUMN `', column_name_value, '` ', definition_value);
    PREPARE delivery_stmt FROM @delivery_ddl;
    EXECUTE delivery_stmt;
    DEALLOCATE PREPARE delivery_stmt;
  END IF;
END$$
DELIMITER ;

CALL hg_delivery_column('demand', 'planned_start', 'DATE NULL');
CALL hg_delivery_column('demand', 'planned_end', 'DATE NULL');
CALL hg_delivery_column('demand', 'revision', 'BIGINT NOT NULL DEFAULT 0');
CALL hg_delivery_column('demand_log', 'change_data', 'JSON NULL');
CALL hg_delivery_column('project_version', 'revision', 'BIGINT NOT NULL DEFAULT 0');
CALL hg_delivery_column('task', 'published_at', 'DATE NULL');
CALL hg_delivery_column('task', 'publish_source', 'VARCHAR(16) NULL');
CALL hg_delivery_column('task', 'published_release_id', 'VARCHAR(32) NULL');
CALL hg_delivery_column('task_log', 'change_data', 'JSON NULL');
DROP PROCEDURE hg_delivery_column;

CREATE TABLE IF NOT EXISTS `version_release_plan` (
  `id` varchar(32) NOT NULL,
  `workspace_id` varchar(32) NOT NULL,
  `version_id` varchar(32) NOT NULL,
  `planned_at` datetime DEFAULT NULL,
  `owner_user_id` varchar(32) DEFAULT NULL,
  `notes` varchar(2000) DEFAULT NULL,
  `risks` varchar(1000) DEFAULT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'draft',
  `revision` bigint NOT NULL DEFAULT 0,
  `scope_token` varchar(64) DEFAULT NULL,
  `environment` varchar(16) NOT NULL,
  `target_keys` json NOT NULL,
  `coverage` varchar(16) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_plan_workspace` (`id`,`workspace_id`),
  KEY `idx_plan_version` (`workspace_id`,`version_id`),
  KEY `idx_plan_workspace` (`workspace_id`,`status`),
  CONSTRAINT `fk_plan_version` FOREIGN KEY (`version_id`) REFERENCES `project_version` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- New-installation referential identity index, no record changes or backfill.
DROP PROCEDURE IF EXISTS hg_release_identity_index;
DELIMITER $$
CREATE PROCEDURE hg_release_identity_index()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'task' AND index_name = 'uk_task_release_workspace') THEN
    ALTER TABLE `task` ADD UNIQUE KEY `uk_task_release_workspace` (`id`,`workspace_id`);
  END IF;
END$$
DELIMITER ;
CALL hg_release_identity_index();
DROP PROCEDURE hg_release_identity_index;

CREATE TABLE IF NOT EXISTS `version_release_plan_task` (
  `workspace_id` varchar(32) NOT NULL,
  `plan_id` varchar(32) NOT NULL,
  `task_id` varchar(32) NOT NULL,
  PRIMARY KEY (`plan_id`,`task_id`),
  KEY `idx_plan_task_workspace` (`task_id`,`workspace_id`),
  CONSTRAINT `fk_plan_task_plan` FOREIGN KEY (`plan_id`,`workspace_id`) REFERENCES `version_release_plan` (`id`,`workspace_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_plan_task_task` FOREIGN KEY (`task_id`,`workspace_id`) REFERENCES `task` (`id`,`workspace_id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `version_release` (
  `id` varchar(32) NOT NULL,
  `workspace_id` varchar(32) NOT NULL,
  `req_id` varchar(32) NOT NULL,
  `version_id` varchar(32) NOT NULL,
  `plan_id` varchar(32) DEFAULT NULL,
  `plan_revision` bigint DEFAULT NULL,
  `occurred_at` datetime(6) NOT NULL,
  `environment` varchar(16) NOT NULL,
  `target_keys` json NOT NULL,
  `coverage` varchar(16) NOT NULL,
  `artifact_ref` varchar(500) NOT NULL,
  `artifact_digest` varchar(64) NOT NULL,
  `operation` varchar(16) NOT NULL,
  `related_release_id` varchar(32) DEFAULT NULL,
  `executor_user_id` varchar(32) NOT NULL,
  `executor_name` varchar(50) NOT NULL,
  `deviation_reason` varchar(1000) DEFAULT NULL,
  `result` varchar(8) NOT NULL,
  `published_on` date DEFAULT NULL,
  `recorded_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `released_by` varchar(32) NOT NULL,
  `released_by_name` varchar(50) NOT NULL,
  `version_name` varchar(40) NOT NULL,
  `project_name` varchar(40) NOT NULL,
  `notes` varchar(2000) DEFAULT NULL,
  `failure_reason` varchar(1000) DEFAULT NULL,
  `published_count` int NOT NULL DEFAULT 0,
  `excluded_count` int NOT NULL DEFAULT 0,
  `idempotency_key` varchar(64) NOT NULL,
  `request_hash` varchar(64) NOT NULL,
  `plan_snapshot` json NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_release_workspace` (`id`,`workspace_id`),
  UNIQUE KEY `uk_release_request` (`workspace_id`,`version_id`,`idempotency_key`),
  KEY `idx_release_project` (`workspace_id`,`req_id`,`occurred_at`),
  CONSTRAINT `fk_release_plan` FOREIGN KEY (`plan_id`,`workspace_id`) REFERENCES `version_release_plan` (`id`,`workspace_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_release_related` FOREIGN KEY (`related_release_id`,`workspace_id`) REFERENCES `version_release` (`id`,`workspace_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_release_version` FOREIGN KEY (`version_id`) REFERENCES `project_version` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_release_project` FOREIGN KEY (`req_id`) REFERENCES `requirement` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `version_release_item` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `workspace_id` varchar(32) NOT NULL,
  `release_id` varchar(32) NOT NULL,
  `task_id` varchar(32) NOT NULL,
  `title` varchar(60) NOT NULL,
  `item_type` varchar(16) NOT NULL,
  `owner_user_id` varchar(32) DEFAULT NULL,
  `owner_name` varchar(32) DEFAULT NULL,
  `demand_id` varchar(32) DEFAULT NULL,
  `demand_title` varchar(80) DEFAULT NULL,
  `target_version_id` varchar(32) DEFAULT NULL,
  `target_version_name` varchar(40) DEFAULT NULL,
  `board_column` varchar(32) DEFAULT NULL,
  `completed_at` date DEFAULT NULL,
  `disposition` varchar(24) NOT NULL,
  `reason` varchar(1000) DEFAULT NULL,
  `content_summary` varchar(2000) DEFAULT NULL,
  `work_minutes` int NOT NULL DEFAULT 0,
  `estimate_minutes` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_release_task` (`release_id`,`task_id`),
  KEY `idx_release_task_history` (`workspace_id`,`task_id`),
  KEY `idx_release_demand` (`workspace_id`,`demand_id`),
  CONSTRAINT `fk_release_item_record` FOREIGN KEY (`release_id`,`workspace_id`) REFERENCES `version_release` (`id`,`workspace_id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `version_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `workspace_id` varchar(32) NOT NULL,
  `version_id` varchar(32) NOT NULL,
  `action` varchar(32) NOT NULL,
  `actor_id` varchar(32) NOT NULL,
  `reason` varchar(500) DEFAULT NULL,
  `change_data` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_version_log` (`workspace_id`,`version_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

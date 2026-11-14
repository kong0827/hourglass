-- ============================================================================
-- 79_version_commitment.sql · 版本承诺基线（2026-11-14）
--
-- 版本开始开发时冻结当时的工作项与预估，后续只读对比，不随范围变化回写。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/79_version_commitment.sql
-- 可重复执行；只增列 / 建表，不回填历史版本。
-- ============================================================================

USE hourglass;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `project_version` ADD COLUMN `commitment_at` DATETIME NULL COMMENT ''开始开发时的承诺基线快照时间'' AFTER `end_reason`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'project_version' AND column_name = 'commitment_at');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

CREATE TABLE IF NOT EXISTS `version_commitment_task` (
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `version_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_title` varchar(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `estimate_minutes` int DEFAULT NULL,
  PRIMARY KEY (`workspace_id`, `version_id`, `task_id`),
  KEY `idx_ws_version` (`workspace_id`, `version_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='版本承诺基线任务快照';

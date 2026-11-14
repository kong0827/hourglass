-- ============================================================================
-- 78_version_end_state.sql · 版本终态（关闭 / 取消）与结束原因（2026-11-14）
--
-- 关闭（不再发布）与取消（作废）都保留历史，必须记录原因与时间。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/78_version_end_state.sql
-- 可重复执行；只增列，不回填历史版本。
-- ============================================================================

USE hourglass;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `project_version` ADD COLUMN `ended_at` DATETIME NULL COMMENT ''关闭或取消时间'' AFTER `released_at`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'project_version' AND column_name = 'ended_at');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `project_version` ADD COLUMN `end_reason` VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT ''关闭或取消原因'' AFTER `ended_at`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'project_version' AND column_name = 'end_reason');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

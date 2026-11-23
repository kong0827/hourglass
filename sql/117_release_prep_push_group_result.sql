-- ============================================================================
-- 117_release_prep_push_group_result.sql · 推送批次记录企业微信群结果（2026-11-21）
--
-- 群消息按空间群发送，不能按人回执；但管理者需要知道这一批到底发没发出去。
-- 给 version_release_plan_push 增加 group_sent / group_error，发送后回写：
--   group_sent = 1  已发送
--   group_sent = 0  未发送，group_error 记录原因（未配置、机器人失败等）
--   group_sent = NULL 本批次未选择群渠道，或历史批次没有记录
--
-- 执行：mysql -u hourglass -p --default-character-set=utf8mb4 hourglass < sql/117_release_prep_push_group_result.sql
-- 可重复执行；只增可空列，不回填。
-- ============================================================================

USE hourglass;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `version_release_plan_push` ADD COLUMN `group_sent` tinyint(1) NULL COMMENT ''企业微信群是否发送成功：1成功 / 0失败 / NULL未选群或历史未记录'' AFTER `recipient_count`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'version_release_plan_push' AND COLUMN_NAME = 'group_sent');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `version_release_plan_push` ADD COLUMN `group_error` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT ''企业微信群未发送原因（最多200字）'' AFTER `group_sent`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'version_release_plan_push' AND COLUMN_NAME = 'group_error');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

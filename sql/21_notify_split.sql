-- ============================================================================
-- 站内通知与外部推送开关拆分（2026-11-01，BUG-12）
--
-- 背景：此前「启用本空间的推送」同时控制站内汇总与外部渠道；
--       关闭外部推送后站内汇总也一起停发，而任务级站内提醒却不受影响，口径不一致。
--       现在外部渠道沿用 notify_enabled，站内通知单独用 notify_in_app_enabled。
--
-- 默认值：NULL = 启用站内通知。站内提醒/每日汇总不再受外部 notify_enabled 影响；
--        这是有意的行为变化：关闭外部推送后，站内提醒仍会送达。
--        若不希望升级后默认开启站内汇总，可在迁移后执行（会同时关闭任务级站内提醒）：
--        UPDATE workspace SET notify_in_app_enabled = 0 WHERE notify_in_app_enabled IS NULL;
--
-- 幂等：先查 information_schema，再决定是否 ALTER，可重复执行。
-- ============================================================================

USE hourglass;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workspace'
             AND COLUMN_NAME = 'notify_in_app_enabled');
SET @s := IF(@x = 0,
  'ALTER TABLE workspace ADD COLUMN notify_in_app_enabled TINYINT(1) NULL AFTER notify_enabled',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 自检：应看到 notify_enabled 与 notify_in_app_enabled 两列
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'workspace'
  AND COLUMN_NAME IN ('notify_enabled', 'notify_in_app_enabled');

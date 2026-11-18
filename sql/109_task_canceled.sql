-- ============================================================================
-- 109_task_canceled.sql · 工作项终态「已取消」（2026-11-18）
--
-- 背景：
--   工作项只有「在哪儿做」的列模型，没有「不做了」的终局。软删除进回收站后不可检索、
--   不可统计；阻塞只是进行中的卡点标记。设计见 docs/工作项终态模型设计-2026-11-18.md。
--
-- 口径：
--   board_column = 'canceled' 表示终态，不新增状态字段、不新增看板列配置。
--   只加 3 个可空列承载取消元数据：
--     cancel_reason  取消原因码（not_do / dup / deferred / design）
--     cancel_from    取消前所在列（恢复时回到该列，列已删除则回第一个开列）
--     canceled_at    取消时间（不回填历史数据）
--   恢复时清空三列并把 board_column 写回 cancel_from。
--
-- 边界：
--   不建索引、不改 task_log；MySQL 8 走 INSTANT 加列，不重写表。
--   已取消工作项不计逾期、退出完成率分母、退出需求完成分母、不进发布候选。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/109_task_canceled.sql
-- ============================================================================

USE hourglass;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `task` ADD COLUMN `cancel_reason` varchar(16) NULL COMMENT ''取消原因码：not_do/dup/deferred/design''',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'cancel_reason');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `task` ADD COLUMN `cancel_from` varchar(64) NULL COMMENT ''取消前所在列 id（恢复目标）''',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'cancel_from');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `task` ADD COLUMN `canceled_at` datetime NULL COMMENT ''取消时间''',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'canceled_at');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

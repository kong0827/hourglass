-- ============================================================================
-- 114_test_plan_executor.sql · 测试计划执行人（2026-11-20）
--
-- 背景：
--   项目级已有「可测试」权限（project_member.access = 'test'），但测试计划没有
--   负责人字段：「我的工作 → 待我执行」无法按人收敛，只能靠成员自己去测试页翻。
--
-- 口径：
--   新增可空列 executor_user_id（账号ID）。空 = 未指派，不进入任何人的
--   「待我执行」，计划仍按项目测试权限协作；指派后只通知被指派人。
--   执行人是展示/排队口径，不改变权限：能否执行仍取决于项目是否可测试。
--
-- 边界：
--   只加一个可空列与一条索引，不回填历史计划，不迁移数据。
--   计划换项目时不自动清空执行人（与需求评审人一致，由用户维护）。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/114_test_plan_executor.sql
-- 可重复执行；只增列，不迁移历史数据。
-- ============================================================================

USE hourglass;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `test_plan` ADD COLUMN `executor_user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT ''执行人账号ID（空=未指派，不进「待我执行」）''',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'test_plan' AND COLUMN_NAME = 'executor_user_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `test_plan` ADD KEY `idx_ws_executor` (`workspace_id`, `executor_user_id`, `status`)',
  'DO 0')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'test_plan' AND INDEX_NAME = 'idx_ws_executor');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

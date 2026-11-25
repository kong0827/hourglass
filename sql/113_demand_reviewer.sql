-- ============================================================================
-- 113_demand_reviewer.sql · 需求评审人（2026-11-20）
--
-- 背景：
--   「我的工作 → 待我评审」原先是「所有可写项目、状态 review、排除本人提交」
--   的公共队列，同一批可写成员看到完全相同的列表；需求本身没有评审人字段，
--   管理员首屏可能一次出现几十条，无法判断哪条该自己处理，也无法按人通知。
--
-- 口径：
--   新增可空列 reviewer_user_id（账号ID）。指派后「待我评审」优先展示指派给
--   本人的需求；未指派的需求仍按原「项目写权限」规则进入公共可认领队列，
--   不改变既有权限：能通过/拒绝的仍是该项目的可写成员。
--   指派仅通知被指派人，不影响提交人与提醒人的既有通知。
--
-- 边界：
--   只加一个可空列与一条索引，不改历史数据、不回填。存量需求全部视为未指派，
--   继续走公共队列；需求换项目时不自动清空评审人（与责任人语义一致，由用户维护）。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/113_demand_reviewer.sql
-- 可重复执行；只增列，不迁移历史数据。
-- ============================================================================

USE hourglass;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `demand` ADD COLUMN `reviewer_user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT ''评审人账号ID（空=未指派，进入公共可认领队列）''',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demand' AND COLUMN_NAME = 'reviewer_user_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `demand` ADD KEY `idx_ws_reviewer` (`workspace_id`, `reviewer_user_id`, `status`)',
  'DO 0')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demand' AND INDEX_NAME = 'idx_ws_reviewer');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ============================================================================
-- 67_bug_regression_backfill.sql · 缺陷回归状态显式化回填（2026-11-11）
--
-- 背景：
--   缺陷 Tab 过去按「停在哪一列」推断是否待回归，无法区分「开发已提交修复」
--   与「还没开始修」。本次把 regression_status 作为唯一口径，由后端随列流转维护：
--     进入 待测试 / 测试中 → pending（开发已提交，等待回归）
--     进入 已完成         → passed （回归通过；完成与通过同时成立才算关闭）
--     退回 待处理 / 进行中 → failed （回归不通过，需要返工）
--
-- 本次：
--   只为存量缺陷补齐缺失的回归状态，已有 pending / passed / failed 一律不动。
--     test / testing 且为空 → pending
--     done           且为空 → passed
--   待处理 / 进行中的缺陷保持为空（尚未提交修复）。
--
-- 幂等：只更新 NULL / 空串，可重复执行。
-- 执行：mysql --default-character-set=utf8mb4 -u hourglass -p hourglass < sql/67_bug_regression_backfill.sql
-- ============================================================================

USE hourglass;

UPDATE `task`
SET `regression_status` = 'pending'
WHERE `item_type` = 'bug'
  AND `board_column` IN ('test', 'testing')
  AND (`regression_status` IS NULL OR `regression_status` = '');

UPDATE `task`
SET `regression_status` = 'passed'
WHERE `item_type` = 'bug'
  AND `board_column` = 'done'
  AND (`regression_status` IS NULL OR `regression_status` = '');

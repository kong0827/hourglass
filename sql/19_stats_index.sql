-- ============================================================================
-- 统计类服务 SQL 聚合所需索引（2026-10-31，BE-Q-3）
--
-- 幂等：先查 information_schema，再决定是否 ALTER，可重复执行。
-- 建议业务低峰执行；大表加索引会短暂占用 IO。
-- 前置：已执行 sql/17、sql/18（idx_ws_started、idx_ws_done_completed 等）。
-- ============================================================================

USE devstudio;

-- ---------------------------------------------------------------------------
-- 1. 报表「近 N 周新增」按 created_at 区间扫描
--    （完成侧走 sql/18 的 idx_ws_done_completed）
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND INDEX_NAME = 'idx_ws_created_at');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD KEY idx_ws_created_at (workspace_id, created_at)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 2. 估时统计：estimate_minutes > 0 的样本，避免把无预估的历史任务读进来
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND INDEX_NAME = 'idx_ws_estimate');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD KEY idx_ws_estimate (workspace_id, estimate_minutes)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 3. 项目进度一次 GROUP BY；AI 拆分 few-shot 按项目取标题
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND INDEX_NAME = 'idx_ws_req');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD KEY idx_ws_req (workspace_id, req_id)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 4. 甘特负载 / 估时样本：按 task_id 集合 + 时间区间的工时聚合
--    （idx_ws_started 只有 workspace+started_at，聚合时仍要回表按 task_id 过滤）
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'time_log' AND INDEX_NAME = 'idx_ws_task_started');
SET @s := IF(@x = 0,
  'ALTER TABLE time_log ADD KEY idx_ws_task_started (workspace_id, task_id, started_at)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 5. 周回顾历史周期：任务条目的 EXISTS 活动判定
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_log' AND INDEX_NAME = 'idx_ws_task_created');
SET @s := IF(@x = 0,
  'ALTER TABLE task_log ADD KEY idx_ws_task_created (workspace_id, task_id, created_at)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 自检：应看到 5 条索引
SELECT TABLE_NAME, INDEX_NAME FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND INDEX_NAME IN ('idx_ws_created_at', 'idx_ws_estimate', 'idx_ws_req',
                     'idx_ws_task_started', 'idx_ws_task_created')
ORDER BY TABLE_NAME, INDEX_NAME;

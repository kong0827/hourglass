-- ============================================================================
-- 看板 / 列表查询下推所需索引（2026-10-31，BE-Q-1）
--
-- 幂等：先查 information_schema，再决定是否 ALTER，可重复执行。
-- 建议业务低峰执行；大表加索引会短暂占用 IO。
-- ============================================================================

USE devstudio;

-- ---------------------------------------------------------------------------
-- 1. 已完成列：doneScope 计数（完成时间区间）
--    分页本身按 sort_order 排序，继续走 idx_board (workspace, board_column, sort_order)
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND INDEX_NAME = 'idx_ws_done_completed');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD KEY idx_ws_done_completed (workspace_id, board_column, completed_at)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 2. 列表视图按更新时间排序
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND INDEX_NAME = 'idx_ws_updated');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD KEY idx_ws_updated (workspace_id, updated_at)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 3. 日历按月份区间（与 sql/16 的 idx_ws_due 同名；已存在时跳过）
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND INDEX_NAME = 'idx_ws_due');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD KEY idx_ws_due (workspace_id, due_date)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

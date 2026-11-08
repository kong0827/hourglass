USE hourglass;

-- ============================================================================
-- 49_comment_log_page_index.sql · 评论/需求日志游标分页索引（2026-11-07）
--
-- task_comment 按 (workspace_id, task_id) 过滤后 ORDER BY id DESC LIMIT；
-- demand_log 按 (workspace_id, demand_id) 过滤后 ORDER BY id DESC LIMIT。
-- 原索引不含 id，取最新一页时仍需回表排序；补复合索引让分页直接走索引顺序。
-- 幂等：先查 information_schema，可重复执行。
-- ============================================================================

SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_comment'
             AND INDEX_NAME = 'idx_ws_task_id');
SET @s := IF(@x = 0,
  'ALTER TABLE task_comment ADD KEY idx_ws_task_id (workspace_id, task_id, id)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demand_log'
             AND INDEX_NAME = 'idx_ws_demand_id');
SET @s := IF(@x = 0,
  'ALTER TABLE demand_log ADD KEY idx_ws_demand_id (workspace_id, demand_id, id)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

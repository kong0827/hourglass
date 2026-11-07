USE hourglass;

-- ============================================================================
-- 34_task_comment_ws_index.sql · 看板评论聚合索引（2026-11-04）
--
-- countCommentsByTask 按 workspace_id + task_id 分组；原索引只有
-- (task_id,id) 与 (workspace_id,id)，补 (workspace_id,task_id) 覆盖聚合。
-- 幂等，可重复执行。
-- ============================================================================

SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_comment' AND INDEX_NAME = 'idx_ws_task');
SET @s := IF(@x = 0,
  'ALTER TABLE task_comment ADD KEY idx_ws_task (workspace_id, task_id)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

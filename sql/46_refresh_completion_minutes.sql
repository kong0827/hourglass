-- ============================================================================
-- 完成快照按实际工时重算（一次性数据修复）
--
-- 背景：任务完成时会把总工时写进 task_completion_record（月/周统计读这份快照）。
--       补记、作废工时记录之后，代码会即时重算该任务的快照；本脚本负责把
--       历史上已经产生偏差的快照一次性对齐到 time_log 的实际工时。
--
-- 口径：total_minutes / first_started_at / last_ended_at 与完成时归档完全一致，
--       只取已结束的记录（ended_at IS NOT NULL），跨天记录仍按一条计入。
-- 范围：只重算「任务仍存在（未删除）」的快照；任务已彻底删除的历史快照保留原值，
--       避免因 time_log 随之清空而把历史工时抹成 0。
-- 幂等：可重复执行；不改 completed_at / 名称等快照字段。
-- ============================================================================
USE hourglass;

UPDATE task_completion_record r
JOIN task k
  ON k.id = r.task_id
 AND k.workspace_id = r.workspace_id
 AND k.deleted_at IS NULL
LEFT JOIN (
  SELECT workspace_id, task_id,
         SUM(minutes)       AS total_minutes,
         MIN(started_at)    AS first_started_at,
         MAX(ended_at)      AS last_ended_at
  FROM time_log
  WHERE ended_at IS NOT NULL
  GROUP BY workspace_id, task_id
) t
  ON t.workspace_id = r.workspace_id
 AND t.task_id = r.task_id
SET r.total_minutes    = COALESCE(t.total_minutes, 0),
    r.first_started_at = t.first_started_at,
    r.last_ended_at    = t.last_ended_at;

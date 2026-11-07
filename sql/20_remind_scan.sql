-- ============================================================================
-- 提醒扫描跨空间查询索引（2026-10-31，BE-RT-3）
--
-- 背景：remindScan 由「每 5 分钟遍历所有空间、每个空间 2 条 SQL」改为
--       「全库到期 / 全库已过窗口各一条 SQL」，查询不再带 workspace_id 前缀，
--       需要一条以 remind_sent 打头的索引来收窄扫描范围。
--       原有 idx_remind (remind_at, remind_sent) 仍可用于单空间/时间排序，
--       这里补一条覆盖跨空间提醒扫描的索引。
--
-- 幂等：先查 information_schema，再决定是否 ALTER，可重复执行。
-- 建议业务低峰执行；大表加索引会短暂占用 IO。
-- ============================================================================

USE hourglass;

SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND INDEX_NAME = 'idx_remind_scan');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD KEY idx_remind_scan (remind_sent, remind_at)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 自检：应看到 idx_remind_scan 与已有的 idx_remind
SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'task'
  AND INDEX_NAME IN ('idx_remind', 'idx_remind_scan')
ORDER BY INDEX_NAME, SEQ_IN_INDEX;

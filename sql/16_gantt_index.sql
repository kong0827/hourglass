-- ============================================================================
-- 甘特图 SQL 区间分页（2026-10-30）
--   1) 生成列 gantt_start / gantt_end：与前端“有效起止”口径一致（起止写反也取 min/max）
--   2) 覆盖区间查询 + 稳定排序的联合索引
--
-- MySQL 8；幂等，可被 deploy.sh --sql-all 重复执行。
-- ============================================================================

USE hourglass;

-- ---------------------------------------------------------------------------
-- 1. 生成列（STORED，ALTER 时自动为存量数据回填）
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'gantt_start');
SET @s := IF(@x = 0,
  'ALTER TABLE task
     ADD COLUMN gantt_start DATE GENERATED ALWAYS AS
       (LEAST(COALESCE(start_date, due_date), COALESCE(due_date, start_date))) STORED
       COMMENT ''有效开始日（min(start,due)，甘特区间索引用）'' AFTER due_date,
     ADD COLUMN gantt_end DATE GENERATED ALWAYS AS
       (GREATEST(COALESCE(start_date, due_date), COALESCE(due_date, start_date))) STORED
       COMMENT ''有效截止日（max(start,due)，甘特区间索引用）''',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 2. 覆盖「workspace + 未删除 + 区间 + 排序」的联合索引
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND INDEX_NAME = 'idx_gantt_range');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD KEY idx_gantt_range (workspace_id, deleted_at, gantt_start, gantt_end, id)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 3. 到期/逾期筛选常用索引
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND INDEX_NAME = 'idx_ws_due');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD KEY idx_ws_due (workspace_id, due_date)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

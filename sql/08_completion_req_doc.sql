-- ============================================================================
-- 工作台 · 任务完成快照补「关联需求」（2026-10-21）
--
-- 背景：任务清单需要显示"这条任务属于哪个需求"，并且点击能跳到需求正文。
--       和项目名一样，这里存的是**完成那一刻的快照**：需求后来改名 / 删除，
--       历史统计仍然读得出当时的名字。
--
-- 设计原则：纯增量、幂等、向后兼容。
--   · 只 ADD COLUMN，老记录两列为 NULL（表格显示「—」）；
--   · 用 information_schema 判断 + PREPARE 动态执行，可重复执行。
--
-- 执行：mysql -u devstudio -p devstudio < sql/08_completion_req_doc.sql
-- ============================================================================

USE devstudio;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_completion_record' AND COLUMN_NAME = 'req_doc_id');
SET @s := IF(@x = 0,
  'ALTER TABLE task_completion_record ADD COLUMN req_doc_id VARCHAR(32) DEFAULT NULL COMMENT ''关联需求ID（requirement_doc）'' AFTER req_name',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_completion_record' AND COLUMN_NAME = 'req_doc_title');
SET @s := IF(@x = 0,
  'ALTER TABLE task_completion_record ADD COLUMN req_doc_title VARCHAR(100) DEFAULT NULL COMMENT ''需求名称（完成时快照）'' AFTER req_doc_id',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 自检
-- ---------------------------------------------------------------------------
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_completion_record'
  AND COLUMN_NAME IN ('req_name', 'req_doc_id', 'req_doc_title')
ORDER BY ORDINAL_POSITION;

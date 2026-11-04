-- ============================================================================
-- 性能索引与需求摘要列（2026-10-31，优化方案 DB-1~DB-4）
--
-- 全部语句幂等：先查 information_schema，再决定是否 ALTER，可重复执行。
-- 部署顺序：先执行本脚本，再重启新 jar（列表查询依赖 content_brief 列）。
-- 建议在业务低峰执行；大表加索引会短暂占用 IO。
-- ============================================================================

USE hourglass;

-- ---------------------------------------------------------------------------
-- 1. 子表按 workspace 维度聚合（mergeTaskExtras / 任务级批量查询）
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subtask' AND INDEX_NAME = 'idx_ws_task');
SET @s := IF(@x = 0,
  'ALTER TABLE subtask ADD KEY idx_ws_task (workspace_id, task_id, done)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attachment' AND INDEX_NAME = 'idx_ws_task');
SET @has_task_id := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attachment' AND COLUMN_NAME = 'task_id');
SET @s := IF(@x = 0 AND @has_task_id > 0,
  'ALTER TABLE attachment ADD KEY idx_ws_task (workspace_id, task_id)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_tag' AND INDEX_NAME = 'idx_ws_task');
SET @s := IF(@x = 0,
  'ALTER TABLE task_tag ADD KEY idx_ws_task (workspace_id, task_id)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 2. time_log：按 started_at 的区间查询不再对列做 DATE()，索引可用
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'time_log' AND INDEX_NAME = 'idx_ws_started');
SET @s := IF(@x = 0,
  'ALTER TABLE time_log ADD KEY idx_ws_started (workspace_id, started_at)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'time_log' AND INDEX_NAME = 'idx_user_started');
SET @s := IF(@x = 0,
  'ALTER TABLE time_log ADD KEY idx_user_started (user_id, started_at)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 3. 通知 / 操作日志：扫描与去重
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_notification' AND INDEX_NAME = 'idx_ws_ref');
SET @s := IF(@x = 0,
  'ALTER TABLE app_notification ADD KEY idx_ws_ref (workspace_id, ref_task_id)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_notification' AND INDEX_NAME = 'idx_user_ref_type');
SET @s := IF(@x = 0,
  'ALTER TABLE app_notification ADD KEY idx_user_ref_type (user_id, ref_task_id, type, created_at)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- idx_ws_action_time 中间夹着 action，按时间扫描用不上；补一条纯时间的
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_log' AND INDEX_NAME = 'idx_ws_created');
SET @s := IF(@x = 0,
  'ALTER TABLE task_log ADD KEY idx_ws_created (workspace_id, created_at)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 4. 需求 / 分支的任务计数（一次 GROUP BY，不再逐行相关子查询）
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND INDEX_NAME = 'idx_ws_reqdoc_board');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD KEY idx_ws_reqdoc_board (workspace_id, req_doc_id, board_column)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 5. requirement_doc.content_brief：列表不再读 MEDIUMTEXT 正文
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement_doc' AND COLUMN_NAME = 'content_brief');
SET @s := IF(@x = 0,
  'ALTER TABLE requirement_doc ADD COLUMN content_brief VARCHAR(400) DEFAULT NULL COMMENT ''纯文本摘要（列表用）'' AFTER content',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 回填：去掉 HTML 标签后的前 400 字符（新保存会写入清洗后的纯文本摘要）
UPDATE requirement_doc
SET content_brief = LEFT(REGEXP_REPLACE(COALESCE(content, ''), '<[^>]+>', ' '), 400)
WHERE content_brief IS NULL AND content IS NOT NULL;

-- 自检：应看到 8 个索引 + content_brief 列
SELECT TABLE_NAME, INDEX_NAME FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND INDEX_NAME IN ('idx_ws_task','idx_ws_started','idx_user_started','idx_ws_ref',
                     'idx_user_ref_type','idx_ws_created','idx_ws_reqdoc_board')
ORDER BY TABLE_NAME, INDEX_NAME;

SELECT COLUMN_NAME FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement_doc' AND COLUMN_NAME = 'content_brief';

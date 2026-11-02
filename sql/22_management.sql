-- ============================================================================
-- 管理层驾驶舱 · 数据模型（2026-11-02，v0.2）
--
-- 内容：
--   1) requirement 增加项目负责人/计划周期/优先级/健康覆盖字段
--   2) task 增加阻塞开始时间与来源标记
--   3) 管理聚合索引
--
-- 设计原则：纯增量、幂等、向后兼容；不重命名/不删除现有表。
-- 执行：mysql -u devstudio -p devstudio < sql/22_management.sql
-- ============================================================================

USE devstudio;

-- ---------------------------------------------------------------------------
-- 1. requirement 管理字段
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement' AND COLUMN_NAME = 'manager_user_id');
SET @s := IF(@x = 0,
  'ALTER TABLE requirement ADD COLUMN manager_user_id VARCHAR(32) DEFAULT NULL COMMENT ''项目负责人账号ID（owner/member，不含 exec）'' AFTER status',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement' AND COLUMN_NAME = 'start_date');
SET @s := IF(@x = 0,
  'ALTER TABLE requirement ADD COLUMN start_date DATE DEFAULT NULL COMMENT ''项目开始日期'' AFTER manager_user_id',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement' AND COLUMN_NAME = 'due_date');
SET @s := IF(@x = 0,
  'ALTER TABLE requirement ADD COLUMN due_date DATE DEFAULT NULL COMMENT ''项目截止日期'' AFTER start_date',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement' AND COLUMN_NAME = 'priority');
SET @s := IF(@x = 0,
  'ALTER TABLE requirement ADD COLUMN priority VARCHAR(4) NOT NULL DEFAULT ''P2'' COMMENT ''项目优先级 P0-P3'' AFTER due_date',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement' AND COLUMN_NAME = 'health_override');
SET @s := IF(@x = 0,
  'ALTER TABLE requirement ADD COLUMN health_override VARCHAR(8) DEFAULT NULL COMMENT ''人工覆盖：red/amber/green；空=自动'' AFTER priority',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement' AND COLUMN_NAME = 'health_note');
SET @s := IF(@x = 0,
  'ALTER TABLE requirement ADD COLUMN health_note VARCHAR(200) DEFAULT NULL COMMENT ''人工覆盖原因'' AFTER health_override',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement' AND COLUMN_NAME = 'health_updated_by');
SET @s := IF(@x = 0,
  'ALTER TABLE requirement ADD COLUMN health_updated_by VARCHAR(32) DEFAULT NULL COMMENT ''健康覆盖操作人'' AFTER health_note',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement' AND COLUMN_NAME = 'health_updated_at');
SET @s := IF(@x = 0,
  'ALTER TABLE requirement ADD COLUMN health_updated_at DATETIME DEFAULT NULL COMMENT ''健康覆盖操作时间'' AFTER health_updated_by',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement' AND COLUMN_NAME = 'health_override_until');
SET @s := IF(@x = 0,
  'ALTER TABLE requirement ADD COLUMN health_override_until DATETIME DEFAULT NULL COMMENT ''健康覆盖到期时间'' AFTER health_updated_at',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement' AND COLUMN_NAME = 'created_by');
SET @s := IF(@x = 0,
  'ALTER TABLE requirement ADD COLUMN created_by VARCHAR(32) DEFAULT NULL COMMENT ''创建人账号ID（仅新项目记录，存量无法回填）'' AFTER health_override_until',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 2. task 阻塞开始时间
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'blocked_at');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD COLUMN blocked_at DATETIME DEFAULT NULL COMMENT ''进入阻塞状态的时间；解除阻塞时置空'' AFTER blocked_by_task_id',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'blocked_at_source');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD COLUMN blocked_at_source VARCHAR(8) DEFAULT NULL COMMENT ''real/estimated；历史估算值标记'' AFTER blocked_at',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 3. 管理聚合索引（先看 EXPLAIN；已有 idx_ws_req 时仍可作为覆盖索引候选）
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND INDEX_NAME = 'idx_ws_req_active');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD KEY idx_ws_req_active (workspace_id, req_id, deleted_at, board_column)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement' AND INDEX_NAME = 'idx_ws_manager');
SET @s := IF(@x = 0,
  'ALTER TABLE requirement ADD KEY idx_ws_manager (workspace_id, manager_user_id)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 自检：应看到 requirement 新增列、task 阻塞列、两个索引
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND ((TABLE_NAME = 'requirement' AND COLUMN_NAME IN
        ('manager_user_id','start_date','due_date','priority','health_override','health_note',
         'health_updated_by','health_updated_at','health_override_until','created_by'))
    OR (TABLE_NAME = 'task' AND COLUMN_NAME IN ('blocked_at','blocked_at_source')))
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND INDEX_NAME IN ('idx_ws_req_active','idx_ws_manager')
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;

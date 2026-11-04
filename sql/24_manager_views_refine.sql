USE devstudio;

-- ============================================================================
-- 24_manager_views_refine.sql · M1/M2 深度对照补差（2026-11-03）
--
-- 依据：docs/manager-view-gap-and-plan-2026-11-02.md 复核 + 原型对照
--   需求↔任务关联：task.demand_id（需求详情「关联任务」透视与基于需求创建任务）
--   需求附件：attachment 泛化为 target_id + target_kind（task/demand）
--
-- 设计原则与 23 号一致：纯增量、幂等、向后兼容（information_schema 判断 + PREPARE）。
-- 存量数据：task.demand_id 为 NULL = 未关联需求；attachment.target_kind 默认 'task'，
--           升级前后任务附件行为完全一致。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 需求↔任务关联（task.demand_id）
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'demand_id');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD COLUMN demand_id VARCHAR(32) DEFAULT NULL COMMENT ''关联需求池需求ID（demand 表）'' AFTER epic_id',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND INDEX_NAME = 'idx_demand');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD KEY idx_demand (demand_id)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 需求附件：attachment.task_id 泛化为 target_id + target_kind
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attachment' AND COLUMN_NAME = 'target_id');
SET @y := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attachment' AND COLUMN_NAME = 'task_id');
SET @s := IF(@x = 0 AND @y > 0,
  'ALTER TABLE attachment CHANGE task_id target_id VARCHAR(32) NOT NULL COMMENT ''所属目标ID（任务/需求池需求）''',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attachment' AND COLUMN_NAME = 'target_kind');
SET @s := IF(@x = 0,
  'ALTER TABLE attachment ADD COLUMN target_kind VARCHAR(16) NOT NULL DEFAULT ''task'' COMMENT ''目标类型：task任务/demand需求池需求'' AFTER target_id',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 索引随列改名（idx_task → idx_target，idx_ws_task → idx_ws_target）
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attachment' AND INDEX_NAME = 'idx_task');
SET @s := IF(@x > 0,
  'ALTER TABLE attachment DROP KEY idx_task',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attachment' AND INDEX_NAME = 'idx_target');
SET @s := IF(@x = 0,
  'ALTER TABLE attachment ADD KEY idx_target (target_id)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attachment' AND INDEX_NAME = 'idx_ws_task');
SET @s := IF(@x > 0,
  'ALTER TABLE attachment DROP KEY idx_ws_task',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attachment' AND INDEX_NAME = 'idx_ws_target');
SET @s := IF(@x = 0,
  'ALTER TABLE attachment ADD KEY idx_ws_target (workspace_id, target_id)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 自检：应能看到新列与索引
-- ---------------------------------------------------------------------------
SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'demand_id';
SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attachment' AND COLUMN_NAME IN ('target_id', 'target_kind');

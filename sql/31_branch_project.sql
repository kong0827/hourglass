USE devstudio;

-- ============================================================================
-- 31_branch_project.sql · 分支增加可选项目归属（2026-11-04）
--
-- 设计原则：纯增量、幂等、向后兼容。
--   - req_id 为空：空间级公共分支，兼容所有历史数据。
--   - req_id 非空：项目级分支，可在项目内直接创建与管理。
-- ============================================================================

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dev_branch' AND COLUMN_NAME = 'req_id');
SET @s := IF(@x = 0,
  'ALTER TABLE dev_branch ADD COLUMN req_id VARCHAR(32) DEFAULT NULL COMMENT ''所属项目ID（requirement.id），空=空间级公共分支'' AFTER workspace_id',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 按项目查询分支时使用
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dev_branch' AND INDEX_NAME = 'idx_branch_req');
SET @s := IF(@x = 0,
  'ALTER TABLE dev_branch ADD KEY idx_branch_req (workspace_id, req_id)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 唯一键从 (workspace_id, name) 扩为 (workspace_id, req_id, name)：
-- 不同项目允许同名分支，同一维度内仍唯一；空间级公共分支（req_id 为空）同名由
-- 应用层 countByName 兜底（MySQL 唯一索引把多个 NULL 视为互不相同）。
SET @has_old := (SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dev_branch'
                   AND INDEX_NAME = 'uk_ws_name' AND COLUMN_NAME = 'name');
SET @has_new := (SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dev_branch'
                   AND INDEX_NAME = 'uk_ws_name' AND COLUMN_NAME = 'req_id');
SET @s := CASE
  WHEN @has_new > 0 THEN 'DO 0'
  WHEN @has_old > 0 THEN
    'ALTER TABLE dev_branch DROP INDEX uk_ws_name, ADD UNIQUE KEY uk_ws_name (workspace_id, req_id, name)'
  ELSE 'ALTER TABLE dev_branch ADD UNIQUE KEY uk_ws_name (workspace_id, req_id, name)'
END;
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 自检：列 + 新唯一键
SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dev_branch' AND COLUMN_NAME = 'req_id';

SELECT INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dev_branch'
  AND INDEX_NAME IN ('uk_ws_name', 'idx_branch_req')
ORDER BY INDEX_NAME, SEQ_IN_INDEX;

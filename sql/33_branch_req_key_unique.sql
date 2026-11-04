USE hourglass;

-- ============================================================================
-- 33_branch_req_key_unique.sql · 空间级公共分支唯一性修正（2026-11-04）
--
-- 问题：uk_ws_name 包含可空 req_id，MySQL 唯一键允许多个 NULL，
--       并发创建同名空间级公共分支会插出重复记录。
-- 处理：增加生成列 req_key = IFNULL(req_id,'')，先新增更严格唯一键
--       uk_ws_req_name，再删除旧 uk_ws_name。若历史数据已有重复的
--       空间级同名分支，新键会先失败，旧键保持不动，人工合并后再执行。
-- ============================================================================

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dev_branch' AND COLUMN_NAME = 'req_key');
SET @s := IF(@x = 0,
  'ALTER TABLE dev_branch ADD COLUMN req_key VARCHAR(32) GENERATED ALWAYS AS (IFNULL(req_id, '''')) STORED COMMENT ''唯一性归一化：空间级分支用空串代替 NULL'' AFTER req_id',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 先加新键：重复数据存在时在这里失败，旧唯一键仍然有效
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dev_branch' AND INDEX_NAME = 'uk_ws_req_name');
SET @s := IF(@x = 0,
  'ALTER TABLE dev_branch ADD UNIQUE KEY uk_ws_req_name (workspace_id, req_key, name)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dev_branch' AND INDEX_NAME = 'uk_ws_name');
SET @s := IF(@x > 0,
  'ALTER TABLE dev_branch DROP INDEX uk_ws_name',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

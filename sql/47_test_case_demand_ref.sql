-- 测试用例关联需求（选填）：用例 → 需求池条目的软关联
-- demand_id 为空 = 不关联；需求删除时由 DemandService 级联解绑（置 NULL）
-- 幂等：先探测列/索引再执行，支持 deploy.sh --sql-all 重放。
USE hourglass;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'test_case' AND COLUMN_NAME = 'demand_id');
SET @s := IF(@x = 0,
  'ALTER TABLE test_case ADD COLUMN demand_id varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''关联需求ID（demand.id，选填）'' AFTER req_id',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'test_case' AND INDEX_NAME = 'idx_demand');
SET @s := IF(@x = 0,
  'ALTER TABLE test_case ADD KEY idx_demand (demand_id)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

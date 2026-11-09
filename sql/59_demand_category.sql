USE hourglass;

-- ============================================================================
-- 59_demand_category.sql · 需求池增加模块字段（2026-11-09）
--
--   demand.category  模块名（取值来自 category 表，空串表示未指定）
--   需求池与任务的模块口径一致：存名称文本，模块改名/删除时同步更新。
--   只加列与索引，不改数据。
-- 幂等：MySQL 8 不支持 ADD COLUMN IF NOT EXISTS，这里按 information_schema 逐列/逐索引判断。
-- ============================================================================

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `demand` ADD COLUMN `category` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '''' COMMENT ''模块名（取值来自 category 表）'' AFTER `item_kind`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demand' AND COLUMN_NAME = 'category');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `demand` ADD KEY `idx_ws_category` (`workspace_id`,`category`)',
  'DO 0')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demand' AND INDEX_NAME = 'idx_ws_category');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

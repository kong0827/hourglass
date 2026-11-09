USE hourglass;

-- ============================================================================
-- 61_category_id.sql · 任务/需求池的模块关联从「名称文本」改为「模块ID」（2026-11-09）
--
--   task.category_id    模块ID（category.id），不变空
--   demand.category_id  模块ID（category.id），NULL 表示未指定
--
--   改造后模块改名/删除不再扫描业务表：关联只认 ID，名称展示一律经模块表解析。
--   历史数据不做回填：旧名称列直接丢弃，存量任务/需求的模块由使用方重新指定。
-- 幂等：MySQL 8 不支持 ADD/DROP COLUMN IF NOT EXISTS，按 information_schema 逐列逐索引判断。
-- ============================================================================

-- 1) task：加 ID 列（沿用原 category 的位置与 NOT NULL 语义）
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `task` ADD COLUMN `category_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '''' COMMENT ''模块ID（category.id）'' AFTER `owner_user_id`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'category_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) > 0,
  'ALTER TABLE `task` DROP COLUMN `category`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'category');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 2) demand：加可空 ID 列（NULL = 未指定），替换原名称列
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `demand` ADD COLUMN `category_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT ''模块ID（category.id，空=未指定）'' AFTER `item_kind`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demand' AND COLUMN_NAME = 'category_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) > 0,
  'ALTER TABLE `demand` DROP COLUMN `category`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demand' AND COLUMN_NAME = 'category');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 3) demand 索引：按 ID 过滤建索引，旧名称索引移除
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `demand` ADD KEY `idx_ws_category_id` (`workspace_id`,`category_id`)',
  'DO 0')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demand' AND INDEX_NAME = 'idx_ws_category_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) > 0,
  'ALTER TABLE `demand` DROP KEY `idx_ws_category`',
  'DO 0')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demand' AND INDEX_NAME = 'idx_ws_category');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

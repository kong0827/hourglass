-- ============================================================================
-- 70_project_sort_order.sql · 项目手动排序（2026-11-12）
--
-- 背景：
--   项目（requirement）此前固定按创建时间排列，项目列表与所有项目下拉框
--   都只能沿用这个顺序。业务上需要按优先级手动排序，并让下拉框跟随。
--
-- 边界：
--   只增列与索引；不改任何权限、状态字段；排序由空间主/管理员在项目列表拖动维护。
--   排序值为空间内递增整数（0 起），同一空间内不要求唯一约束，重排时整体重编号。
--
-- 幂等：
--   列/索引按 information_schema 判断后执行；
--   历史回填只在「全表没有任何非 0 值」时执行，避免覆盖已手动调整的顺序。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/70_project_sort_order.sql
-- ============================================================================

USE hourglass;

-- ---------------------------------------------------------------------------
-- 1) 排序字段
-- ---------------------------------------------------------------------------
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `requirement` ADD COLUMN `sort_order` int NOT NULL DEFAULT 0 COMMENT ''项目手动排序（空间内升序，0 起）'' AFTER `archived_at`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement' AND COLUMN_NAME = 'sort_order');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 2) 空间内按排序取项目的索引
-- ---------------------------------------------------------------------------
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `requirement` ADD KEY `idx_ws_sort` (`workspace_id`, `sort_order`)',
  'DO 0')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement' AND INDEX_NAME = 'idx_ws_sort');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 3) 历史回填：按原创建顺序编号，保持升级后的现有视觉顺序不变
--    已有手动顺序（存在非 0 值）时跳过，避免把用户调整过的顺序打回创建顺序。
-- ---------------------------------------------------------------------------
SET @s := IF((SELECT COUNT(*) FROM `requirement` WHERE `sort_order` <> 0) = 0,
  'UPDATE `requirement` r JOIN (SELECT id, ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY created_at, id) - 1 AS rn FROM `requirement`) t ON t.id = r.id SET r.sort_order = t.rn',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

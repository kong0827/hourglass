-- ============================================================================
-- 97_subtask_sort_order.sql · 检查项（子任务）手动排序（2026-11-14）
--
-- 背景：
--   检查项此前固定 ORDER BY id（创建序），抽屉里只能勾选/删除，不能调整顺序。
--   业务上清单有先后含义（先做哪步），需要拖拽/键盘重排并持久化。
--
-- 边界：
--   只增列；不改权限与勾选状态。排序值为任务内递增整数（0 起），不要求唯一约束，
--   重排时按提交的全排列整体重编号；新建检查项追加到末尾（max+1）。
--
-- 幂等：
--   列按 information_schema 判断后执行；
--   历史回填只在「全表没有任何非 0 值」时执行，避免覆盖已手动调整的顺序。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/97_subtask_sort_order.sql
-- ============================================================================

USE hourglass;

-- ---------------------------------------------------------------------------
-- 1) 排序字段
-- ---------------------------------------------------------------------------
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `subtask` ADD COLUMN `sort_order` int NOT NULL DEFAULT 0 COMMENT ''清单内排序序号（小在前）'' AFTER `done`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subtask' AND COLUMN_NAME = 'sort_order');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 2) 历史回填：按原创建顺序编号，保持升级后的现有视觉顺序不变
--    已有手动顺序（存在非 0 值）时跳过，避免把用户调整过的顺序打回创建顺序。
-- ---------------------------------------------------------------------------
SET @s := IF((SELECT COUNT(*) FROM `subtask` WHERE `sort_order` <> 0) = 0,
  'UPDATE `subtask` s JOIN (SELECT id, ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY id) - 1 AS rn FROM `subtask`) t ON t.id = s.id SET s.sort_order = t.rn',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
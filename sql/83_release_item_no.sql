-- 发布快照里的工作项编号：与 title / owner_name / demand_title 一样在记录当时定格
-- 82 号给 task 加了项目内编号，但工作项换项目会重新取号；发布记录是历史证据，
-- 若读取时再去 join 当前 task，旧记录会显示成换项目后的新编号，与当时交付的事实不符。
-- 可空：任务已被彻底删除时取不到号，前端回退显示原 ID。
-- 幂等：先探测列再执行；回填只处理 NULL，已有快照编号不动。
USE hourglass;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'version_release_item' AND COLUMN_NAME = 'task_item_no');
SET @s := IF(@x = 0,
  'ALTER TABLE `version_release_item` ADD COLUMN `task_item_no` int DEFAULT NULL COMMENT ''快照时的工作项编号（展示为 WI-001；空=任务已彻底删除）'' AFTER `task_id`',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 存量快照按当前 task.item_no 回填：这是能拿到的最接近事实的编号。
-- 回填后若工作项再换项目，快照编号不再跟着变（这正是本列的目的）。
UPDATE version_release_item i
JOIN task t ON t.id = i.task_id AND t.workspace_id = i.workspace_id
SET i.task_item_no = t.item_no
WHERE i.task_item_no IS NULL AND t.item_no IS NOT NULL;
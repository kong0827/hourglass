-- 发布快照里的需求编号：与 demand_title 一样在记录当时定格（与 83 号工作项编号同一口径）
-- 84 号给 demand 加了项目内编号，但需求会被删除或移植；发布记录是历史证据，
-- 读取时再 join 当前 demand 会拿不到号，因此快照写号。
-- 可空：存量快照或需求已删除时取不到号，前端回退显示原 ID。
-- 幂等：先探测列再执行；回填只处理 NULL，已有快照编号不动。
USE hourglass;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'version_release_item' AND COLUMN_NAME = 'demand_no');
SET @s := IF(@x = 0,
  'ALTER TABLE `version_release_item` ADD COLUMN `demand_no` int DEFAULT NULL COMMENT ''快照时的需求编号（展示为 DM-001；空=需求已删除或尚未取号）'' AFTER `demand_id`',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

UPDATE version_release_item i
JOIN demand d ON d.id = i.demand_id AND d.workspace_id = i.workspace_id
SET i.demand_no = d.demand_no
WHERE i.demand_no IS NULL AND d.demand_no IS NOT NULL;

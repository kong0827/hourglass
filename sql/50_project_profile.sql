-- 项目实体补全：负责人、计划起止、项目目标、归档时间
-- 计划起止用于驾驶舱倒计时与风险判断；归档仅隐藏默认视图，不删除数据。
-- 幂等：MySQL 8 不支持 ADD COLUMN IF NOT EXISTS，这里按 information_schema 逐列判断。
USE hourglass;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `requirement` ADD COLUMN `objective` varchar(400) COLLATE utf8mb4_unicode_ci NULL COMMENT ''项目目标（一句话，驾驶舱展示）'' AFTER `description`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement' AND COLUMN_NAME = 'objective');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `requirement` ADD COLUMN `owner_user_id` varchar(32) COLLATE utf8mb4_unicode_ci NULL COMMENT ''项目负责人（app_user.id）'' AFTER `status`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement' AND COLUMN_NAME = 'owner_user_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `requirement` ADD COLUMN `planned_start` date NULL COMMENT ''计划开始日'' AFTER `owner_user_id`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement' AND COLUMN_NAME = 'planned_start');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `requirement` ADD COLUMN `planned_end` date NULL COMMENT ''计划结束日'' AFTER `planned_start`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement' AND COLUMN_NAME = 'planned_end');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `requirement` ADD COLUMN `archived_at` datetime NULL COMMENT ''归档时间（NULL=未归档）'' AFTER `updated_at`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement' AND COLUMN_NAME = 'archived_at');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `requirement` ADD KEY `idx_ws_owner` (`workspace_id`,`owner_user_id`)',
  'DO 0')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement' AND INDEX_NAME = 'idx_ws_owner');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

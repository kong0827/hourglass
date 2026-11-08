-- 通知深链：非任务通知记录关联对象类型与 ID
-- ref_task_id 只用于任务类通知；需求/文档/分支/版本/项目等通知改由 ref_kind + ref_id 指向详情。
-- 幂等：MySQL 8 不支持 ADD COLUMN IF NOT EXISTS，这里按 information_schema 逐列/逐索引判断。
USE hourglass;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `app_notification` ADD COLUMN `ref_kind` varchar(20) COLLATE utf8mb4_unicode_ci NULL COMMENT ''关联对象类型：demand/doc/branch/version/project/workspace'' AFTER `ref_task_id`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_notification' AND COLUMN_NAME = 'ref_kind');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `app_notification` ADD COLUMN `ref_id` varchar(64) COLLATE utf8mb4_unicode_ci NULL COMMENT ''关联对象 ID（非任务通知深链）'' AFTER `ref_kind`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_notification' AND COLUMN_NAME = 'ref_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `app_notification` ADD KEY `idx_user_ref` (`user_id`,`ref_kind`,`ref_id`)',
  'DO 0')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_notification' AND INDEX_NAME = 'idx_user_ref');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

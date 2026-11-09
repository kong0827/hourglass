USE hourglass;

-- ============================================================================
-- 62_category_project.sql · 模块降到项目级（2026-11-09）
--
--   category 加 project_id：模块清单从空间级改为项目级，每个项目独立维护。
--   唯一键 (workspace_id, name) → (workspace_id, project_id, name)。
--   不迁移历史：旧空间级行（project_id=''）删除；任务/需求旧模块引用置空
--   （task.category_id=''、demand.category_id=NULL，均表示「未指定」）。
--   幂等：MySQL 8 不支持 ADD COLUMN IF NOT EXISTS，这里按 information_schema 逐列/逐索引判断。
-- ============================================================================

-- 1) category 加 project_id
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `category` ADD COLUMN `project_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '''' COMMENT ''所属项目ID（requirement.id，空=历史空间级行，迁移后不存在）'' AFTER `workspace_id`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'category' AND COLUMN_NAME = 'project_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 2) 删旧唯一键 (workspace_id, name)
SET @s := (SELECT IF(COUNT(*) > 0,
  'ALTER TABLE `category` DROP KEY `uk_ws_name`',
  'DO 0')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'category' AND INDEX_NAME = 'uk_ws_name');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 3) 删除历史空间级行
DELETE FROM `category` WHERE `project_id` = '';

-- 4) 任务/需求的旧模块引用统一置空（指向已删除的空间级行，一律视为「未指定」）
UPDATE `task` SET `category_id` = '' WHERE `category_id` <> '';
UPDATE `demand` SET `category_id` = NULL WHERE `category_id` IS NOT NULL;

-- 5) 新唯一键 (workspace_id, project_id, name)
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `category` ADD UNIQUE KEY `uk_ws_proj_name` (`workspace_id`,`project_id`,`name`)',
  'DO 0')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'category' AND INDEX_NAME = 'uk_ws_proj_name');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

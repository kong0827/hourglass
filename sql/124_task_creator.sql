-- ============================================================================
-- 124_task_creator.sql · 工作项记录创建人（2026-11-24）
--
-- 背景：
--   「我的工作 / 我发起的」原来只覆盖需求（demand.created_by）。工作项表没有创建人，
--   用户直接建的工作项无法在个人工作台回看（被指派给别人的工作项尤其看不到）。
--
-- 口径：
--   task 增加 created_by_user_id，建单时写入当前账号。历史数据从 task_log 首条
--   action='create' 的 actor_id 回填；没有创建日志的旧任务保持 NULL，不按负责人
--   推断（管理员代建、需求转工作项、模板/AI 建单都记实际操作人）。
--
-- 边界：
--   只增列与索引，不改写入类型与权限判断；「我发起的」查询按账号 ID 精确匹配。
--   脚本可重复执行（列/索引已存在则跳过，回填只补空值）。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/124_task_creator.sql
-- ============================================================================

USE hourglass;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `task` ADD COLUMN `created_by_user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT ''创建人账号ID（空=历史数据无创建日志，不做推断）'' AFTER `owner_user_id`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'created_by_user_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `task` ADD KEY `idx_creator` (`created_by_user_id`)',
  'DO 0')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND INDEX_NAME = 'idx_creator');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 历史回填：取每个工作项最早一条 create 日志的操作人；关联不到或操作人为空的保持 NULL。
UPDATE task t
JOIN (
  SELECT task_id, workspace_id, actor_id,
         ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY id) AS rn
  FROM task_log
  WHERE action = 'create' AND actor_id IS NOT NULL AND actor_id <> ''
) l ON l.task_id = t.id AND l.workspace_id = t.workspace_id AND l.rn = 1
SET t.created_by_user_id = l.actor_id
WHERE t.created_by_user_id IS NULL;

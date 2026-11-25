-- ============================================================================
-- 122_app_notification_req_id.sql · 通知按项目过滤（2026-11-21）
--
-- 背景：
--   app_notification 的可见性过滤只按 ref_task_id 关联 task。需求、文档、分支、版本
--   等非任务通知 ref_task_id 为空，项目被设为「不可见」后这些历史通知仍留在收件箱，
--   而深链已经 404。
--
-- 口径：
--   新增可空列 req_id，写入时固化非任务通知所属项目；列表/未读数/类型计数统一按
--   req_id 判断项目可见性。无法唯一归属一个项目的通知（如跨项目发布计划）保持为空，
--   维持可见。
--
-- 边界：
--   只增列与索引，不改写入类型、不改判定规则。历史行按 ref_kind 关联一次回填；
--   关联不到的行保持 NULL（继续可见，不误伤）。脚本可重复执行。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/122_app_notification_req_id.sql
-- ============================================================================

USE hourglass;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `app_notification` ADD COLUMN `req_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT ''通知对应业务对象所属项目ID（空=不按项目过滤）'' AFTER `ref_id`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_notification' AND COLUMN_NAME = 'req_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `app_notification` ADD KEY `idx_user_ws_req` (`user_id`, `workspace_id`, `req_id`)',
  'DO 0')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_notification' AND INDEX_NAME = 'idx_user_ws_req');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 历史回填：只补空值，关联不到或跨项目对象保持 NULL。
UPDATE app_notification n JOIN demand d
  ON d.id = n.ref_id AND d.workspace_id = n.workspace_id
SET n.req_id = d.req_id
WHERE n.req_id IS NULL AND n.ref_kind = 'demand';

UPDATE app_notification n JOIN requirement_doc doc
  ON doc.id = n.ref_id AND doc.workspace_id = n.workspace_id
SET n.req_id = doc.req_id
WHERE n.req_id IS NULL AND n.ref_kind = 'doc' AND doc.req_id IS NOT NULL;

UPDATE app_notification n JOIN test_plan tp
  ON tp.id = n.ref_id AND tp.workspace_id = n.workspace_id
SET n.req_id = tp.req_id
WHERE n.req_id IS NULL AND n.ref_kind = 'test_plan';

UPDATE app_notification n JOIN dev_branch b
  ON b.id = n.ref_id AND b.workspace_id = n.workspace_id
SET n.req_id = b.req_id
WHERE n.req_id IS NULL AND n.ref_kind = 'branch' AND b.req_id IS NOT NULL;

UPDATE app_notification n JOIN project_version v
  ON v.id = n.ref_id AND v.workspace_id = n.workspace_id
SET n.req_id = v.req_id
WHERE n.req_id IS NULL AND n.ref_kind = 'version';

UPDATE app_notification n JOIN requirement r
  ON r.id = n.ref_id AND r.workspace_id = n.workspace_id
SET n.req_id = r.id
WHERE n.req_id IS NULL AND n.ref_kind = 'project';

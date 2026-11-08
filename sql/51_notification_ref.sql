-- 通知深链：非任务通知记录关联对象类型与 ID
-- ref_task_id 只用于任务类通知；需求/文档/分支/版本/项目等通知改由 ref_kind + ref_id 指向详情。
USE hourglass;

ALTER TABLE `app_notification`
  ADD COLUMN `ref_kind` varchar(20) COLLATE utf8mb4_unicode_ci NULL COMMENT '关联对象类型：demand/doc/branch/version/project/workspace' AFTER `ref_task_id`,
  ADD COLUMN `ref_id` varchar(64) COLLATE utf8mb4_unicode_ci NULL COMMENT '关联对象 ID（非任务通知深链）' AFTER `ref_kind`,
  ADD KEY `idx_user_ref` (`user_id`,`ref_kind`,`ref_id`);

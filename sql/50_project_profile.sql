-- 项目实体补全：负责人、计划起止、项目目标、归档时间
-- 计划起止用于驾驶舱倒计时与风险判断；归档仅隐藏默认视图，不删除数据。
USE hourglass;

ALTER TABLE `requirement`
  ADD COLUMN `objective` varchar(400) COLLATE utf8mb4_unicode_ci NULL COMMENT '项目目标（一句话，驾驶舱展示）' AFTER `description`,
  ADD COLUMN `owner_user_id` varchar(32) COLLATE utf8mb4_unicode_ci NULL COMMENT '项目负责人（app_user.id）' AFTER `status`,
  ADD COLUMN `planned_start` date NULL COMMENT '计划开始日' AFTER `owner_user_id`,
  ADD COLUMN `planned_end` date NULL COMMENT '计划结束日' AFTER `planned_start`,
  ADD COLUMN `archived_at` datetime NULL COMMENT '归档时间（NULL=未归档）' AFTER `updated_at`,
  ADD KEY `idx_ws_owner` (`workspace_id`,`owner_user_id`);

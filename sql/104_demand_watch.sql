-- ============================================================================
-- 104_demand_watch.sql · 需求关注人 / 提醒人（2026-11-17）
--
-- 一条需求可被多人关注；状态流转、内容变更和新评论都会通知关注人。
-- 自关注与「替他人添加提醒人」共用一张表：added_by 记录谁加进来的，
-- 本人可以自行退出，项目可写成员可以管理名单。
-- 关注关系不进 JSON 备份（与 task_watch 一致），恢复后名单为空；
-- 成员移出空间、账号删除、需求硬删除、空间清空/覆盖导入时一并清理。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/104_demand_watch.sql
-- 可重复执行；只建表，不回填。
-- ============================================================================

USE hourglass;

CREATE TABLE IF NOT EXISTS `demand_watch` (
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `demand_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '需求ID（demand.id）',
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关注人账号ID',
  `added_by` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '添加人账号ID（本人关注时为自己）',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '关注时间',
  PRIMARY KEY (`demand_id`, `user_id`),
  KEY `idx_dw_user` (`user_id`, `workspace_id`),
  KEY `idx_dw_ws_demand` (`workspace_id`, `demand_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求关注人（多个提醒人）';

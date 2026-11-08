-- 系统审计日志：登录、权限变更、导出/导入、删除/清空等最小集
-- 与 task_log（任务时间线/空间活动流）分开，避免任务操作噪音淹没安全事件。
USE hourglass;

CREATE TABLE IF NOT EXISTS `audit_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '日志ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '归属空间ID；登录等系统事件为空',
  `actor_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '操作人用户ID；登录失败等场景可空',
  `actor_name` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '操作人显示名/尝试账号快照',
  `action` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '动作：login/login_fail/logout/export/import/clear/role_change/member_add/member_remove/workspace_delete/project_delete/user_create/user_update/user_delete/password_reset',
  `target_type` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '对象类型：auth/user/workspace/member/project/data',
  `target_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '对象ID',
  `target_name` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '对象名称快照',
  `result` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'success' COMMENT 'success/fail',
  `detail` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '变更摘要（不记录密码/Token）',
  `ip` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '来源IP',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发生时间',
  PRIMARY KEY (`id`),
  KEY `idx_ws_id` (`workspace_id`,`id`),
  KEY `idx_ws_created` (`workspace_id`,`created_at`),
  KEY `idx_actor` (`actor_id`,`id`),
  KEY `idx_action_time` (`action`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统审计日志（安全事件最小集）';

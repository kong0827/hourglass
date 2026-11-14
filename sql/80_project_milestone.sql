-- 项目级里程碑：一条里程碑只表达一条达成条件，状态由条件/证据推导。
-- 达成方式创建后不改；自动型不接受人工标记；改期与取消必须记录原因。
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/80_project_milestone.sql

USE hourglass;
CREATE TABLE IF NOT EXISTS `project_milestone` (
  `id` varchar(32) NOT NULL,
  `workspace_id` varchar(32) NOT NULL,
  `req_id` varchar(32) NOT NULL,
  `name` varchar(120) NOT NULL,
  `kind` varchar(16) NOT NULL COMMENT 'version=版本发布后 / tasks=工作项完成后 / manual=人工确认',
  `version_id` varchar(32) DEFAULT NULL,
  `target_date` date NOT NULL,
  `owner_user_id` varchar(32) DEFAULT NULL,
  `is_key` tinyint(1) NOT NULL DEFAULT '1',
  `note` varchar(500) DEFAULT NULL,
  `achieved_at` datetime DEFAULT NULL COMMENT '仅人工确认写入；自动型由条件实时推导',
  `achieved_note` varchar(500) DEFAULT NULL,
  `confirmed_by_user_id` varchar(32) DEFAULT NULL,
  `canceled_at` datetime DEFAULT NULL,
  `cancel_reason` varchar(500) DEFAULT NULL,
  `revision` bigint NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ws_req` (`workspace_id`, `req_id`),
  KEY `idx_ws_version` (`workspace_id`, `version_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目级里程碑';

CREATE TABLE IF NOT EXISTS `project_milestone_task` (
  `workspace_id` varchar(32) NOT NULL,
  `milestone_id` varchar(32) NOT NULL,
  `task_id` varchar(32) NOT NULL,
  PRIMARY KEY (`workspace_id`, `milestone_id`, `task_id`),
  KEY `idx_ws_milestone` (`workspace_id`, `milestone_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工作项型里程碑的达成条件';

CREATE TABLE IF NOT EXISTS `project_milestone_log` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `workspace_id` varchar(32) NOT NULL,
  `milestone_id` varchar(32) NOT NULL,
  `action` varchar(24) NOT NULL,
  `detail` varchar(500) DEFAULT NULL,
  `operator_user_id` varchar(32) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ws_milestone` (`workspace_id`, `milestone_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='里程碑动态';

-- 存量 task.is_milestone 一次性映射为人工里程碑，沿用名称、负责人与目标日期。
-- 任务侧标记暂不删列，保证旧备份可导入；界面不再暴露该开关。
INSERT INTO `project_milestone`
  (`id`, `workspace_id`, `req_id`, `name`, `kind`, `target_date`, `owner_user_id`, `is_key`, `note`)
SELECT CONCAT('M', SUBSTRING(REPLACE(UUID(), '-', ''), 1, 30)),
       t.`workspace_id`, t.`req_id`, LEFT(t.`title`, 120), 'manual',
       COALESCE(t.`due_date`, t.`start_date`, DATE(t.`created_at`)),
       t.`owner_user_id`, 1, '由原工作项里程碑迁移'
FROM `task` t
WHERE t.`is_milestone` = 1 AND t.`deleted_at` IS NULL AND t.`req_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `project_milestone` m
    WHERE m.`workspace_id` = t.`workspace_id` AND m.`req_id` = t.`req_id`
      AND m.`name` = LEFT(t.`title`, 120) AND m.`kind` = 'manual'
      AND m.`note` = '由原工作项里程碑迁移'
  );

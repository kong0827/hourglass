-- ============================================================================
-- 115_release_prep.sql · 发布准备、关注与提醒（2026-11-20）
--
-- 发布计划进入「就绪」后，计划管理者可向工作项负责人推送发布准备，
-- 负责人逐项确认 / 标记风险并回执；关注计划的人接收改期、范围变化与 T-0 提醒。
--
-- 口径：
--   - 推送批次与收件人分开：一次「通知成员」= 一个批次，回执挂在收件人上；
--   - 逐项确认按 (plan_id, task_id, user_id) 保存，不外键到计划任务行
--     （计划任务保存时删除重建，外键会让确认记录跟着丢）；
--   - 关注独立于 task_watch / demand_watch，我的关注只做统一展示；
--   - 里程碑唯一键保证 T-7 / T-3 / T-1 / T-0 同一人只发一次。
--
-- 执行：mysql -u hourglass -p --default-character-set=utf8mb4 hourglass < sql/115_release_prep.sql
-- 可重复执行；只建表，不回填。
-- ============================================================================

USE hourglass;

CREATE TABLE IF NOT EXISTS `version_release_plan_watch` (
  `workspace_id` varchar(32) NOT NULL COMMENT '归属空间ID',
  `plan_id` varchar(32) NOT NULL COMMENT '发布计划ID',
  `user_id` varchar(32) NOT NULL COMMENT '关注人账号ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '关注时间',
  PRIMARY KEY (`plan_id`, `user_id`),
  KEY `idx_rpw_user` (`user_id`, `workspace_id`),
  KEY `idx_rpw_plan` (`workspace_id`, `plan_id`),
  CONSTRAINT `fk_rpw_plan` FOREIGN KEY (`plan_id`, `workspace_id`)
    REFERENCES `version_release_plan` (`id`, `workspace_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='发布计划关注人';

CREATE TABLE IF NOT EXISTS `version_release_plan_push` (
  `id` varchar(32) NOT NULL,
  `workspace_id` varchar(32) NOT NULL,
  `plan_id` varchar(32) NOT NULL,
  `scope` varchar(16) NOT NULL COMMENT 'all / owners / custom',
  `sender_id` varchar(32) NOT NULL,
  `only_unconfirmed` tinyint(1) NOT NULL DEFAULT 0,
  `channels` json NOT NULL,
  `recipient_count` int NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rpp_plan` (`workspace_id`, `plan_id`, `created_at`),
  CONSTRAINT `fk_rpp_plan` FOREIGN KEY (`plan_id`, `workspace_id`)
    REFERENCES `version_release_plan` (`id`, `workspace_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='发布准备推送批次';

CREATE TABLE IF NOT EXISTS `version_release_plan_push_recipient` (
  `push_id` varchar(32) NOT NULL,
  `workspace_id` varchar(32) NOT NULL,
  `user_id` varchar(32) NOT NULL,
  `in_app_at` datetime DEFAULT NULL,
  `email_at` datetime DEFAULT NULL,
  `acked_at` datetime DEFAULT NULL COMMENT '回执时间；回执只表示收到本次提醒',
  PRIMARY KEY (`push_id`, `user_id`),
  KEY `idx_rppr_user` (`workspace_id`, `user_id`, `acked_at`),
  CONSTRAINT `fk_rppr_push` FOREIGN KEY (`push_id`)
    REFERENCES `version_release_plan_push` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='发布准备推送收件人与回执';

CREATE TABLE IF NOT EXISTS `version_release_plan_task_check` (
  `workspace_id` varchar(32) NOT NULL,
  `plan_id` varchar(32) NOT NULL,
  `task_id` varchar(32) NOT NULL,
  `user_id` varchar(32) NOT NULL COMMENT '工作项负责人',
  `state` varchar(8) NOT NULL COMMENT 'ok / risk',
  `note` varchar(500) DEFAULT NULL COMMENT '风险说明',
  `scope_token` varchar(64) DEFAULT NULL COMMENT '确认时的计划范围 token',
  `planned_at_snapshot` datetime DEFAULT NULL COMMENT '确认时的计划时间，用于判断时间提前',
  `checked_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`plan_id`, `task_id`, `user_id`),
  KEY `idx_rptc_user` (`workspace_id`, `user_id`, `checked_at`),
  CONSTRAINT `fk_rptc_plan` FOREIGN KEY (`plan_id`, `workspace_id`)
    REFERENCES `version_release_plan` (`id`, `workspace_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='发布准备逐项确认';

CREATE TABLE IF NOT EXISTS `version_release_plan_milestone` (
  `workspace_id` varchar(32) NOT NULL,
  `plan_id` varchar(32) NOT NULL,
  `user_id` varchar(32) NOT NULL,
  `milestone` varchar(8) NOT NULL COMMENT 'T-7 / T-3 / T-1 / T-0',
  `sent_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_rpm_plan_user_milestone` (`plan_id`, `user_id`, `milestone`),
  KEY `idx_rpm_plan` (`workspace_id`, `plan_id`),
  CONSTRAINT `fk_rpm_plan` FOREIGN KEY (`plan_id`, `workspace_id`)
    REFERENCES `version_release_plan` (`id`, `workspace_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='发布准备里程碑发送记录';

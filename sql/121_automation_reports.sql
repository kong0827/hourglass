-- ============================================================================
-- 121_automation_reports.sql · 轻量自动化规则与定时报告订阅（2026-11-21）
--
-- 三条内置规则：
--   overdue_reminder 逾期 ≥N 天的工作项，每天 10:00 单独提醒负责人（默认 3 天）
--   release_notify   成功生产发布后通知随发工作项负责人
--   status_sync      版本内首个工作项开始处理时，自动把「计划中」版本置为「进行中」
-- 规则按空间保存开关；automation_run 用于同一天同一对象去重，并留下最近一次结果。
--
-- 定时报告：weekly 每周固定时间给订阅人发个人工作小结；version 在版本成功生产发布后
-- 给订阅人发版本报告。订阅是个人设置，不写空间级开关；渠道可选站内/邮件。
--
-- 执行：mysql -u hourglass -p --default-character-set=utf8mb4 hourglass < sql/121_automation_reports.sql
-- 可重复执行；只建表，不改存量数据。
-- ============================================================================

USE hourglass;

CREATE TABLE IF NOT EXISTS `workspace_automation` (
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '空间ID',
  `rule_key` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '规则键：overdue_reminder/release_notify/status_sync',
  `enabled` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否启用',
  `config_json` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '规则参数（如逾期天数）',
  `last_run_at` datetime DEFAULT NULL COMMENT '最近一次执行时间',
  `last_status` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '最近一次执行结果摘要',
  `updated_by` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '最后修改人',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`workspace_id`,`rule_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='空间级自动化规则';

CREATE TABLE IF NOT EXISTS `automation_run` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '空间ID',
  `rule_key` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '规则键',
  `target_key` varchar(96) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '去重对象键，如 owner:<userId>',
  `run_date` date NOT NULL COMMENT '执行自然日',
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'sent' COMMENT 'sent/skipped',
  `message` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '执行说明',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_automation_run` (`workspace_id`,`rule_key`,`target_key`,`run_date`),
  KEY `idx_automation_run_date` (`workspace_id`,`rule_key`,`run_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='自动化规则去重与执行记录';

CREATE TABLE IF NOT EXISTS `report_subscription` (
  `id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '订阅ID',
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '空间ID',
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '订阅人',
  `report_type` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'weekly 周报 / version 版本报告',
  `enabled` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否订阅',
  `channels` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'inapp' COMMENT 'inapp/email/both',
  `weekday` tinyint NOT NULL DEFAULT '5' COMMENT '周报发送星期：1=周一…7=周日',
  `send_hour` tinyint NOT NULL DEFAULT '17' COMMENT '周报发送小时（0-23）',
  `last_sent_at` datetime DEFAULT NULL COMMENT '最近一次发送时间',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_report_subscription` (`workspace_id`,`user_id`,`report_type`),
  KEY `idx_report_subscription_type` (`report_type`,`enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='定时周报/版本报告订阅';

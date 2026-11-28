-- ============================================================================
-- 136_release_plan_share.sql · 发布计划只读分享（2026-11-28）
--
-- 背景：发布计划存的是「打算什么时候发、发哪些版本、范围有哪些工作项」。
--       把计划发给业务方 / 客户 / 协作团队时，对方不需要账号，也不应看到
--       备注、风险与内部检查；只需要时间、环境、覆盖版本和计划内容。
-- 做法：一个计划最多一条有效分享记录，token 可撤销；撤销后旧链接立即失效，
--       再次生成会换新 token。公开页只读计划范围，不返回 notes / risks。
-- 幂等：可重复执行。
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/136_release_plan_share.sql
-- ============================================================================

USE hourglass;

CREATE TABLE IF NOT EXISTS `release_plan_share` (
  `workspace_id` varchar(32) NOT NULL,
  `plan_id` varchar(32) NOT NULL,
  `token` varchar(64) NOT NULL,
  `created_by` varchar(32) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `revoked_at` datetime DEFAULT NULL COMMENT '非空=已停止分享，旧链接立即失效',
  PRIMARY KEY (`workspace_id`, `plan_id`),
  UNIQUE KEY `uk_rps_token` (`token`),
  CONSTRAINT `fk_rps_plan` FOREIGN KEY (`plan_id`, `workspace_id`)
    REFERENCES `version_release_plan` (`id`, `workspace_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='发布计划只读分享链接（一计划一条，撤销即失效）';

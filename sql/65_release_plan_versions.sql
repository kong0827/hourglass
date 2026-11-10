USE hourglass;

-- 发布计划可覆盖多个版本/多个项目；实际发布记录仍按版本独立保存。
CREATE TABLE IF NOT EXISTS `version_release_plan_version` (
  `workspace_id` varchar(32) NOT NULL,
  `plan_id` varchar(32) NOT NULL,
  `version_id` varchar(32) NOT NULL,
  `req_id` varchar(32) NOT NULL,
  PRIMARY KEY (`plan_id`,`version_id`),
  KEY `idx_plan_version_scope` (`workspace_id`,`version_id`),
  KEY `idx_plan_version_project` (`workspace_id`,`req_id`),
  CONSTRAINT `fk_plan_version_plan` FOREIGN KEY (`plan_id`,`workspace_id`) REFERENCES `version_release_plan` (`id`,`workspace_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_plan_version_version` FOREIGN KEY (`version_id`) REFERENCES `project_version` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='发布计划包含的版本（多版本/多项目）';

-- 旧计划只有单一 version_id，按原口径回填为一条关联，避免升级后计划不可见。
INSERT IGNORE INTO `version_release_plan_version` (`workspace_id`, `plan_id`, `version_id`, `req_id`)
SELECT p.`workspace_id`, p.`id`, p.`version_id`, v.`req_id`
FROM `version_release_plan` p
INNER JOIN `project_version` v ON v.`id` = p.`version_id` AND v.`workspace_id` = p.`workspace_id`;

-- 69: 成员默认职能、项目兼岗与空间标签字典。
-- 仅新增展示数据结构；不回填历史、不修改成员/项目权限；MySQL 8 幂等。
USE hourglass;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `workspace_member` ADD COLUMN `job_title` varchar(32) NULL COMMENT ''空间默认职能（仅展示，不参与鉴权）'' AFTER `company_name`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workspace_member' AND COLUMN_NAME = 'job_title');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `project_member_role` ADD COLUMN `secondary_role_titles` JSON NULL COMMENT ''项目兼岗职能数组（仅展示，不参与鉴权）'' AFTER `role_title`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_member_role' AND COLUMN_NAME = 'secondary_role_titles');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

CREATE TABLE IF NOT EXISTS workspace_member_label_option (
  workspace_id VARCHAR(32) NOT NULL COMMENT '归属空间ID',
  kind VARCHAR(16) NOT NULL COMMENT 'role / company',
  title VARCHAR(64) NOT NULL COMMENT '展示选项（不参与鉴权）',
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, kind, title)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='空间成员职能与公司选项字典，不参与鉴权';

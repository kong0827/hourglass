-- ============================================================================
-- 空间角色扩展与项目级可见范围（2026-11-03）
--
-- 背景：
--   此前空间成员只有 owner/member 两级，且空间内所有成员默认能看到全部项目。
--   本次补上「项目可见范围」：按成员 × 项目配置 不可见 / 只读 / 参与（PM/Dev/QA）。
--
-- 口径：
--   1. workspace_member.role 扩展为 owner/admin/member/viewer；
--      owner/admin 天然拥有全部项目；viewer 全局只读；member 按 project_member 配置。
--   2. project_member 只存"显式覆盖"：没有记录 = 默认参与（保持升级前全员可见的行为）。
--   3. access 取值：none（不可见）/ read（只读）/ pm、dev、qa（可参与编辑）。
--
-- 设计原则：纯增量、幂等、可重复执行；不重建表、不丢存量成员关系。
-- 执行：mysql -u root -p devstudio < sql/29_project_access.sql
-- ============================================================================

USE devstudio;

-- ---------------------------------------------------------------------------
-- workspace_member：角色取值范围扩展（列宽不变，仅更新注释，幂等）
-- ---------------------------------------------------------------------------
ALTER TABLE workspace_member
  MODIFY COLUMN role VARCHAR(16) NOT NULL DEFAULT 'member'
    COMMENT '空间角色：owner/admin/member/viewer';

-- ---------------------------------------------------------------------------
-- project_member：成员 × 项目的可见范围（无记录 = 默认参与）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_member (
  workspace_id VARCHAR(32) NOT NULL COMMENT '归属空间ID',
  project_id   VARCHAR(32) NOT NULL COMMENT '项目ID（requirement.id）',
  user_id      VARCHAR(32) NOT NULL COMMENT '成员账号ID',
  access       VARCHAR(16) NOT NULL COMMENT '可见范围：none/read/pm/dev/qa',
  created_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (workspace_id, project_id, user_id),
  KEY idx_pm_user (workspace_id, user_id),
  KEY idx_pm_project (workspace_id, project_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '项目级成员可见范围';

-- ---------------------------------------------------------------------------
-- 自检
-- ---------------------------------------------------------------------------
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workspace_member' AND COLUMN_NAME = 'role';

SELECT COUNT(*) AS project_member_exists
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_member';

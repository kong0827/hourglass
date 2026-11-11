-- ============================================================================
-- 68_member_company_project_role.sql · 成员公司与项目角色标注（2026-11-11）
--
-- 背景：
--   同一空间内会有多家公司的人协作；同一个人在不同项目担任不同角色。
--   本轮只新增两个「展示属性」，不改变任何权限：
--     1. workspace_member.company_name —— 空间级公司名，自由文本，仅展示/筛选；
--     2. project_member_role          —— 成员 × 项目的单个主角色，仅展示/筛选。
--
-- 边界：
--   company_name / role_title 不进入任何鉴权 SQL/Java；
--   workspace_member.role、project_access_mode、project_member.access 一行不改。
--
-- 幂等：MySQL 8 不支持 ADD COLUMN IF NOT EXISTS，按 information_schema 判断后执行。
-- 执行：mysql -u hourglass -p hourglass < sql/68_member_company_project_role.sql
-- ============================================================================

USE hourglass;

-- ---------------------------------------------------------------------------
-- 1) 空间成员上的公司名（NULL = 未标注；存量不回填）
-- ---------------------------------------------------------------------------
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `workspace_member` ADD COLUMN `company_name` varchar(64) NULL COMMENT ''公司名称（空间级自由文本，仅展示，不参与鉴权）'' AFTER `project_access_mode`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workspace_member' AND COLUMN_NAME = 'company_name');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 2) 项目角色标签（一人一项目一个主角色；不存权限）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_member_role (
  workspace_id VARCHAR(32) NOT NULL COMMENT '归属空间ID',
  project_id   VARCHAR(32) NOT NULL COMMENT '项目ID（requirement.id）',
  user_id      VARCHAR(32) NOT NULL COMMENT '成员账号ID',
  role_title   VARCHAR(32) NOT NULL COMMENT '项目角色展示标签（不参与鉴权）',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (workspace_id, project_id, user_id),
  KEY idx_pmr_user (workspace_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='项目角色展示标签，不参与鉴权';

-- ---------------------------------------------------------------------------
-- 3) 自检
-- ---------------------------------------------------------------------------
SELECT 'workspace_member.company_name' AS check_item,
       COUNT(*) AS present
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workspace_member' AND COLUMN_NAME = 'company_name';

SELECT 'project_member_role' AS check_item,
       COUNT(*) AS present
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_member_role';

-- ============================================================================
-- 66_project_access_assigned.sql · 新成员默认不参与项目 / 邀请时预分配（2026-11-10）
--
-- 背景：
--   此前 project_member 的口径是「没有记录 = 默认参与」，新成员一进空间就能看到全部项目，
--   只能事后逐个设「不可见」；邀请时也无法提前分配。
--
-- 本次：
--   1. workspace_member.project_access_mode 区分两种口径：
--        all      = 默认参与（存量成员全部保留该值，升级后行为不变）
--        assigned = 按项目分配（新加入成员；没有显式 write/read 的项目一律不可见）
--   2. invite_project_grant 记录邀请链接上预分配的项目权限，加入时一次性落库。
--   3. 为 assigned 成员补齐 project_member.access='none' 的种子行，
--      让列表 / 搜索 / 甘特 / 导出等既有的「NOT EXISTS none」过滤直接生效。
--   4. project_member.access 新增显式 write（可参与）；历史 pm/dev/qa 仍归一到默认参与。
--
-- 幂等：MySQL 8 不支持 ADD COLUMN IF NOT EXISTS，按 information_schema 判断后执行。
-- 执行：mysql -u hourglass -p hourglass < sql/66_project_access_assigned.sql
-- ============================================================================

USE hourglass;

-- ---------------------------------------------------------------------------
-- 1) 成员的参与模式：存量成员默认 all，加入时由应用写 assigned
-- ---------------------------------------------------------------------------
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `workspace_member` ADD COLUMN `project_access_mode` varchar(16) NOT NULL DEFAULT ''all'' COMMENT ''项目参与模式：all=默认参与（无记录即可见，存量口径）；assigned=按项目分配（未授权即不可见）'' AFTER `role`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workspace_member' AND COLUMN_NAME = 'project_access_mode');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 2) 邀请链接上的项目预分配（只存 read / write；none 不落记录 = 默认不可见）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invite_project_grant (
  invite_id    VARCHAR(16) NOT NULL COMMENT '邀请码',
  workspace_id VARCHAR(32) NOT NULL COMMENT '归属空间ID（便于空间删除时级联清理）',
  project_id   VARCHAR(32) NOT NULL COMMENT '项目ID（requirement.id）',
  access       VARCHAR(16) NOT NULL COMMENT '预分配权限：write/read',
  created_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (invite_id, project_id),
  KEY idx_ipg_ws (workspace_id),
  KEY idx_ipg_project (project_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '邀请链接预分配的项目权限';

-- ---------------------------------------------------------------------------
-- 3) 为 assigned 成员补齐「不可见」种子行
--    仅补缺，不覆盖已有 write/read/none；owner/admin/viewer 不参与
-- ---------------------------------------------------------------------------
INSERT INTO project_member (workspace_id, project_id, user_id, access)
SELECT m.workspace_id, r.id, m.user_id, 'none'
FROM workspace_member m
JOIN requirement r ON r.workspace_id = m.workspace_id
LEFT JOIN project_member pm
  ON pm.workspace_id = m.workspace_id AND pm.project_id = r.id AND pm.user_id = m.user_id
WHERE m.project_access_mode = 'assigned'
  AND m.role = 'member'
  AND pm.user_id IS NULL;

-- ---------------------------------------------------------------------------
-- 自检
-- ---------------------------------------------------------------------------
SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workspace_member'
  AND COLUMN_NAME = 'project_access_mode';

SELECT COUNT(*) AS invite_project_grant_exists
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invite_project_grant';

SELECT project_access_mode, COUNT(*) AS members
FROM workspace_member GROUP BY project_access_mode;

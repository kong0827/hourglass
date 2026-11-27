-- ============================================================================
-- 129_workspace_publication_access_scope.sql · 人工标记工作项发布改为空间可配置（2026-11-27）
--
-- 背景：人工补录「已发布」原先固定为空间主 / 管理员 / 项目负责人（且对该项目可写），
--       但不同团队希望由实际跟进发布的项目成员自行维护。这里把口径做成空间级多选配置。
-- 取值：逗号分隔的身份集合，可选 owner / admin / project_owner / project_write
--       · owner          空间主
--       · admin          管理员
--       · project_owner  项目负责人（且对该项目可写）
--       · project_write  对该项目可写的成员
--       默认 'owner,admin,project_owner'，与调整前的管理者口径一致。
-- 范围：只新增一列并给默认值，不回填业务数据；人工标记仍只影响工作项徽标与「发布态」筛选，
--       不写入 version_release、不改变 publicationState、不参与交付派生与统计。
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/129_workspace_publication_access_scope.sql
-- 可重复执行：列已存在时跳过。
-- ============================================================================

USE hourglass;

DROP PROCEDURE IF EXISTS hg_workspace_publication_access_scope;
DELIMITER $$
CREATE PROCEDURE hg_workspace_publication_access_scope()
BEGIN
  DECLARE col_count INT DEFAULT 0;
  SELECT COUNT(*) INTO col_count
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'workspace'
     AND column_name = 'publication_access_scope';
  IF col_count = 0 THEN
    ALTER TABLE `workspace`
      ADD COLUMN `publication_access_scope` VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        NOT NULL DEFAULT 'owner,admin,project_owner'
        COMMENT '可人工标记工作项发布状态的身份：owner,admin,project_owner,project_write'
        AFTER `release_access_scope`;
  END IF;
END$$
DELIMITER ;

CALL hg_workspace_publication_access_scope();
DROP PROCEDURE hg_workspace_publication_access_scope;

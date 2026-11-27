-- ============================================================================
-- 127_workspace_release_access_scope.sql · 发布维护权限改为空间可配置（2026-11-26）
--
-- 背景：维护发布计划、预览与发布记录原先固定为一种口径（近期为「对该项目可写即可」），
--       但不同团队对发布治理的严格程度不同：有的要求只有管理者能改计划，
--       有的希望项目成员直接参与。这里把口径做成空间级多选配置。
-- 取值：逗号分隔的身份集合，可选 owner / admin / project_owner / project_write
--       · owner          空间主
--       · admin          管理员
--       · project_owner  项目负责人（且对该项目可写）
--       · project_write  对该项目可写的成员
--       默认 'owner,admin,project_owner'，与调整前的管理者口径一致。
-- 范围：只新增一列并给默认值，不回填业务数据；查看者永远无权，不受此配置影响。
--       版本的新建 / 编辑 / 内容调整仍按项目写权限，不读这一列。
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/127_workspace_release_access_scope.sql
-- 可重复执行：列已存在时跳过。
-- ============================================================================

USE hourglass;

DROP PROCEDURE IF EXISTS hg_workspace_release_access_scope;
DELIMITER $$
CREATE PROCEDURE hg_workspace_release_access_scope()
BEGIN
  DECLARE col_count INT DEFAULT 0;
  SELECT COUNT(*) INTO col_count
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'workspace'
     AND column_name = 'release_access_scope';
  IF col_count = 0 THEN
    ALTER TABLE `workspace`
      ADD COLUMN `release_access_scope` VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        NOT NULL DEFAULT 'owner,admin,project_owner'
        COMMENT '可维护发布计划与发布记录的身份：owner,admin,project_owner,project_write'
        AFTER `notify_last_status`;
  END IF;
END$$
DELIMITER ;

CALL hg_workspace_release_access_scope();
DROP PROCEDURE hg_workspace_release_access_scope;

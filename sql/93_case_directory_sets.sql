-- ============================================================================
-- 93_case_directory_sets.sql · 模块目录层级 + 用例归属节点 + 用例集（自定义分组）
--
-- 背景：test_case.module 是自由文本，test_module 是平铺字典，既不能按功能域分层归类，
-- 也没有「一条用例进多个分组」的容器。本脚本把归类与分组拆成两种关系：
--   1) 模块目录（单归属）：test_module 增 parent_id 形成树（服务层限 3 级），
--      test_case 增 module_id 指向节点；module 文本保留为展示快照，移动时同步改写。
--   2) 用例集（多归属）：case_set + case_set_item，成员是引用不是复制，删集不删用例。
--      visibility=team 项目成员可见可用；personal 仅创建人可见可改。分组本身不写入证据链，
--      证据仍由测试计划与发布必测汇总（把分组圈选进计划才进证据）。
--
-- 回填：按 (workspace_id, req_id, module 文本) 匹配已有字典节点补 module_id；
-- 匹配不到的文本补建顶级节点后再补 module_id。只补 module_id IS NULL 的行，
-- 不改 module 文本、不动编号与执行历史，可重复执行。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/93_case_directory_sets.sql
-- ============================================================================

USE hourglass;

-- 1. 目录层级：parent_id 用空串表示顶级，唯一键才能约束同级同名
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `test_module`
     ADD COLUMN `parent_id` varchar(32) NOT NULL DEFAULT '''' COMMENT ''父目录ID（test_module.id），空串=顶级'' AFTER `req_id`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'test_module' AND column_name = 'parent_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `test_module` ADD KEY `idx_ws_req_parent` (`workspace_id`,`req_id`,`parent_id`)',
  'DO 0') FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'test_module' AND index_name = 'idx_ws_req_parent');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 旧唯一键按项目约束同名，分层后同名节点可挂在不同父目录下，改为按「项目 + 父目录 + 名称」
SET @s := (SELECT IF(COUNT(*) > 0,
  'ALTER TABLE `test_module` DROP KEY `uk_ws_req_name`',
  'DO 0') FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'test_module' AND index_name = 'uk_ws_req_name');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `test_module` ADD UNIQUE KEY `uk_ws_req_parent_name` (`workspace_id`,`req_id`,`parent_id`,`name`)',
  'DO 0') FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'test_module' AND index_name = 'uk_ws_req_parent_name');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 2. 用例归属节点
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `test_case`
     ADD COLUMN `module_id` varchar(32) DEFAULT NULL COMMENT ''所属目录节点ID（test_module.id）；module 为展示快照'' AFTER `module`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'test_case' AND column_name = 'module_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `test_case` ADD KEY `idx_ws_req_module` (`workspace_id`,`req_id`,`module_id`)',
  'DO 0') FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'test_case' AND index_name = 'idx_ws_req_module');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 2.1 自由文本没有对应字典节点时补建顶级节点（名称沿用原文本，不推断层级）
INSERT INTO `test_module` (`id`, `workspace_id`, `req_id`, `parent_id`, `name`, `sort_order`)
SELECT REPLACE(UUID(), '-', ''), t.workspace_id, t.req_id, '', t.module, 0
FROM (SELECT DISTINCT `workspace_id`, `req_id`, `module`
      FROM `test_case`
      WHERE `module` IS NOT NULL AND `module` <> '') t
WHERE NOT EXISTS (SELECT 1 FROM `test_module` m
                  WHERE m.`workspace_id` = t.`workspace_id`
                    AND m.`req_id` = t.`req_id`
                    AND m.`name` = t.`module`);

-- 2.2 按文本匹配补 module_id（只补空值，已有归属不动）
UPDATE `test_case` c
JOIN `test_module` m
  ON m.`workspace_id` = c.`workspace_id` AND m.`req_id` = c.`req_id` AND m.`name` = c.`module`
SET c.`module_id` = m.`id`
WHERE c.`module_id` IS NULL AND c.`module` IS NOT NULL AND c.`module` <> '';

-- 3. 用例集：团队共享 / 仅自己可见
CREATE TABLE IF NOT EXISTS `case_set` (
  `id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用例集ID',
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `req_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属项目ID（requirement.id）',
  `name` varchar(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分组名称',
  `note` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '用途说明（这批用例服务于哪次测试目的）',
  `visibility` varchar(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'team' COMMENT 'team=团队共享（项目成员可见）/personal=仅自己可见（仅创建人）',
  `owner_user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT 'personal 时为创建人账号ID；team 为空串',
  `created_by` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '创建人显示名',
  `created_by_user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '创建人账号ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_set_name` (`workspace_id`,`req_id`,`visibility`,`owner_user_id`,`name`),
  KEY `idx_ws_req` (`workspace_id`,`req_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用例集（自定义分组，多归属；引用用例不复制）';

CREATE TABLE IF NOT EXISTS `case_set_item` (
  `set_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用例集ID（case_set.id）',
  `case_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用例ID（test_case.id）',
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `created_by_user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '加入分组的账号ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '加入时间',
  PRIMARY KEY (`set_id`,`case_id`),
  KEY `idx_ws_case` (`workspace_id`,`case_id`),
  KEY `idx_ws_set` (`workspace_id`,`set_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用例集成员（引用；删除分组不删除用例）';
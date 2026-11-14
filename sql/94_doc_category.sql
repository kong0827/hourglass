-- ============================================================================
-- 94_doc_category.sql · 文档分类树 + 空间级文档（2026-11-14）
--
-- 背景：文档原来只能「先选项目再建文档」，开发手册等不归属任何项目的资料无处安放，
-- 也没有按功能域分层归类的能力。本脚本参照测试模块目录（test_module）引入文档分类：
--   1) 分类（单归属归类）：doc_category 是一棵树，req_id 空串=空间级、非空=项目级，
--      parent_id 空串=顶级；不限层级（服务层做环 guard），同级同名唯一。
--   2) 文档挂分类：requirement_doc.category_id 指向分类节点（可空=未分类）；
--      文档原有的 parent_id 父子层级保留，分类是其上的归类层，两者语义不同。
--   3) 空间级文档：requirement_doc.req_id 改为可空，NULL=不归属任何项目（空间级），
--      写权限走「非查看者成员」（ProjectAccessService.assertWrite 对 null 项目已实现该口径，
--      与 dev_branch.req_id 可空的空间级公共分支一致）。
--
-- 设计原则：纯增量、幂等、可重复执行；不改旧数据语义。
--   · 存量文档 category_id=NULL（未分类）、req_id 保持原项目，行为与升级前一致；
--   · 分类拖拽排序/移动本期不做（服务层 update 仅改名，移动留待后续）。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/94_doc_category.sql
-- ============================================================================

USE hourglass;

-- 1. 文档分类树：req_id 空串=空间级，parent_id 空串=顶级，唯一键约束同级同名
CREATE TABLE IF NOT EXISTS `doc_category` (
  `id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分类ID',
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `req_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '所属项目ID（requirement.id）；空串=空间级分类',
  `parent_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '父分类ID（doc_category.id）；空串=顶级',
  `name` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分类名称',
  `sort_order` int NOT NULL DEFAULT 0 COMMENT '同级排序（小的在前）',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ws_req_parent_name` (`workspace_id`,`req_id`,`parent_id`,`name`),
  KEY `idx_ws_req` (`workspace_id`,`req_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档分类树（单归属归类；req_id 空串=空间级，不限层级）';

-- 2. 文档挂分类：category_id 可空（NULL=未分类），存量文档不受影响
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `requirement_doc`
     ADD COLUMN `category_id` varchar(32) DEFAULT NULL COMMENT ''所属分类ID（doc_category.id）；NULL=未分类'' AFTER `parent_id`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'requirement_doc' AND column_name = 'category_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `requirement_doc` ADD KEY `idx_doc_category` (`workspace_id`,`category_id`)',
  'DO 0') FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'requirement_doc' AND index_name = 'idx_doc_category');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 3. 空间级文档：req_id 由 NOT NULL 改为可空（NULL=空间级）。仅在当前仍为 NOT NULL 时执行，幂等。
SET @s := (SELECT IF(COUNT(*) > 0,
  'ALTER TABLE `requirement_doc`
     MODIFY COLUMN `req_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''所属项目ID（requirement.id）；NULL=空间级文档''',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'requirement_doc' AND column_name = 'req_id' AND is_nullable = 'NO');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 自检：应看到新表、requirement_doc 的 category_id 列与可空的 req_id
-- ---------------------------------------------------------------------------
SELECT COUNT(*) AS doc_category_exists
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_name = 'doc_category';

SELECT column_name, column_type, is_nullable, column_default, column_comment
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'requirement_doc'
  AND column_name IN ('req_id', 'category_id')
ORDER BY ordinal_position;
-- ============================================================================
-- 文档层级、Markdown 格式与「需求池 ↔ 文档」关联（2026-11-03）
--
-- 背景：
--   1. 文档需要在项目内支持父子层级，而不是全部平铺；
--   2. 新文档支持 Markdown，旧文档继续保留 HTML 富文本，用 format 区分；
--   3. 需求池里的需求可以关联具体文档（多对多），例如需求 → PRD / 技术方案 / 验收文档。
--
-- 设计原则：纯增量、幂等、可重复执行；不改旧字段语义，旧数据默认 format='html'、parent_id=NULL。
-- 执行：mysql -u root -p devstudio < sql/28_doc_tree_links.sql
-- ============================================================================

USE devstudio;

-- ---------------------------------------------------------------------------
-- requirement_doc：父文档、正文格式、同级排序
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement_doc' AND COLUMN_NAME = 'parent_id');
SET @s := IF(@x = 0,
  'ALTER TABLE requirement_doc ADD COLUMN parent_id VARCHAR(32) DEFAULT NULL COMMENT ''父文档ID（同项目内层级，空=根文档）'' AFTER req_id',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement_doc' AND COLUMN_NAME = 'format');
SET @s := IF(@x = 0,
  'ALTER TABLE requirement_doc ADD COLUMN format VARCHAR(16) NOT NULL DEFAULT ''html'' COMMENT ''正文格式：html 富文本 / markdown'' AFTER content',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement_doc' AND COLUMN_NAME = 'sort_order');
SET @s := IF(@x = 0,
  'ALTER TABLE requirement_doc ADD COLUMN sort_order INT NOT NULL DEFAULT 0 COMMENT ''同级排序（小的在前）'' AFTER status',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement_doc' AND INDEX_NAME = 'idx_doc_parent');
SET @s := IF(@x = 0,
  'ALTER TABLE requirement_doc ADD KEY idx_doc_parent (workspace_id, req_id, parent_id)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- demand_doc_link：需求池需求与文档多对多
-- 约束由服务层保证：同一空间、同一项目下才能关联，避免跨项目串数据。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demand_doc_link (
  workspace_id VARCHAR(32) NOT NULL COMMENT '归属空间ID',
  demand_id    VARCHAR(32) NOT NULL COMMENT '需求池需求ID（demand.id）',
  doc_id       VARCHAR(32) NOT NULL COMMENT '文档ID（requirement_doc.id）',
  created_by   VARCHAR(32) DEFAULT NULL COMMENT '建立关联的账号ID',
  created_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '关联时间',
  PRIMARY KEY (workspace_id, demand_id, doc_id),
  KEY idx_ddl_doc (workspace_id, doc_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '需求池需求 ↔ 文档关联';

-- ---------------------------------------------------------------------------
-- 自检
-- ---------------------------------------------------------------------------
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement_doc'
  AND COLUMN_NAME IN ('parent_id', 'format', 'sort_order')
ORDER BY ORDINAL_POSITION;

SELECT COUNT(*) AS demand_doc_link_exists
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demand_doc_link';

USE hourglass;

-- 文档 P0：模板、评论闭环、文档附件。
-- 只增结构，不回填、不推断历史；旧评论保持平铺，resolved_at 为空表示未解决。

CREATE TABLE IF NOT EXISTS `doc_template` (
  `id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模板ID',
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `name` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模板名称',
  `doc_type` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'other' COMMENT '适用文档分类',
  `format` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'markdown' COMMENT '正文格式：html / markdown',
  `content` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '模板正文骨架',
  `created_by` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '创建人账号ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ws_name` (`workspace_id`,`name`),
  KEY `idx_ws` (`workspace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档自定义模板（内置模板在代码中）';

-- 评论：一层回复、解决状态、@提及、转工作项回链。
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `req_doc_comment`
     ADD COLUMN `parent_id` varchar(32) DEFAULT NULL COMMENT ''父评论ID（一层回复；空=顶层评论）'' AFTER `quote_text`,
     ADD COLUMN `resolved_at` datetime DEFAULT NULL COMMENT ''解决时间（空=未解决）'' AFTER `parent_id`,
     ADD COLUMN `resolved_by` varchar(32) DEFAULT NULL COMMENT ''解决人账号ID'' AFTER `resolved_at`,
     ADD COLUMN `mentions` text COMMENT ''@提及账号ID JSON 数组'' AFTER `resolved_by`,
     ADD COLUMN `task_id` varchar(32) DEFAULT NULL COMMENT ''由评论转出的工作项ID'' AFTER `mentions`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'req_doc_comment' AND column_name = 'parent_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `req_doc_comment` ADD KEY `idx_doc_parent` (`doc_id`,`parent_id`)',
  'DO 0') FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'req_doc_comment' AND index_name = 'idx_doc_parent');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `req_doc_comment` ADD KEY `idx_doc_resolved` (`doc_id`,`resolved_at`)',
  'DO 0') FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'req_doc_comment' AND index_name = 'idx_doc_resolved');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 附件目标类型扩展为 doc；结构不变，仅口径说明。
SET @s := (SELECT IF(COUNT(*) > 0,
  'ALTER TABLE `attachment` MODIFY COLUMN `target_kind` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''task'' COMMENT ''目标类型：task任务/demand需求池需求/case_run执行记录/comment任务评论/doc文档''',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'attachment' AND column_name = 'target_kind');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

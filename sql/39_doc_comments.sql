-- 文档评论
USE hourglass;

CREATE TABLE IF NOT EXISTS `req_doc_comment` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '评论ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `doc_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '文档ID（requirement_doc.id）',
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '评论人账号ID',
  `content` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '评论正文',
  `quote_text` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '引用的正文片段（批注上下文）',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_doc_created` (`doc_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档评论';

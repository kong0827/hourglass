-- 文档引用与反链：正文 hgdoc:// 站内协议链接落库，支撑阅读页「引用 / 被引用」
USE hourglass;

CREATE TABLE `doc_link` (
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `from_doc_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '引用方文档ID（requirement_doc.id）',
  `to_doc_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '被引用文档ID',
  `created_by` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '建立引用的账号',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '建立时间',
  PRIMARY KEY (`workspace_id`,`from_doc_id`,`to_doc_id`),
  KEY `idx_backlinks` (`workspace_id`,`to_doc_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档间引用关系（保存正文时按 hgdoc:// 解析重建）';

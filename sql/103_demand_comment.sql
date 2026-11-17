-- ============================================================================
-- 103_demand_comment.sql · 需求池评论（2026-11-17）
--
-- 需求池条目（demand）的讨论与批注：一层回复、解决/重开、@提及、转工作项。
-- 与文档评论 req_doc_comment 的能力口径一致，但独立建表：需求池条目硬删除、
-- 没有划线引用，两张表各自跟随归属对象的生命周期。
-- 评论区随需求删除一并硬删除；评论转出的工作项保留，只解除 task_id 回链。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/103_demand_comment.sql
-- 可重复执行；只建表，不回填。
-- ============================================================================

USE hourglass;

CREATE TABLE IF NOT EXISTS `demand_comment` (
  `id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '评论ID',
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `demand_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '需求ID（demand.id）',
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '评论人账号ID',
  `content` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '评论正文',
  `parent_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '父评论ID（一层回复；空=顶层评论）',
  `resolved_at` datetime DEFAULT NULL COMMENT '解决时间（空=未解决）',
  `resolved_by` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '解决人账号ID',
  `mentions` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '@提及账号ID JSON 数组',
  `task_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '由评论转出的工作项ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_demand_created` (`workspace_id`,`demand_id`,`created_at`),
  KEY `idx_demand_parent` (`demand_id`,`parent_id`),
  KEY `idx_task` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求池评论（一层回复、解决、@提及、转工作项）';

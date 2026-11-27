-- ============================================================================
-- 131_doc_favorite.sql · 文档收藏
--
-- 背景：文档页此前只有「目录树 / 列表 / 看板 / 动态」四个视角，全部以空间或项目为
-- 主体，缺少「我个人」视角。日常回访主要靠翻目录。本脚本补个人收藏：
--   每人每篇文档最多一条收藏，跨设备跟随账号；不可见的文档在收藏列表里同样被过滤
--   （可见口径与文档列表一致），不会出现「收藏了却打不开」。
--
-- 回填：无需回填。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/131_doc_favorite.sql
-- ============================================================================

USE hourglass;

CREATE TABLE IF NOT EXISTS `doc_favorite` (
  `doc_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '文档ID（requirement_doc.id）',
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '收藏人账号ID（workspace_member.user_id）',
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '收藏时间',
  PRIMARY KEY (`doc_id`,`user_id`),
  KEY `idx_ws_user` (`workspace_id`,`user_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档收藏（每人每篇一条）';

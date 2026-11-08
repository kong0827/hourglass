-- 项目模板：项目级测试模块清单
-- 用例的 module 仍是自由文本；本表保存模板预置/后续维护的模块，
-- 让「模块」在没有用例时也能作为可选项出现，并参与列表筛选与覆盖矩阵。
USE hourglass;

CREATE TABLE IF NOT EXISTS `test_module` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模块ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `req_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属项目ID（requirement.id）',
  `name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模块名',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '排序（小的在前）',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ws_req_name` (`workspace_id`,`req_id`,`name`),
  KEY `idx_ws_req` (`workspace_id`,`req_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目测试模块（模板预置 + 手动维护）';

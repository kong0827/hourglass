-- 优先级显示配置：P0-P3 存储档位不变，仅显示名与颜色按空间可配。
-- 未配置的空间/档位不写行，由后端返回内置默认「紧急/高/中/低」。
CREATE TABLE IF NOT EXISTS `workspace_priority` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '配置ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `code` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '固定档位：P0/P1/P2/P3',
  `name` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '显示名',
  `color` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '显示颜色 #RRGGBB',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ws_code` (`workspace_id`,`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='优先级显示配置（按空间，未配置档位用内置默认）';

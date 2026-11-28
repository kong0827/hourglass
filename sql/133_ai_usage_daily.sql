-- ============================================================================
-- 133_ai_usage_daily.sql · AI 助手用量日聚合
--
-- 背景：助手只能看到单次回答的 token，管理员无法判断额度花在哪、哪类问题最常用。
-- 本脚本按「空间 + 日期 + 回答类型」聚合调用次数、失败数、token 与耗时；
-- 只存计数，不存用户问题原文、回答正文、模型名或 Key。
--
-- 回填：无需回填，上线后开始累计。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/133_ai_usage_daily.sql
-- ============================================================================

USE hourglass;

CREATE TABLE IF NOT EXISTS `ai_usage_daily` (
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `day` date NOT NULL COMMENT '统计日期（服务器本地时区）',
  `intent` varchar(48) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '回答类型：answer / query:xxx / create_task / error 等',
  `calls` int NOT NULL DEFAULT '0' COMMENT '调用次数',
  `failures` int NOT NULL DEFAULT '0' COMMENT '失败次数',
  `prompt_tokens` bigint NOT NULL DEFAULT '0' COMMENT '输入 token 合计',
  `completion_tokens` bigint NOT NULL DEFAULT '0' COMMENT '输出 token 合计',
  `total_ms` bigint NOT NULL DEFAULT '0' COMMENT '端到端耗时合计（毫秒）',
  PRIMARY KEY (`workspace_id`,`day`,`intent`),
  KEY `idx_ai_usage_day` (`day`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI 助手用量日聚合（不存问题原文）';

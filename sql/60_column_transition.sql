USE hourglass;

-- ============================================================================
-- 60_column_transition.sql · 看板列状态流转规则（2026-11-09）
--
-- 每个空间一份「来源列 → 目标列」规则，取值：
--   allow  - 允许（默认）
--   reason - 需填原因后才能移动
--   deny   - 禁止移动
--
-- 规则只存显式配置过的格子；没有记录即按默认：
--   已完成 → 非已完成 = reason，其余 = allow。
-- 列 id 含系统列 done（不落 board_column），删除列时同步清理相关规则。
-- ============================================================================

CREATE TABLE IF NOT EXISTS `column_transition` (
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `from_column` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '来源列ID',
  `to_column` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '目标列ID',
  `rule` varchar(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '流转规则：allow/reason/deny',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`workspace_id`,`from_column`,`to_column`),
  KEY `idx_ws_to` (`workspace_id`,`to_column`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='看板列状态流转规则（每空间一份）';

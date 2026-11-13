USE hourglass;

-- ============================================================================
-- 71_task_description_html.sql · 任务描述支持富文本图片（2026-11-13）
--
--   task.description  varchar(2000) -> mediumtext
--
-- 历史纯文本数据无需迁移：前端按"无 HTML 标签则纯文本渲染"兼容。
-- 可重复执行。
-- ============================================================================

ALTER TABLE task
  MODIFY COLUMN `description` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '描述（支持富文本 HTML）';

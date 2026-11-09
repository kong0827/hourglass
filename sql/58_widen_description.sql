USE hourglass;

-- ============================================================================
-- 58_widen_description.sql · 扩大描述类字段（2026-11-09）
--
--   task.description                    varchar(200)  -> varchar(2000)
--   task_completion_record.description  varchar(200)  -> varchar(2000)（完成快照与任务描述同长）
--   requirement.description             varchar(160)  -> varchar(1000)
-- 只放宽长度，不改数据；可重复执行。
-- ============================================================================

ALTER TABLE task
  MODIFY COLUMN `description` varchar(2000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '描述';

ALTER TABLE task_completion_record
  MODIFY COLUMN `description` varchar(2000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '任务详情（完成时快照）';

ALTER TABLE requirement
  MODIFY COLUMN `description` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '项目描述';

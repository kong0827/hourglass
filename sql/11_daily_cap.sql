-- ============================================================================
-- 工作台 · 每个账号的「每天工时上限」（2026-10-23）
--
-- 背景：原来固定每人每天最多计 8 小时，现在改成可配置（1-24 小时）。
--       上限是"人的属性"：跨任务、跨空间一起扣减。
--
-- 设计原则：纯增量、幂等、向后兼容（老记录取默认 8）。
--
-- 执行：mysql -u hourglass -p hourglass < sql/11_daily_cap.sql
-- ============================================================================

USE hourglass;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'work_max_hours');
SET @s := IF(@x = 0,
  'ALTER TABLE app_user ADD COLUMN work_max_hours TINYINT NOT NULL DEFAULT 8 COMMENT ''每人每天最多计入几小时（1-24）'' AFTER work_end_hour',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 自检
-- ---------------------------------------------------------------------------
SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user'
  AND COLUMN_NAME IN ('work_start_hour', 'work_end_hour', 'work_max_hours')
ORDER BY ORDINAL_POSITION;

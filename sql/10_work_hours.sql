-- ============================================================================
-- 工作台 · 每个账号的「工作时段」（2026-10-23）
--
-- 背景：计时以前按自然日 00:00 切段，忘停表过夜时凌晨一过就重新开始计。
--       现在只有工作时段内的时长计入工时（默认 09:00–18:00，每人可自己调），
--       0 点至 9 点、18 点之后都不再累计。
--
-- 设计原则：纯增量、幂等、向后兼容。
--   · 只 ADD COLUMN，老记录取默认值 9 / 18；
--   · 用 information_schema 判断 + PREPARE，可重复执行。
--
-- 执行：mysql -u hourglass -p hourglass < sql/10_work_hours.sql
-- ============================================================================

USE hourglass;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'work_start_hour');
SET @s := IF(@x = 0,
  'ALTER TABLE app_user ADD COLUMN work_start_hour TINYINT NOT NULL DEFAULT 9 COMMENT ''每天几点开始计入工时（0-23）'' AFTER role',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'work_end_hour');
SET @s := IF(@x = 0,
  'ALTER TABLE app_user ADD COLUMN work_end_hour TINYINT NOT NULL DEFAULT 18 COMMENT ''每天几点之后不再计入（1-24，24=当天24:00）'' AFTER work_start_hour',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 自检
-- ---------------------------------------------------------------------------
SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user'
  AND COLUMN_NAME IN ('work_start_hour', 'work_end_hour')
ORDER BY ORDINAL_POSITION;

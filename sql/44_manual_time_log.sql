-- ============================================================================
-- 工时手工补记：time_log 区分记录来源与备注
--
-- 1. origin：timer = 计时器产生（既有记录全部是 timer）；manual = 手工补记。
--    实际工时 = 两类记录总和，各报表口径不变、自动生效。
-- 2. note：手工补记的备注（计时记录不用）。
--
-- 幂等：列用 information_schema 判断，可重复执行；不涉及存量回填（默认值即正确口径）。
-- ============================================================================
USE hourglass;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'time_log' AND COLUMN_NAME = 'origin');
SET @s := IF(@x = 0,
  'ALTER TABLE time_log ADD COLUMN origin VARCHAR(16) NOT NULL DEFAULT ''timer'' COMMENT ''记录来源：timer=计时器，manual=手工补记'' AFTER minutes',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @y := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'time_log' AND COLUMN_NAME = 'note');
SET @s2 := IF(@y = 0,
  'ALTER TABLE time_log ADD COLUMN note VARCHAR(200) DEFAULT NULL COMMENT ''手工补记备注'' AFTER origin',
  'DO 0');
PREPARE st2 FROM @s2; EXECUTE st2; DEALLOCATE PREPARE st2;

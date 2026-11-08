USE hourglass;

-- ============================================================================
-- 47_task_log_column_width.sql · 任务移动日志的列 ID 宽度修正（2026-11-07）
--
-- 问题：board_column.id / task.board_column 已在 32 号脚本放宽到 VARCHAR(24)，
--       但 task_log.from_column / to_column 仍是 VARCHAR(16)。新建自定义看板列
--       的 ID 是 Ids.gen("C") 生成的 17 位（1 + 时间戳36进制 + 8 位随机），
--       移入/移出这类列时写移动日志会报 Data too long，整次移动事务回滚。
--
-- 处理：两列统一放宽到 VARCHAR(24)，纯增量、幂等，可重复执行。
-- ============================================================================

SET @x := (SELECT CHARACTER_MAXIMUM_LENGTH
           FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_log' AND COLUMN_NAME = 'from_column');
SET @s := IF(@x IS NOT NULL AND @x < 24,
  'ALTER TABLE task_log MODIFY COLUMN from_column VARCHAR(24) DEFAULT NULL COMMENT ''移动前所在看板列 id（仅 action=move 且跨列时非空）''',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT CHARACTER_MAXIMUM_LENGTH
           FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_log' AND COLUMN_NAME = 'to_column');
SET @s := IF(@x IS NOT NULL AND @x < 24,
  'ALTER TABLE task_log MODIFY COLUMN to_column VARCHAR(24) DEFAULT NULL COMMENT ''移动后所在看板列 id（仅 action=move 且跨列时非空）''',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

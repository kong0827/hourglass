USE hourglass;

-- ============================================================================
-- 32_board_column_id_width.sql · 看板列 ID 宽度修正（2026-11-04）
--
-- 问题：board_column.id 与 task.board_column 原为 VARCHAR(16)，而 Ids.gen("C")
--       生成 1 + 36进制时间戳(8) + 8 位随机后缀 = 17 位。新建自定义看板列会
--       报 Data too long，或非严格模式下截断后任务归列错位。
-- 处理：两列统一放宽到 VARCHAR(24)，纯增量、幂等，可重复执行。
-- ============================================================================

SET @x := (SELECT CHARACTER_MAXIMUM_LENGTH
           FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'board_column' AND COLUMN_NAME = 'id');
SET @s := IF(@x IS NOT NULL AND @x < 24,
  'ALTER TABLE board_column MODIFY COLUMN id VARCHAR(24) NOT NULL COMMENT ''列ID''',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT CHARACTER_MAXIMUM_LENGTH
           FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'board_column');
SET @s := IF(@x IS NOT NULL AND @x < 24,
  'ALTER TABLE task MODIFY COLUMN board_column VARCHAR(24) NOT NULL DEFAULT ''backlog'' COMMENT ''看板列 id''',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

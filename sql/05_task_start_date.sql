-- ============================================================================
-- 工作台 · 任务「开始日期」增量迁移（2026-10-19）
--
-- 背景：日历原来只在截止日那一格显示任务。用户反馈"任务从开始到结束都在做，
--       应该每天都能在日历上看到"。为此新增 task.start_date：
--       · 为空 → 保持原行为，只出现在截止日那一格；
--       · 有值 → 在 [start_date, due_date] 区间每天出现（截止日高亮，其余弱化）。
--
-- 设计原则：纯增量、幂等、向后兼容。
--   · 只 ADD COLUMN，不 DROP、不改类型、不动数据；
--   · 老数据 start_date 为 NULL，行为与升级前完全一致；
--   · 用 information_schema 判断 + PREPARE 动态执行（不依赖存储过程权限），可重复执行。
--
-- 执行：mysql -u hourglass -p hourglass < sql/05_task_start_date.sql
-- ============================================================================

USE hourglass;

-- ---------------------------------------------------------------------------
-- task：开始日期
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'start_date');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD COLUMN start_date DATE DEFAULT NULL COMMENT ''开始日期（空=只在截止日出现在日历上）'' AFTER board_column',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 自检：应能看到 start_date 列
-- ---------------------------------------------------------------------------
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME IN ('start_date', 'due_date');

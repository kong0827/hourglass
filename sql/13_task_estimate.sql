-- ============================================================================
-- 工作台 · 任务的「预估耗时」（2026-10-23）
--
-- 为什么需要它：start_date 是"什么时候接到的"，不是"什么时候开始干"。
-- 一个任务可能今天创建、下周才真正动手，拿 [开始, 完成] 算工期会把等待时间也算进去，
-- 得出的"效率"完全失真。真正的可比基准只有两个数：
--   · 预估：人自己填的 estimate_minutes
--   · 实际：time_log 累计的 minutes（已经按工作时段折算、跳过周末、每天封顶）
-- 两者相除就是这个人的估时系数。
--
-- 单位用**分钟**，和 time_log.minutes 同单位，避免浮点比较。
--
-- 设计原则：纯增量、幂等、向后兼容（照 sql/10 的写法）。
-- 执行：mysql -u hourglass -p hourglass < sql/13_task_estimate.sql
-- ============================================================================

USE hourglass;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'estimate_minutes');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD COLUMN estimate_minutes INT DEFAULT NULL
     COMMENT ''预估耗时（分钟，空=没估过）'' AFTER progress',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 自检
SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task'
  AND COLUMN_NAME = 'estimate_minutes';

-- ============================================================================
-- 112_task_test_estimate.sql · 工作项「测试预估」（2026-11-19）
--
-- 背景：
--   工作项只有一个整体预估 estimate_minutes，包含开发与测试。成员负载页的
--   剩余预估、负载、超载判定都只按「负责人」算，测试负责人手里即使有
--   待测试 / 测试中的项，剩余与负载也恒为 0。
--
-- 口径：
--   新增 test_estimate_minutes（分钟，空=没估过）。测试剩余 =
--   max(0, 测试预估 − 测试窗口内已计工时)，只对测试负责人身份下的
--   「待测试 / 测试中」工作项累加，并入该成员的总负载；整体预估
--   estimate_minutes 的含义与开发剩余不变，两者各自独立、互不扣减。
--   测试窗口沿用 test_started_at → test_finished_at，未结束的本轮不结算。
--
-- 边界：
--   只加一个可空列，不改历史数据、不回填。不填测试预估的项按 0 计，
--   测试身份负载相应不受影响。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/112_task_test_estimate.sql
-- 可重复执行；只增列，不迁移历史数据。
-- ============================================================================

USE hourglass;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `task` ADD COLUMN `test_estimate_minutes` int NULL COMMENT ''测试预估（分钟，空=没估过）''',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'test_estimate_minutes');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

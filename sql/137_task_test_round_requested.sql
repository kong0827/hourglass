-- ============================================================================
-- 137_task_test_round_requested.sql · 本轮提测时间（2026-11-28）
--
-- 背景：test_requested_at 目前每轮提测都会刷新，一个字段同时承担「首次提测」和
--       「本轮排队起点」两种语义；后续要把首次提测定为不可变的总周期基线，
--       看板「待测试」排队时长与 3 天预警必须先有独立的「本轮起点」可读。
-- 口径：进入「待测试」（从测试中退回队列除外）或跳过待测试直接进入「测试中」时
--       写入当前分钟，与 test_requested_at 的写入时机一致；
--       测试中 → 待测试的退回不改，等待时长延续本轮。
--       存量不回填：为空时前端回退读 test_requested_at，与旧行为完全一致。
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/137_task_test_round_requested.sql
-- 可重复执行：列已存在时跳过。
-- ============================================================================

USE hourglass;

DROP PROCEDURE IF EXISTS hg_task_test_round_requested;
DELIMITER $$
CREATE PROCEDURE hg_task_test_round_requested()
BEGIN
  DECLARE col_count INT DEFAULT 0;
  SELECT COUNT(*) INTO col_count
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'task'
     AND column_name = 'test_round_requested_at';
  IF col_count = 0 THEN
    ALTER TABLE `task`
      ADD COLUMN `test_round_requested_at` datetime DEFAULT NULL
        COMMENT '本轮提测时间：进入待测试（退回队列除外）或直接进测试中时写入；空回退 test_requested_at'
        AFTER `test_requested_at`;
  END IF;
END$$
DELIMITER ;

CALL hg_task_test_round_requested();
DROP PROCEDURE hg_task_test_round_requested;
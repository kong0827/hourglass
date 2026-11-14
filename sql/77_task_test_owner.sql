-- ============================================================================
-- 77_task_test_owner.sql · 测试负责人与提测时间（2026-11-13）
--
-- 负责人（owner）仍是开发责任人，不因提测改写；测试负责人独立记录。
-- 「待测试」是领取队列，「测试中」是已认领状态：进入测试中且未指定测试负责人时
-- 由服务端自动记为操作者，批量移动不自动认领。
--
-- 测试时间窗精确到分钟：已有 DATE 值保留为当天 00:00，不回填、不推断历史时刻。
-- 提测时间只在进入「待测试」或新一轮直接进入「测试中」时由服务端写入。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/77_task_test_owner.sql
-- 可重复执行；只增列 / 改精度 / 加索引，不迁移历史数据。
-- ============================================================================

USE hourglass;

DROP PROCEDURE IF EXISTS hg_test_owner_column;
DELIMITER $$
CREATE PROCEDURE hg_test_owner_column(IN table_name_value VARCHAR(64), IN column_name_value VARCHAR(64), IN definition_value TEXT)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = DATABASE() AND table_name = table_name_value AND column_name = column_name_value) THEN
    SET @test_owner_ddl = CONCAT('ALTER TABLE `', table_name_value, '` ADD COLUMN `', column_name_value, '` ', definition_value);
    PREPARE test_owner_stmt FROM @test_owner_ddl;
    EXECUTE test_owner_stmt;
    DEALLOCATE PREPARE test_owner_stmt;
  END IF;
END$$
DELIMITER ;

CALL hg_test_owner_column('task', 'test_owner_user_id', 'VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT ''测试负责人账号ID；空=待领取''');
CALL hg_test_owner_column('task', 'test_owner', 'VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT ''测试负责人显示名快照''');
CALL hg_test_owner_column('task', 'test_requested_at', 'DATETIME NULL COMMENT ''进入待测试 / 新一轮直接开始测试的提测时间''');

DROP PROCEDURE hg_test_owner_column;

-- 时间窗改为 DATETIME：DATE 旧值按 00:00:00 保留，不伪造具体时刻。
DROP PROCEDURE IF EXISTS hg_test_owner_time;
DELIMITER $$
CREATE PROCEDURE hg_test_owner_time()
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'task'
               AND column_name = 'test_started_at' AND data_type = 'date') THEN
    ALTER TABLE `task` MODIFY COLUMN `test_started_at` DATETIME NULL COMMENT '进入测试中的时间（新一轮测试重新记录）';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'task'
               AND column_name = 'test_finished_at' AND data_type = 'date') THEN
    ALTER TABLE `task` MODIFY COLUMN `test_finished_at` DATETIME NULL COMMENT '离开测试中的时间：测试通过或退回';
  END IF;
END$$
DELIMITER ;

CALL hg_test_owner_time();
DROP PROCEDURE hg_test_owner_time;

SET @test_owner_idx = (SELECT COUNT(*) FROM information_schema.statistics
                       WHERE table_schema = DATABASE() AND table_name = 'task'
                         AND index_name = 'idx_ws_test_owner');
SET @test_owner_idx_ddl = IF(@test_owner_idx = 0,
  'ALTER TABLE `task` ADD KEY `idx_ws_test_owner` (`workspace_id`,`test_owner_user_id`,`board_column`)',
  'SELECT 1');
PREPARE test_owner_idx_stmt FROM @test_owner_idx_ddl;
EXECUTE test_owner_idx_stmt;
DEALLOCATE PREPARE test_owner_idx_stmt;

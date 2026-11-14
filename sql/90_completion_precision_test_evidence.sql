USE hourglass;

-- 完成时间升为分钟级：与 test_requested_at / test_started_at / test_finished_at 同口径，
-- 同一天内「开发完成 → 测试 → 发布」的阶段时长可以直接相减。历史 DATE 值转换后为当日 00:00，不伪造时刻。
SET @s := (SELECT IF(COUNT(*) > 0,
  'ALTER TABLE `task` MODIFY COLUMN `completed_at` datetime DEFAULT NULL COMMENT ''完成时间（分钟级；历史日期为当日 00:00）''',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'task' AND column_name = 'completed_at' AND data_type = 'date');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) > 0,
  'ALTER TABLE `task_completion_record` MODIFY COLUMN `completed_at` datetime NOT NULL COMMENT ''完成时间（分钟级；历史日期为当日 00:00）''',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'task_completion_record' AND column_name = 'completed_at' AND data_type = 'date');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) > 0,
  'ALTER TABLE `version_release_item` MODIFY COLUMN `completed_at` datetime DEFAULT NULL COMMENT ''快照时的工作项完成时间（分钟级）''',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'version_release_item' AND column_name = 'completed_at' AND data_type = 'date');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 完成快照补测试侧证据：任务被彻底删除后快照是唯一留存（BUG-6 A 口径），
-- 缺这五列会让「谁测的 / 测了多久」随任务删除一起消失。
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `task_completion_record`
     ADD COLUMN `test_owner_user_id` varchar(32) DEFAULT NULL COMMENT ''测试负责人账号ID；空=未指派'' AFTER `owner_user_id`,
     ADD COLUMN `test_owner` varchar(32) DEFAULT NULL COMMENT ''测试负责人显示名快照'' AFTER `test_owner_user_id`,
     ADD COLUMN `test_requested_at` datetime DEFAULT NULL COMMENT ''提测时间'' AFTER `test_owner`,
     ADD COLUMN `test_started_at` datetime DEFAULT NULL COMMENT ''开始测试时间'' AFTER `test_requested_at`,
     ADD COLUMN `test_finished_at` datetime DEFAULT NULL COMMENT ''结束测试时间'' AFTER `test_started_at`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'task_completion_record' AND column_name = 'test_owner_user_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
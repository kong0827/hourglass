USE hourglass;

-- 92：用例创建人与执行环境。
-- 1) test_case 增 created_by / created_by_user_id：创建人只在创建时写一次，
--    与「最近执行人」（latest_by）分开；存量用例不回填、不推断，展示为未记录。
-- 2) test_case_run 增 environment：每轮执行的发现环境（浏览器/版本/设备），
--    转缺陷时预填到缺陷任务；存量流水没有环境记录，留空。
-- 只增结构，幂等可重复执行；不构造历史证据。

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `test_case`
     ADD COLUMN `created_by` varchar(32) DEFAULT NULL COMMENT ''创建人显示名（创建时写入，不随执行变化）'' AFTER `latest_bug_task_id`,
     ADD COLUMN `created_by_user_id` varchar(32) DEFAULT NULL COMMENT ''创建人账号ID（app_user.id）'' AFTER `created_by`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'test_case' AND column_name = 'created_by');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `test_case_run`
     ADD COLUMN `environment` varchar(120) DEFAULT NULL COMMENT ''执行环境（浏览器/版本/设备，转缺陷时预填）'' AFTER `note`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'test_case_run' AND column_name = 'environment');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
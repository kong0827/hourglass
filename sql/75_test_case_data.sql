-- 测试用例：新增测试数据列（A1 用例详情 / Excel 迁移）
-- test_data：执行时要准备或输入的数据（账号、金额、边界值等），与前置条件分开记录
-- 末尾三条只补 skipped 注释，不改类型与约束；跳过状态历史值为空，无需转换。
-- 幂等：先探测列再执行，支持重复执行与 deploy.sh 增量路径。
USE hourglass;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'test_case' AND COLUMN_NAME = 'test_data');
SET @s := IF(@x = 0,
  'ALTER TABLE test_case ADD COLUMN test_data varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''测试数据（账号/金额/边界值等）'' AFTER precondition',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

ALTER TABLE `test_case`
  MODIFY COLUMN `latest_status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL
  COMMENT '最近执行结果：passed/failed/blocked/skipped，空=未执行';

ALTER TABLE `test_case_run`
  MODIFY COLUMN `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL
  COMMENT '执行结果：passed/failed/blocked/skipped';

ALTER TABLE `test_plan_case`
  MODIFY COLUMN `result` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL
  COMMENT '计划内最近结果：passed/failed/blocked/skipped，空=未执行';

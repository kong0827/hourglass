-- ============================================================================
-- 测试计划 + 批量执行（A2 测试最小闭环）
-- test_plan      ：回归/迭代测试的容器（draft → running → done），归属项目；
-- test_plan_case ：计划圈选的用例 + 计划内最近结果（批量执行时回写）；
-- test_case_run.plan_id：批量执行写入的流水可回溯所属计划。
-- 执行：mysql -u hourglass -p hourglass < sql/55_test_plan.sql
-- 幂等：可重复执行（CREATE IF NOT EXISTS；ALTER 按 information_schema 判断后跳过）。
-- ============================================================================

USE hourglass;

CREATE TABLE IF NOT EXISTS `test_plan` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '计划ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `req_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属项目ID（requirement.id）',
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '计划名称',
  `version_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关联版本ID（project_version.id，选填）',
  `planned_start` date DEFAULT NULL COMMENT '计划开始日',
  `planned_end` date DEFAULT NULL COMMENT '计划结束日',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft' COMMENT '状态：draft/running/done',
  `note` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '说明/范围',
  `created_by` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '创建人显示名',
  `created_by_user_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '创建人账号ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_ws_req` (`workspace_id`,`req_id`),
  KEY `idx_ws_status` (`workspace_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='测试计划（项目下的回归/迭代容器）';

CREATE TABLE IF NOT EXISTS `test_plan_case` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联ID',
  `plan_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属计划ID（test_plan.id）',
  `case_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用例ID（test_case.id）',
  `result` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '计划内最近结果：passed/failed/blocked，空=未执行',
  `note` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '计划内执行备注',
  `executed_by` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '计划内执行人显示名',
  `executed_by_user_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '计划内执行人账号ID',
  `executed_at` datetime DEFAULT NULL COMMENT '计划内执行时间',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '加入计划时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_plan_case` (`plan_id`,`case_id`),
  KEY `idx_case` (`case_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='测试计划圈选用例（含计划内最近结果）';

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `test_case_run` ADD COLUMN `plan_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''所属测试计划ID（计划批量执行时写入；空=单用例执行）'' AFTER `bug_task_id`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'test_case_run' AND COLUMN_NAME = 'plan_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `test_case_run` ADD KEY `idx_plan` (`plan_id`,`id`)',
  'DO 0')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'test_case_run' AND INDEX_NAME = 'idx_plan');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 测试用例：用例实体 + 执行流水（最近一轮结果冗余在 test_case 便于列表展示）
CREATE TABLE IF NOT EXISTS `test_case` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用例ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `req_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属项目ID（requirement.id）',
  `title` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用例标题',
  `precondition` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '前置条件',
  `steps` mediumtext COLLATE utf8mb4_unicode_ci COMMENT '执行步骤 JSON：[{"action":"操作","expected":"预期结果"}]',
  `latest_status` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '最近执行结果：passed/failed/blocked，空=未执行',
  `latest_note` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '最近执行备注',
  `latest_by` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '最近执行人显示名',
  `latest_by_user_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '最近执行人账号ID',
  `latest_at` datetime DEFAULT NULL COMMENT '最近执行时间',
  `latest_bug_task_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '最近失败转出的缺陷任务ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_ws_req` (`workspace_id`,`req_id`),
  KEY `idx_bug` (`latest_bug_task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='测试用例（项目下，展示最近一轮执行结果）';

-- 用例执行流水：每次执行一行，供追溯；最近一轮冗余在 test_case
CREATE TABLE IF NOT EXISTS `test_case_run` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '执行记录ID',
  `case_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用例ID（test_case.id）',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '执行结果：passed/failed/blocked',
  `note` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '执行备注（失败原因等）',
  `bug_task_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '由本次失败转出的缺陷任务ID',
  `executed_by` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '执行人显示名',
  `executed_by_user_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '执行人账号ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '执行时间',
  PRIMARY KEY (`id`),
  KEY `idx_case` (`case_id`,`id`),
  KEY `idx_ws` (`workspace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用例执行流水（每次执行一行）';

-- ============================================================================
-- 88_case_task_traceability.sql · 用例 ↔ 工作项多对多 + 计划「发布必测」
--
-- 背景：test_case.demand_id 只到需求级，无法回答「哪条用例验证了哪个工作项」。
-- 本脚本新增 test_case_task 关联表，一条用例可验证多个工作项；用例仍保留单个主需求
-- （test_case.demand_id），关联的工作项必须属于该主需求。
--
-- test_plan_case.required 标记「发布必测」：发布检查按该标记判断必测用例是否执行通过，
-- 不再靠优先级或计划名称推断。
--
-- 幂等：建表 IF NOT EXISTS；加列先探测 information_schema。脚本不 backfill：
-- 历史用例没有工作项关联时保持「需求级覆盖」，不按需求下的工作项强行补链。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/88_case_task_traceability.sql
-- ============================================================================

USE hourglass;

CREATE TABLE IF NOT EXISTS `test_case_task` (
  `id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联ID',
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `case_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用例ID（test_case.id）',
  `task_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '工作项ID（task.id）',
  `created_by` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '建立关联的账号ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '建立关联时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_case_task` (`case_id`,`task_id`),
  KEY `idx_ws_case` (`workspace_id`,`case_id`),
  KEY `idx_ws_task` (`workspace_id`,`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用例验证的工作项（多对多；工作项须与用例主需求一致）';

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `test_plan_case` ADD COLUMN `required` tinyint(1) NOT NULL DEFAULT 0 COMMENT ''发布必测：1=发布检查必须执行并通过'' AFTER `result`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'test_plan_case' AND column_name = 'required');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

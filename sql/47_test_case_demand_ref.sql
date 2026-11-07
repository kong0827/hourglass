-- 测试用例关联需求（选填）：用例 → 需求池条目的软关联
-- demand_id 为空 = 不关联；需求删除时由 DemandService 级联解绑（置 NULL）
USE hourglass;

ALTER TABLE `test_case`
  ADD COLUMN `demand_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关联需求ID（demand.id，选填）' AFTER `req_id`,
  ADD KEY `idx_demand` (`demand_id`);

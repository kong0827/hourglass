-- 编号序列：删除行后编号不回收（需求 DM / 用例 TC / 发布计划 PL）
-- 82–85 的取号是 MAX(...)+1：删掉当前最大号的那一行，下一个新行会重新拿到同一个号，
-- 已经发出去的编号就撞车了。这里把"下一个号"单独记在 number_seq，取号只自增、回看 MAX 仅用于回填。
-- 工作项走软删除，回收站里的行仍占号，不在本表口径内；发布记录（REL）没有删除入口，也不在此列。
-- 幂等：建表与回填都用 IF NOT EXISTS / INSERT IGNORE。
USE hourglass;

CREATE TABLE IF NOT EXISTS `number_seq` (
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '空间ID',
  `kind` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'demand / case / plan',
  `scope_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '项目ID；空间级序列（计划）为空串',
  `next_no` int NOT NULL DEFAULT 0 COMMENT '下一个可发的编号',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`workspace_id`,`kind`,`scope_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='人类可读编号序列：只增不减，删除行不回收编号';

-- 回填：从当前最大号接着发。迁移之前的回收已经发生，无法追回，迁移后不再回收。
INSERT IGNORE INTO number_seq (workspace_id, kind, scope_id, next_no)
SELECT workspace_id, 'demand', req_id, COALESCE(MAX(demand_no), 0)
FROM demand
GROUP BY workspace_id, req_id;

INSERT IGNORE INTO number_seq (workspace_id, kind, scope_id, next_no)
SELECT workspace_id, 'case', req_id, COALESCE(MAX(case_no), 0)
FROM test_case
GROUP BY workspace_id, req_id;

INSERT IGNORE INTO number_seq (workspace_id, kind, scope_id, next_no)
SELECT workspace_id, 'plan', '', COALESCE(MAX(plan_no), 0)
FROM version_release_plan
GROUP BY workspace_id;

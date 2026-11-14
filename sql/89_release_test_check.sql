USE hourglass;

-- 发布前测试检查策略（项目级）：strict 严格 / standard 标准 / loose 宽松。
-- 检查只读取用例与计划结果，不改变任务状态；确认发布时把结论冻结进 version_release.plan_snapshot.testEvidence。
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `requirement` ADD COLUMN `release_check_policy` varchar(16) NOT NULL DEFAULT ''standard'' COMMENT ''发布前测试检查：strict 严格 / standard 标准 / loose 宽松'' AFTER `status`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'requirement' AND column_name = 'release_check_policy');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

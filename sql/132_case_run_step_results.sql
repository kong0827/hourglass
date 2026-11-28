-- 用例执行流水增加逐步执行结果：执行弹框逐步勾选（通过/失败/阻塞 + 每步备注）结构化落库
USE hourglass;

ALTER TABLE `test_case_run`
  ADD COLUMN `step_results` mediumtext COLLATE utf8mb4_unicode_ci DEFAULT NULL
  COMMENT '逐步执行结果 JSON：[{"idx":1,"status":"passed|failed|blocked","note":""}]，空=未逐步勾选' AFTER `note`;

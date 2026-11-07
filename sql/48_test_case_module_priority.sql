-- 测试用例：新增功能模块与优先级档位（A1 用例列表筛选）
-- module：自由填写的功能模块名，列表筛选与 datalist 候选用
-- priority：P0/P1/P2/P3 档位，与任务优先级同一套码值；空 = 未设置
USE hourglass;

ALTER TABLE `test_case`
  ADD COLUMN `module` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '功能模块（自由填写，筛选用）' AFTER `precondition`,
  ADD COLUMN `priority` varchar(8) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '优先级档位：P0/P1/P2/P3，空=未设置' AFTER `module`;

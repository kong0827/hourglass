-- ============================================================================
-- 138_release_plan_name.sql · 发布计划名称（2026-11-28）
--
-- 背景：发布计划此前只有空间内编号（PL-001）与版本名，列表标题靠「版本名 + 环境」
--       拼接，跨项目计划没有给人读的名称。原型把「计划名称」作为向导第 1 步必填项。
-- 口径：值为展示用名称（如「12-08 多项目生产发布」），长度 ≤120；存量计划留空，
--       前端与列表回退到「版本名 + 环境」拼接，行为不变。
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/138_release_plan_name.sql
-- 可重复执行：列已存在时跳过。
-- ============================================================================

USE hourglass;

DROP PROCEDURE IF EXISTS hg_release_plan_name;
DELIMITER $$
CREATE PROCEDURE hg_release_plan_name()
BEGIN
  DECLARE col_count INT DEFAULT 0;
  SELECT COUNT(*) INTO col_count
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'version_release_plan'
     AND column_name = 'name';
  IF col_count = 0 THEN
    ALTER TABLE `version_release_plan`
      ADD COLUMN `name` varchar(120) DEFAULT NULL
        COMMENT '计划名称：给人读的窗口名；空时前端回退为「版本名 + 环境」'
        AFTER `plan_no`;
  END IF;
END$$
DELIMITER ;

CALL hg_release_plan_name();
DROP PROCEDURE hg_release_plan_name;

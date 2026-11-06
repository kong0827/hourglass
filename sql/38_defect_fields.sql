USE hourglass;

-- ============================================================================
-- 38_defect_fields.sql · 缺陷专属字段（2026-11-06）
--
-- 工作项类型已有 bug，但只有类型徽标，无法记录严重度、发现环境、复现步骤、
-- 发现版本与回归状态，也无法做缺陷趋势统计。沿用「加列不加表」口径。
-- ============================================================================

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'severity');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD COLUMN severity VARCHAR(16) NULL COMMENT ''缺陷严重度：blocker阻断/critical严重/major一般/minor轻微'' AFTER item_type',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'environment');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD COLUMN environment VARCHAR(120) NULL COMMENT ''缺陷发现环境（浏览器/版本/设备等）'' AFTER severity',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'reproduce_steps');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD COLUMN reproduce_steps TEXT NULL COMMENT ''缺陷复现步骤'' AFTER environment',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'found_version_id');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD COLUMN found_version_id VARCHAR(32) NULL COMMENT ''缺陷发现版本ID（project_version）'' AFTER reproduce_steps',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'regression_status');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD COLUMN regression_status VARCHAR(16) NULL COMMENT ''回归状态：pending待回归/passed通过/failed不通过'' AFTER found_version_id',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 存量缺陷任务补默认严重度：新代码要求 bug 必须有 severity，
-- 不回填会导致历史缺陷在编辑任意字段时被「缺陷必须选择严重度」拦住。
UPDATE task SET severity = 'major' WHERE item_type = 'bug' AND severity IS NULL;

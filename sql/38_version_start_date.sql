-- 版本补计划开始日期：与目标发布日期共同构成版本周期窗口（版本即迭代，承载双周/月度更新节奏）。
-- 执行：mysql -u hourglass -p hourglass < sql/38_version_start_date.sql
-- 幂等：先探测列再添加，重复执行安全。
USE hourglass;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_version' AND COLUMN_NAME = 'start_date'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE project_version ADD COLUMN start_date DATE DEFAULT NULL COMMENT ''计划开始日期'' AFTER status',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

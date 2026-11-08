-- ============================================================================
-- 账号停用/启用（A4 治理底线）
-- 语义：停用 ≠ 删除。历史数据、负责人引用、空间成员关系全部保留，
--       只阻断新登录并让在线会话立即失效（会话代次 bump）。
-- 执行：mysql -u hourglass -p hourglass < sql/54_account_disabled.sql
-- 幂等：列已存在时跳过。
-- ============================================================================

USE hourglass;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `app_user` ADD COLUMN `disabled` tinyint(1) NOT NULL DEFAULT 0 COMMENT ''1=账号已停用：不可登录、会话即刻失效；历史数据与负责人引用保留'' AFTER `role`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'disabled');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

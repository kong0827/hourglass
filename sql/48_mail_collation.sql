USE hourglass;

-- ============================================================================
-- 48_mail_collation.sql · 邮件表排序规则统一（2026-11-07）
--
-- 问题：mail_delivery / mail_setting 在 26 号脚本里只写了 DEFAULT CHARSET=utf8mb4，
--       MySQL 8 会落到 utf8mb4_0900_ai_ci，而其余业务表都是 utf8mb4_unicode_ci。
--       MailDeliveryMapper.deleteByWorkspaceReferences() 会把 reference_id 与
--       task.id / demand.id 做列间比较，MySQL 直接报 1267 Illegal mix of collations，
--       导致清空空间 / 覆盖导入在清理待发邮件时失败并整体回滚。
--
-- 处理：统一转为 utf8mb4_unicode_ci，纯增量、幂等，可重复执行。
-- ============================================================================

SET @x := (SELECT TABLE_COLLATION
           FROM information_schema.TABLES
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mail_delivery');
SET @s := IF(@x IS NOT NULL AND @x <> 'utf8mb4_unicode_ci',
  'ALTER TABLE mail_delivery CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT TABLE_COLLATION
           FROM information_schema.TABLES
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mail_setting');
SET @s := IF(@x IS NOT NULL AND @x <> 'utf8mb4_unicode_ci',
  'ALTER TABLE mail_setting CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ============================================================================
-- 修正邮件 outbox / SMTP 配置表的排序规则
-- 背景：26_email_notification.sql 建表时未指定 COLLATE，MySQL 8 会落到库默认
--       的 utf8mb4_0900_ai_ci；与本库其余表的 utf8mb4_unicode_ci 不一致，
--       删除空间数据时 mail_delivery.reference_id 与 task.id 比较会报
--       ERROR 1267 Illegal mix of collations。
-- 执行：mysql -u hourglass -p hourglass < sql/52_mail_collation.sql
-- 幂等：可重复执行。
-- ============================================================================

USE hourglass;

ALTER TABLE mail_setting  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE mail_delivery CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT TABLE_NAME, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('mail_setting', 'mail_delivery');

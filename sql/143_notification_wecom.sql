-- ============================================================================
-- 143_notification_wecom.sql · 企业微信独立通知渠道（2026-11-28）
--
-- 背景：企微应用消息此前挂在「站内或邮件已送达」之后，成员把这两个渠道都关掉时
--       即使绑定了企微也收不到。本轮把企微做成与站内/邮件并列的个人事件渠道。
-- 口径：wecom_enabled 只对 task_assigned / test_plan_assigned / release_prep 三类事件
--       有意义，其余事件恒为空；为空时视为默认开启（保持升级前行为）。
-- 表数：只加列，不新增表，执行后仍为 105 张表。
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/143_notification_wecom.sql
-- 可重复执行：列已存在时跳过。
-- ============================================================================

USE hourglass;

DROP PROCEDURE IF EXISTS hg_notification_wecom;
DELIMITER $$
CREATE PROCEDURE hg_notification_wecom()
BEGIN
  DECLARE col_count INT DEFAULT 0;
  SELECT COUNT(*) INTO col_count
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'user_notification_preference'
     AND column_name = 'wecom_enabled';
  IF col_count = 0 THEN
    ALTER TABLE `user_notification_preference`
      ADD COLUMN `wecom_enabled` tinyint(1) DEFAULT NULL
        COMMENT '企业微信应用消息：仅指派/测试指派/发布准备使用；NULL 视为默认开启'
        AFTER `email_enabled`;
  END IF;
END$$
DELIMITER ;

CALL hg_notification_wecom();
DROP PROCEDURE hg_notification_wecom;
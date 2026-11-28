-- ============================================================================
-- 144_release_push_wecom.sql · 发布准备手动推送增加按人企业微信渠道（2026-11-28）
--
-- 背景：手动「推送提醒」此前只有站内、邮件与企业微信群；企微按人只在
--       指派 / 测试指派 / 发布准备里程碑的自动通知里投递，指定成员收不到。
-- 口径：wecom_at 记录该收件人本批推送是否已按绑定企业入队；NULL 表示未走企微。
-- 表数：只加列，不新增表，执行后仍为 105 张表。
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/144_release_push_wecom.sql
-- 可重复执行：列已存在时跳过。
-- ============================================================================

USE hourglass;

DROP PROCEDURE IF EXISTS hg_release_push_wecom;
DELIMITER $$
CREATE PROCEDURE hg_release_push_wecom()
BEGIN
  DECLARE col_count INT DEFAULT 0;
  SELECT COUNT(*) INTO col_count
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'version_release_plan_push_recipient'
     AND column_name = 'wecom_at';
  IF col_count = 0 THEN
    ALTER TABLE `version_release_plan_push_recipient`
      ADD COLUMN `wecom_at` datetime DEFAULT NULL
        COMMENT '按人企业微信入队时间；NULL 表示本批未走企微'
        AFTER `email_at`;
  END IF;
END$$
DELIMITER ;

CALL hg_release_push_wecom();
DROP PROCEDURE hg_release_push_wecom;
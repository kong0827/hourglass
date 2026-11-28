-- ============================================================================
-- 145_wecom_group_robot.sql · 按企业配置企业微信群机器人（2026-11-28）
--
-- 背景：一个空间可能同时启用甲方与多家供应商的企业微信，发布准备提醒原来只能发到
--       空间级的一个群机器人；甲方与供应商各自有群时，无法按企业分别送达。
-- 口径：wecom_group_robot 按 (workspace_id, corp_id) 登记群机器人，CorpID 必须是本空间
--       已启用的企业；Webhook 只接受企微官方 /cgi-bin/webhook/send 地址，保存 AES-GCM 密文，
--       接口不回显 key。发布准备推送按收件人绑定的企业筛选机器人，只发到相关企业的群。
-- 表数：新增 1 张表，执行后 105 → 106 张。
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/145_wecom_group_robot.sql
-- 可重复执行：表已存在时跳过。
-- ============================================================================

USE hourglass;

CREATE TABLE IF NOT EXISTS `wecom_group_robot` (
  `id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '群机器人配置ID',
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '空间ID',
  `corp_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属企业 CorpID（本空间已启用）',
  `name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '群名称，便于区分',
  `webhook_cipher` varchar(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '群机器人 Webhook 密文（AES-GCM，v1: 前缀）',
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT 'active/disabled',
  `last_sent_at` datetime DEFAULT NULL COMMENT '最近一次发送时间',
  `last_result` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '最近一次发送结果摘要',
  `created_by` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '创建人',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_wecom_group_robot_name` (`workspace_id`,`corp_id`,`name`),
  KEY `idx_wecom_group_robot_ws` (`workspace_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='空间按企业配置的企业微信群机器人';
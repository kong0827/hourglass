-- ============================================================================
-- 142_wecom.sql · 企业微信多企业免登与消息（2026-11-28）
--
-- 背景：一个空间里可能同时有甲方和多家供应商，各方有各自的企业微信企业与自建应用
--       （不同 CorpID / 自建应用 / 可信域名），不能按「一个部署一个 corp」设计。
--
-- 口径：
--   * 企业按部署登记（wecom_corp），一个部署可登记多家；secret 只存 AES-GCM 密文。
--   * 空间按需启用企业（wecom_corp_space），未启用不能登录该空间、不能收该空间消息。
--   * 身份绑定唯一键是 (corp_id, wecom_userid)；同一人在多家企业各一条，不自动合并。
--   * OAuth state 一次性落库（wecom_oauth_state），携带企业/用途/目标，不引入 Redis。
--   * 消息发送按企业记录（wecom_msg_log），失败可按企业重试。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/142_wecom.sql
-- 可重复执行：表已存在时跳过。
-- 增量后全库 105 张表（此前 99 + 141 api_token + 本次 5 张）。
-- ============================================================================

USE hourglass;

CREATE TABLE IF NOT EXISTS `wecom_corp` (
  `id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '企业配置ID',
  `corp_key` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '入口短键（不可猜测，可重置）',
  `corp_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '企业 CorpID（OAuth appid）',
  `corp_name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '企业显示名',
  `agent_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '自建应用 AgentId',
  `secret_cipher` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '应用 Secret 密文（AES-GCM，v1: 前缀）',
  `callback_base_url` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '该企业可信域名下的沙漏根地址，如 https://pm.corp.com/hourglass',
  `auth_mode` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'self_built' COMMENT 'self_built=自建应用；agent=代开发（预留）',
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT 'active/disabled',
  `remark` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注（如密钥托管方式/环境变量名）',
  `created_by` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '登记人',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_wecom_corp_key` (`corp_key`),
  UNIQUE KEY `uk_wecom_corp_id` (`corp_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='企业微信企业配置（一个部署多家）';

CREATE TABLE IF NOT EXISTS `wecom_corp_space` (
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '空间ID',
  `corp_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '企业 CorpID',
  `created_by` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '启用人',
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`workspace_id`,`corp_id`),
  KEY `idx_wecom_corp_space_corp` (`corp_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='空间启用的企业微信企业';

CREATE TABLE IF NOT EXISTS `wecom_user_bind` (
  `id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '绑定ID',
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '本地账号ID',
  `corp_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '企业 CorpID',
  `wecom_userid` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '企微成员 UserID（统一小写）',
  `bind_source` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'admin/self',
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT 'active/disabled',
  `bound_by` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '操作人',
  `bound_at` datetime NOT NULL,
  `last_login_at` datetime DEFAULT NULL COMMENT '最近一次企微登录',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_wecom_bind_corp_user` (`corp_id`,`wecom_userid`),
  UNIQUE KEY `uk_wecom_bind_user_corp` (`user_id`,`corp_id`),
  KEY `idx_wecom_bind_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='企微成员与本地账号绑定（按企业隔离）';

CREATE TABLE IF NOT EXISTS `wecom_oauth_state` (
  `state` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '一次性随机串（[A-Za-z0-9]）',
  `purpose` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'login/bind',
  `corp_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '发起授权的企业',
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'bind 用途：发起绑定的本地账号',
  `target` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '回跳站内路径',
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '入口所在空间（可选）',
  `expires_at` datetime NOT NULL,
  `consumed_at` datetime DEFAULT NULL COMMENT '消费时间；非空即已用',
  `client_ip` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`state`),
  KEY `idx_wecom_state_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='企微 OAuth 一次性 state';

CREATE TABLE IF NOT EXISTS `wecom_msg_log` (
  `id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '日志ID',
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '空间ID',
  `corp_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '企业 CorpID',
  `agent_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '应用 AgentId',
  `event_type` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '事件类型',
  `touser_text` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '接收 userid（截断留痕）',
  `msgtype` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'textcard 等',
  `title` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '消息标题',
  `payload_json` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '重试用请求体',
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'success/partial/failed',
  `errcode` int DEFAULT NULL,
  `errmsg` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `invaliduser` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '无效/无权限成员',
  `msgid` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `attempts` int NOT NULL DEFAULT '1' COMMENT '已尝试次数',
  `next_retry_at` datetime DEFAULT NULL COMMENT '下次重试时间；空表示不重试',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_wecom_msg_corp_created` (`corp_id`,`created_at`),
  KEY `idx_wecom_msg_status_retry` (`status`,`next_retry_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='企业微信应用消息发送日志';
-- ============================================================================
-- 141_api_token.sql · 对外 API 个人访问令牌（2026-11-28）
--
-- 背景：接口此前只有会话 Cookie 一种身份，外部工具（Qoder、脚本）无法安全接入。
-- 本脚本新增个人访问令牌表：只存 SHA-256 哈希与展示前缀，明文令牌只在创建时返回一次。
--   scope=read 为当前唯一可签发类型；write 枚举预留给后续写接口。
--   epoch 记录签发时的 app_user.session_version，改密码 / 重置 / 角色变更后旧令牌自动失效。
--
-- 回填：无需回填。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/141_api_token.sql
-- 可重复执行：表已存在时跳过。
-- ============================================================================

USE hourglass;

CREATE TABLE IF NOT EXISTS `api_token` (
  `id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '令牌ID',
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属账号ID',
  `name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用户起的名字',
  `prefix` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '展示前缀，如 hg_9f3a2c1b',
  `token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'SHA-256(完整令牌) 十六进制',
  `scope` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'read' COMMENT 'read|write',
  `epoch` bigint NOT NULL COMMENT '签发时 app_user.session_version',
  `expires_at` datetime NULL COMMENT '为空表示不过期',
  `last_used_at` datetime NULL COMMENT '最近使用，按 5 分钟节流回写',
  `revoked_at` datetime NULL COMMENT '撤销时间',
  `created_at` datetime NOT NULL COMMENT '创建时间',
  `created_ip` varchar(64) NULL COMMENT '创建来源 IP',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_api_token_hash` (`token_hash`),
  KEY `idx_api_token_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对外 API 个人访问令牌';
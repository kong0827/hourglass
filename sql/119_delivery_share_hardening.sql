-- ============================================================================
-- 119_delivery_share_hardening.sql · 交付说明分享补强（2026-11-21）
--
-- 在原有「有效期 / 访问次数 / 停止分享」之上补充：
--   password_hash   访问密码（BCrypt，可空）
--   allowed_domains 域名白名单，逗号分隔（可空，空=不限制）
--   watermark_text  接收人页与打印水印文字（可空）
-- 另建访问明细表，记录每次打开/下载的时间、IP、来源域名与 UA，用于分享效果统计。
--
-- 执行：mysql -u hourglass -p --default-character-set=utf8mb4 hourglass < sql/119_delivery_share_hardening.sql
-- 可重复执行；只加列与建表，不改存量数据。
-- ============================================================================

USE hourglass;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `delivery_note_share` ADD COLUMN `password_hash` varchar(100) NULL COMMENT ''访问密码（BCrypt）'' AFTER `allow_download`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'delivery_note_share' AND COLUMN_NAME = 'password_hash');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `delivery_note_share` ADD COLUMN `allowed_domains` varchar(500) NULL COMMENT ''域名白名单，逗号分隔；空=不限制'' AFTER `password_hash`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'delivery_note_share' AND COLUMN_NAME = 'allowed_domains');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `delivery_note_share` ADD COLUMN `watermark_text` varchar(100) NULL COMMENT ''接收人页水印文字'' AFTER `allowed_domains`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'delivery_note_share' AND COLUMN_NAME = 'watermark_text');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

CREATE TABLE IF NOT EXISTS `delivery_note_share_visit` (
  `id` varchar(32) NOT NULL COMMENT '访问记录ID',
  `workspace_id` varchar(32) NOT NULL,
  `snapshot_id` varchar(32) NOT NULL,
  `share_token` varchar(64) NOT NULL,
  `action` varchar(16) NOT NULL DEFAULT 'view' COMMENT 'view=打开 unlock=密码通过 download=下载',
  `ip` varchar(64) DEFAULT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  `referer` varchar(255) DEFAULT NULL,
  `domain` varchar(100) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_dnsv_snapshot` (`workspace_id`, `snapshot_id`, `created_at`),
  KEY `idx_dnsv_token` (`share_token`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='交付说明分享访问明细';

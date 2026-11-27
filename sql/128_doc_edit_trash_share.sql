-- ============================================================================
-- 128_doc_edit_trash_share.sql · 文档回收站 + 分享链接选项（2026-11-26）
--
-- 背景：
--   1) 删除文档原先直接物理删除，误删只能找库还原。补软删除 + 回收站（保留 30 天）。
--   2) 分享链接原先固定 30 天、不可关闭复制/打印。补 allow_copy 开关；有效期由
--      接口按 7/30/90 天写入 expires_at，无需新增列。
-- 说明：
--   deleted_at 为空即在正常列表/搜索中；回收站只查非空。
--   allow_copy 默认 1，存量链接行为不变。
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/128_doc_edit_trash_share.sql
-- 可重复执行：列/索引已存在时跳过。
-- ============================================================================

USE hourglass;

-- 1. 文档软删除标记
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `requirement_doc`
     ADD COLUMN `deleted_at` datetime NULL DEFAULT NULL COMMENT ''移入回收站时间；NULL=正常'',
     ADD COLUMN `deleted_by` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
       NULL DEFAULT NULL COMMENT ''删除人账号ID''',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'requirement_doc' AND column_name = 'deleted_at');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `requirement_doc` ADD KEY `idx_ws_deleted` (`workspace_id`,`deleted_at`)',
  'DO 0') FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'requirement_doc' AND index_name = 'idx_ws_deleted');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 2. 分享链接：是否允许复制与打印
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `req_doc_share`
     ADD COLUMN `allow_copy` tinyint(1) NOT NULL DEFAULT 1
       COMMENT ''1=允许复制与打印 / 0=仅在线阅读''',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'req_doc_share' AND column_name = 'allow_copy');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

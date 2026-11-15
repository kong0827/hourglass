-- ============================================================================
-- 99_doc_visibility.sql · 文档可见范围（照用例分组三档）
--
-- 背景：文档此前只有「草稿仅负责人 + 空间管理员」一层保护，已发布文档完全跟随
-- 项目可见范围，没有文档级开关。本脚本补文档级可见范围：
--   team    团队共享（默认，等同升级前行为）
--   members 指定成员（负责人 + 名单，最多 50 人）
--   personal 仅自己（只有负责人）
-- 可见 = 项目可见范围 ∩ 文档可见范围；只对已发布文档生效，草稿仍仅负责人 + 管理员。
-- 空间管理员同样受可见范围约束（不在名单即不可见），与 case_set 口径一致。
--
-- 回填：无需回填，存量文档默认 team，行为与升级前完全一致。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/99_doc_visibility.sql
-- ============================================================================

USE hourglass;

-- 1. requirement_doc.visibility
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `requirement_doc`
     ADD COLUMN `visibility` varchar(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
       NOT NULL DEFAULT ''team''
       COMMENT ''team=团队共享 / members=指定成员可见 / personal=仅自己（仅对已发布生效）''
       AFTER `published_at`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'requirement_doc' AND column_name = 'visibility');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 2. 指定成员名单：成员是引用不是复制，删文档 / 删项目 / 删空间都只解除引用
CREATE TABLE IF NOT EXISTS `doc_visibility_member` (
  `doc_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '文档ID（requirement_doc.id）',
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '可见成员账号ID（workspace_member.user_id）',
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '加入名单时间',
  PRIMARY KEY (`doc_id`,`user_id`),
  KEY `idx_ws_user` (`workspace_id`,`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档指定可见成员（visibility=members 时生效）';

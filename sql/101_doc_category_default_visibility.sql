-- ============================================================================
-- 101_doc_category_default_visibility.sql · 文档分类默认可见范围
--
-- 背景：文档可见范围是文档级设置，同一目录下每篇要单独调。本脚本给分类加一层
-- 「默认值」：新建文档挂在分类上且未显式指定可见范围时，把分类默认复制成文档
-- 自己的可见范围（之后每篇仍可单独改）。
--
-- 口径：
--   - 只是默认值，不参与任何可见判定；已存在文档、把文档换到该分类都不自动改。
--   - 列表存逗号分隔的账号 ID（最多 50 人，与 requirement_doc 的 members 档一致）。
--   - 不新建表，不需要级联清理或备份结构调整。
--   - 无需回填，存量分类默认 team，行为与升级前一致。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/101_doc_category_default_visibility.sql
-- ============================================================================

USE hourglass;

-- 1. doc_category.visibility
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `doc_category`
     ADD COLUMN `visibility` varchar(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
       NOT NULL DEFAULT ''team''
       COMMENT ''分类默认可见范围：team=团队共享 / members=指定成员 / personal=仅自己（仅新建文档时套用）''
       AFTER `name`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'doc_category' AND column_name = 'visibility');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 2. doc_category.member_ids
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `doc_category`
     ADD COLUMN `member_ids` varchar(2000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
       NOT NULL DEFAULT ''''
       COMMENT ''分类默认指定成员账号ID，逗号分隔（仅新建文档时复制）''
       AFTER `visibility`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'doc_category' AND column_name = 'member_ids');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ============================================================================
-- 125_doc_sheet_format.sql · 文档支持「表格」格式（2026-11-25）
--
-- 背景：
--   文档原来只有富文本（html）与 Markdown 两种格式。表格文档的正文是 Univer
--   工作簿快照 JSON，单表上限 20MB（5–10 万单元格），远超 content 列的
--   MEDIUMTEXT（16MB），且 content 上挂着 ngram 全文索引，不适合塞入大 JSON。
--
-- 口径：
--   · requirement_doc / requirement_doc_history 各加一列 sheet_content LONGTEXT；
--   · format='sheet' 时正文只写 sheet_content，content 保持 NULL
--     （列表/搜索仍只看 content_brief，避免全文索引被大 JSON 污染）；
--   · 非 sheet 文档 sheet_content 为 NULL，存量数据不受影响。
--
-- 边界：
--   纯增量、可重复执行；不建索引（表格正文不参与全文检索）。
--   MySQL 需 max_allowed_packet ≥ 64M 才能接收 20MB 的快照保存请求。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/125_doc_sheet_format.sql
-- ============================================================================

USE hourglass;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `requirement_doc` ADD COLUMN `sheet_content` LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT ''表格正文（Univer 工作簿快照 JSON；format=sheet 时使用）'' AFTER `content`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement_doc' AND COLUMN_NAME = 'sheet_content');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `requirement_doc_history` ADD COLUMN `sheet_content` LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT ''快照时的表格正文（与 requirement_doc.sheet_content 同口径）'' AFTER `content`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement_doc_history' AND COLUMN_NAME = 'sheet_content');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 自检：两列都应存在，类型 longtext
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('requirement_doc', 'requirement_doc_history')
  AND COLUMN_NAME = 'sheet_content';

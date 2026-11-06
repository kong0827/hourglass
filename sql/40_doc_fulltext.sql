-- 文档全文检索：使用 ngram 解析器适配中文分词
-- 幂等：先查 information_schema 再决定是否 ALTER，可重复执行。
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement_doc' AND INDEX_NAME = 'ft_doc_fulltext');
SET @s := IF(@x = 0,
  'ALTER TABLE requirement_doc ADD FULLTEXT INDEX ft_doc_fulltext (title, content_brief, content) WITH PARSER ngram',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

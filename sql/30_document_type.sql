-- 文档分类：纯增量、幂等；所有存量文档默认归入其他，不推测旧文档类型。
USE devstudio;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement_doc' AND COLUMN_NAME = 'doc_type');
SET @s := IF(@x = 0,
  'ALTER TABLE requirement_doc ADD COLUMN doc_type VARCHAR(16) NOT NULL DEFAULT ''other'' COMMENT ''文档分类：requirement 需求文档 / technical 技术方案 / acceptance 测试验收 / other 其他'' AFTER title',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

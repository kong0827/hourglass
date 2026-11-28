-- 139 用例集示例包标记
-- 示例用例包是新手引导的合成数据载体：pack=1 的分组允许「整包删除」，
-- 级联删除组内全部用例（普通分组仍只解除引用，不删用例）。
-- 幂等：先查 information_schema，已有该列则跳过。

SET @pack_col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'case_set'
    AND COLUMN_NAME = 'pack'
);

SET @pack_sql := IF(@pack_col = 0,
  'ALTER TABLE case_set ADD COLUMN pack TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''示例包标记：1=示例用例包（可整包级联删除）''',
  'SELECT 1');

PREPARE pack_stmt FROM @pack_sql;
EXECUTE pack_stmt;
DEALLOCATE PREPARE pack_stmt;

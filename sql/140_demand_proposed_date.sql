-- ============================================================================
-- 140 需求业务提出日期
-- 业务侧没有账号、不直接录入，需求池由产品/项目成员代为提交；
-- 「提交时间」(created_at) 只说明录入时刻，无法回答业务何时提出。
-- proposed_date 只记录这件事第一次被业务提出的日期，属于事实留痕字段：
--   * 只到日、可空、不回填存量（旧数据没有可靠记录时保持空，不伪造）；
--   * 不参与甘特阶段、WSJF 与排序，不影响任何派生统计；
--   * 由服务端校验不晚于今天（与人工交付判定生效日期同口径）。
-- 幂等：先查 information_schema，已有该列则跳过。

SET @proposed_col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'demand'
    AND COLUMN_NAME = 'proposed_date'
);

SET @proposed_sql := IF(@proposed_col = 0,
  'ALTER TABLE demand ADD COLUMN proposed_date DATE NULL COMMENT ''业务提出日期（业务第一次提出这件事的日期；空=未记录）'' AFTER source',
  'SELECT 1');

PREPARE proposed_stmt FROM @proposed_sql;
EXECUTE proposed_stmt;
DEALLOCATE PREPARE proposed_stmt;
-- 测试用例：项目内稳定编号（展示为 TC-001）
-- 编号按项目内创建时间顺序分配，创建后不再变化；列表序号只是筛选后的位置，不能用于跨系统引用。
-- 幂等：先探测列再执行；回填只处理空值/0，且从该组当前最大编号之后接着取号，已有编号不动。
USE hourglass;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'test_case' AND COLUMN_NAME = 'case_no');
SET @s := IF(@x = 0,
  'ALTER TABLE test_case ADD COLUMN case_no int NOT NULL DEFAULT 0 COMMENT ''项目内用例编号（顺序分配，展示为 TC-001）'' AFTER demand_id',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 回填：每个 (workspace_id, req_id) 内按 created_at, id 升序取号。
-- 只给未编号（NULL / 0）的行补号，起点接在该组已有最大号之后，避免撞 uk_case_no；
-- 用临时表落序，因为 MySQL 不允许在 UPDATE 的子查询里引用被更新表。
DROP TEMPORARY TABLE IF EXISTS tmp_case_base;
CREATE TEMPORARY TABLE tmp_case_base (
  workspace_id varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  req_id varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  base_no int NOT NULL,
  PRIMARY KEY (workspace_id, req_id)
);
INSERT INTO tmp_case_base (workspace_id, req_id, base_no)
SELECT workspace_id, req_id, COALESCE(MAX(NULLIF(case_no, 0)), 0)
FROM test_case
GROUP BY workspace_id, req_id;

DROP TEMPORARY TABLE IF EXISTS tmp_case_no;
CREATE TEMPORARY TABLE tmp_case_no (
  id varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  seq int NOT NULL
);
INSERT INTO tmp_case_no (id, seq)
SELECT x.id,
       b.base_no + ROW_NUMBER() OVER (PARTITION BY x.workspace_id, x.req_id
                                      ORDER BY x.created_at, x.id) AS seq
FROM test_case x
JOIN tmp_case_base b ON b.workspace_id = x.workspace_id AND b.req_id = x.req_id
WHERE x.case_no IS NULL OR x.case_no = 0;

UPDATE test_case c
JOIN tmp_case_no t ON t.id = c.id
SET c.case_no = t.seq;

DROP TEMPORARY TABLE tmp_case_no;
DROP TEMPORARY TABLE tmp_case_base;

SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'test_case' AND INDEX_NAME = 'uk_case_no');
SET @s := IF(@x = 0,
  'ALTER TABLE test_case ADD UNIQUE KEY uk_case_no (workspace_id, req_id, case_no)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

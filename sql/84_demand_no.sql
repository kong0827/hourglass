-- 需求（需求池条目）：项目内稳定编号（展示为 DM-001）
-- 与 82 号工作项编号同构：项目内按创建顺序取号，创建后不再变化；看板顺序只是筛选后的位置，不能用于跨系统引用。
-- demand.req_id 非空，普通唯一键 (workspace_id, req_id, demand_no) 就能生效，不需要作用域生成列。
-- 编号列可空：未取号的为 NULL，唯一键不约束 NULL，因此脚本可以先于后端上线执行。
-- 幂等：先探测列/索引再执行；回填只处理 NULL/0，且从该组当前最大编号之后接着取号。
USE hourglass;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demand' AND COLUMN_NAME = 'demand_no');
SET @s := IF(@x = 0,
  'ALTER TABLE `demand` ADD COLUMN `demand_no` int DEFAULT NULL COMMENT ''项目内需求编号（顺序分配，展示为 DM-001；空=尚未取号）'' AFTER `req_id`',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 回填：每个 (workspace_id, req_id) 内按 created_at, id 升序取号。
DROP TEMPORARY TABLE IF EXISTS tmp_dem_base;
CREATE TEMPORARY TABLE tmp_dem_base (
  workspace_id varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  req_id varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  base_no int NOT NULL,
  PRIMARY KEY (workspace_id, req_id)
);
INSERT INTO tmp_dem_base (workspace_id, req_id, base_no)
SELECT workspace_id, req_id, COALESCE(MAX(NULLIF(demand_no, 0)), 0)
FROM demand
GROUP BY workspace_id, req_id;

DROP TEMPORARY TABLE IF EXISTS tmp_dem_no;
CREATE TEMPORARY TABLE tmp_dem_no (
  id varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  seq int NOT NULL
);
INSERT INTO tmp_dem_no (id, seq)
SELECT x.id,
       b.base_no + ROW_NUMBER() OVER (PARTITION BY x.workspace_id, x.req_id
                                      ORDER BY x.created_at, x.id) AS seq
FROM demand x
JOIN tmp_dem_base b ON b.workspace_id = x.workspace_id AND b.req_id = x.req_id
WHERE x.demand_no IS NULL OR x.demand_no = 0;

UPDATE demand d
JOIN tmp_dem_no n ON n.id = d.id
SET d.demand_no = n.seq;

DROP TEMPORARY TABLE tmp_dem_no;
DROP TEMPORARY TABLE tmp_dem_base;

SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demand' AND INDEX_NAME = 'uk_demand_no');
SET @s := IF(@x = 0,
  'ALTER TABLE `demand` ADD UNIQUE KEY `uk_demand_no` (`workspace_id`,`req_id`,`demand_no`)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

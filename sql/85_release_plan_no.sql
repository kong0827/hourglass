-- 发布计划：空间内稳定编号（展示为 PL-001）
-- 计划可以跨版本、跨项目（version_release_plan_version 才是权威范围，version_id 只是展示主版本），
-- 因此既不能按项目取号，也不能按版本取号 —— 空间是唯一稳定的作用域。
-- 编号列可空：未取号的为 NULL，唯一键不约束 NULL，脚本可以先于后端上线执行。
-- 幂等：先探测列/索引再执行；回填只处理 NULL/0，且从当前最大编号之后接着取号。
USE hourglass;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'version_release_plan' AND COLUMN_NAME = 'plan_no');
SET @s := IF(@x = 0,
  'ALTER TABLE `version_release_plan` ADD COLUMN `plan_no` int DEFAULT NULL COMMENT ''空间内发布计划编号（顺序分配，展示为 PL-001；空=尚未取号）'' AFTER `version_id`',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 回填：每个空间内按 created_at, id 升序取号，编号顺序与创建顺序一致。
DROP TEMPORARY TABLE IF EXISTS tmp_plan_base;
CREATE TEMPORARY TABLE tmp_plan_base (
  workspace_id varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  base_no int NOT NULL
);
INSERT INTO tmp_plan_base (workspace_id, base_no)
SELECT workspace_id, COALESCE(MAX(NULLIF(plan_no, 0)), 0)
FROM version_release_plan
GROUP BY workspace_id;

DROP TEMPORARY TABLE IF EXISTS tmp_plan_no;
CREATE TEMPORARY TABLE tmp_plan_no (
  id varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  seq int NOT NULL
);
INSERT INTO tmp_plan_no (id, seq)
SELECT x.id,
       b.base_no + ROW_NUMBER() OVER (PARTITION BY x.workspace_id ORDER BY x.created_at, x.id) AS seq
FROM version_release_plan x
JOIN tmp_plan_base b ON b.workspace_id = x.workspace_id
WHERE x.plan_no IS NULL OR x.plan_no = 0;

UPDATE version_release_plan p
JOIN tmp_plan_no n ON n.id = p.id
SET p.plan_no = n.seq;

DROP TEMPORARY TABLE tmp_plan_no;
DROP TEMPORARY TABLE tmp_plan_base;

SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'version_release_plan' AND INDEX_NAME = 'uk_plan_no');
SET @s := IF(@x = 0,
  'ALTER TABLE `version_release_plan` ADD UNIQUE KEY `uk_plan_no` (`workspace_id`,`plan_no`)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

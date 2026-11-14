-- 工作项 / 发布记录：项目内稳定编号（展示为 WI-001 / REL-001）
-- 与 74 号用例编号同构：项目内按创建顺序取号，创建后不再变化；列表序号只是筛选后的位置，不能用于跨系统引用。
-- 编号列可空：未取号的行为 NULL，唯一键不约束 NULL，因此本脚本可以先于后端上线执行，
-- 不会让仍在写 0 的旧代码撞唯一键（74 号用 NOT NULL DEFAULT 0，多行 0 会互撞）。
-- 幂等：先探测列/索引再执行；回填只处理 NULL/0，且从该组当前最大编号之后接着取号，已有编号不动。
USE hourglass;

-- ---------- 1. task.item_no ----------
SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'item_no');
SET @s := IF(@x = 0,
  'ALTER TABLE `task` ADD COLUMN `item_no` int DEFAULT NULL COMMENT ''项目内工作项编号（顺序分配，展示为 WI-001；空=尚未取号）'' AFTER `item_type`',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- req_id 可空（无项目的工作项），而 MySQL 唯一键不约束 NULL：
-- 直接对 (workspace_id, req_id, item_no) 建唯一键，无项目的工作项会各自取到 1 号且互不冲突。
-- 用生成列把「无项目」归到空串，唯一键才真正生效；同表 gantt_start / gantt_end 已是同样的写法。
SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'no_scope');
SET @s := IF(@x = 0,
  'ALTER TABLE `task` ADD COLUMN `no_scope` varchar(32) GENERATED ALWAYS AS (coalesce(`req_id`,'''')) STORED COMMENT ''编号作用域：项目ID，无项目归空串（唯一键用，不参与写入）''',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 回填：每个 (workspace_id, no_scope) 内按 created_at, id 升序取号。
-- 软删除（deleted_at）的行一并参与取号与占号：回收站里的编号不能发给新工作项。
-- 用临时表落序，因为 MySQL 不允许在 UPDATE 的子查询里引用被更新表。
DROP TEMPORARY TABLE IF EXISTS tmp_task_base;
CREATE TEMPORARY TABLE tmp_task_base (
  workspace_id varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  no_scope varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  base_no int NOT NULL,
  PRIMARY KEY (workspace_id, no_scope)
);
INSERT INTO tmp_task_base (workspace_id, no_scope, base_no)
SELECT workspace_id, no_scope, COALESCE(MAX(NULLIF(item_no, 0)), 0)
FROM task
GROUP BY workspace_id, no_scope;

DROP TEMPORARY TABLE IF EXISTS tmp_task_no;
CREATE TEMPORARY TABLE tmp_task_no (
  id varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  seq int NOT NULL
);
INSERT INTO tmp_task_no (id, seq)
SELECT x.id,
       b.base_no + ROW_NUMBER() OVER (PARTITION BY x.workspace_id, x.no_scope
                                      ORDER BY x.created_at, x.id) AS seq
FROM task x
JOIN tmp_task_base b ON b.workspace_id = x.workspace_id AND b.no_scope = x.no_scope
WHERE x.item_no IS NULL OR x.item_no = 0;

UPDATE task t
JOIN tmp_task_no n ON n.id = t.id
SET t.item_no = n.seq;

DROP TEMPORARY TABLE tmp_task_no;
DROP TEMPORARY TABLE tmp_task_base;

SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND INDEX_NAME = 'uk_task_item_no');
SET @s := IF(@x = 0,
  'ALTER TABLE `task` ADD UNIQUE KEY `uk_task_item_no` (`workspace_id`,`no_scope`,`item_no`)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------- 2. version_release.release_no ----------
-- req_id 在发布记录上非空，不需要作用域生成列。
SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'version_release' AND COLUMN_NAME = 'release_no');
SET @s := IF(@x = 0,
  'ALTER TABLE `version_release` ADD COLUMN `release_no` int DEFAULT NULL COMMENT ''项目内发布记录编号（顺序分配，展示为 REL-001；空=尚未取号）'' AFTER `req_id`',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 回填：按实际发生时间排序（同一时刻按记录时间、ID 兜底），编号顺序与发布历史的时间顺序一致。
DROP TEMPORARY TABLE IF EXISTS tmp_rel_base;
CREATE TEMPORARY TABLE tmp_rel_base (
  workspace_id varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  req_id varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  base_no int NOT NULL,
  PRIMARY KEY (workspace_id, req_id)
);
INSERT INTO tmp_rel_base (workspace_id, req_id, base_no)
SELECT workspace_id, req_id, COALESCE(MAX(NULLIF(release_no, 0)), 0)
FROM version_release
GROUP BY workspace_id, req_id;

DROP TEMPORARY TABLE IF EXISTS tmp_rel_no;
CREATE TEMPORARY TABLE tmp_rel_no (
  id varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  seq int NOT NULL
);
INSERT INTO tmp_rel_no (id, seq)
SELECT x.id,
       b.base_no + ROW_NUMBER() OVER (PARTITION BY x.workspace_id, x.req_id
                                      ORDER BY x.occurred_at, x.recorded_at, x.id) AS seq
FROM version_release x
JOIN tmp_rel_base b ON b.workspace_id = x.workspace_id AND b.req_id = x.req_id
WHERE x.release_no IS NULL OR x.release_no = 0;

UPDATE version_release r
JOIN tmp_rel_no n ON n.id = r.id
SET r.release_no = n.seq;

DROP TEMPORARY TABLE tmp_rel_no;
DROP TEMPORARY TABLE tmp_rel_base;

SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'version_release' AND INDEX_NAME = 'uk_release_no');
SET @s := IF(@x = 0,
  'ALTER TABLE `version_release` ADD UNIQUE KEY `uk_release_no` (`workspace_id`,`req_id`,`release_no`)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
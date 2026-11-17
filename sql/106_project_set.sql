-- =====================================================================
-- 106_project_set.sql · 项目集 + 项目拆分（单文件增量，结构 + 数据一次执行）
-- 用法（已有库升级，先全库备份）：
--   mysql -uroot -p --default-character-set=utf8mb4 hourglass < sql/106_project_set.sql
-- 全新安装无需执行本文件：结构已收敛进 sql/baseline/01_schema_full.sql。
-- 执行时机：全库备份后、维护窗口内先执行本文件，再切新 jar；
--           旧 jar 也能读新结构（新增列可空、新表不被旧代码访问）。
--
-- 口径（2026-11-17 已确认）：
--   1. 新建项目集「流程引擎」，原项目改名为「流程引擎-公共」并标记为容器。
--   2. 7 个一级分类升为项目：外接、主机托管、程序化报备、流程引擎基础功能、
--      合规管理、提高出金比例、中金所套保额度申请（0 工作项，按决策仍升级）。
--   3. 升格后原 category 记录保留，ID 不变，只把 project_id 指向新项目，
--      作为新项目的根分类。
--   4. 工作项、需求、用例、用例集、完成归档按分类迁到新项目；软删除工作项一起迁。
--   5. 版本、发布、文档、文档目录、未引用分支留在容器；已发布历史由
--      version_release_item 快照保留。
--   6. 迁出工作项的 version_task 实时关系清理（保存时强校验版本同项目）；
--      迁出需求的 version_id 清空，版本名写入新增的 demand.version_name 快照。
--   7. 工作项与需求、用例与任务的跨分类关联不强行拆开，保留为只读跨项目关系。
--   8. 分支：被迁出任务引用的 21 条改归「外接」；未被引用的 9 条留容器。
--   9. 编号：历史 item_no / demand_no / case_no 不重排；为新项目补需求序列，
--      用例序列随用例迁到「流程引擎基础功能」。
--
-- 幂等：结构变更按 information_schema 判重；数据迁移以 project_split_map
--       是否存在 Xkp02 的拆分行判断，重复执行全部跳过（输出 run_migration=0）。
-- 闸门：7 个固定一级分类 ID 齐全且无第 8 个一级分类、尚未拆分、新项目 ID 未占用
--       才执行；任务 / 需求 / 用例条数允许在决策后增长，不参与判断，避免静默跳过。
-- 事务：DDL 在事务外（MySQL 隐式提交），数据变更统一在一个事务内，失败整体回滚。
-- 回退：仅回退应用不能恢复数据，必须用执行前的全库备份恢复。
-- =====================================================================

-- 连接排序规则与表一致，避免 UNION 中字面量与列排序规则冲突
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 0. 前置检查（只读）：核对 7 个一级分类与各表条数；条数仅供核对，不参与迁移闸门
-- ---------------------------------------------------------------------
SELECT 'categories' AS item, COUNT(*) AS cnt FROM category WHERE project_id = 'Xkp02' AND parent_id = ''
UNION ALL SELECT 'tasks', COUNT(*) FROM task WHERE req_id = 'Xkp02'
UNION ALL SELECT 'tasks_live', COUNT(*) FROM task WHERE req_id = 'Xkp02' AND deleted_at IS NULL
UNION ALL SELECT 'demands', COUNT(*) FROM demand WHERE req_id = 'Xkp02'
UNION ALL SELECT 'cases', COUNT(*) FROM test_case WHERE req_id = 'Xkp02'
UNION ALL SELECT 'versions', COUNT(*) FROM project_version WHERE req_id = 'Xkp02'
UNION ALL SELECT 'releases', COUNT(*) FROM version_release WHERE req_id = 'Xkp02';

-- ---------------------------------------------------------------------
-- 1. 结构变更（可重复执行）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `project_set` (
  `id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '项目集ID',
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `name` varchar(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '项目集名称',
  `description` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '说明',
  `owner_user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '负责人账号ID',
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT '状态：active/done/hold',
  `planned_start` date DEFAULT NULL COMMENT '计划开始日',
  `planned_end` date DEFAULT NULL COMMENT '计划结束日',
  `archived_at` datetime DEFAULT NULL COMMENT '归档时间（NULL=未归档）',
  `color` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '#8a8578' COMMENT '标识色',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '空间内排序',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ws_set_name` (`workspace_id`,`name`),
  KEY `idx_ws_sort` (`workspace_id`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目集';

CREATE TABLE IF NOT EXISTS `project_split_map` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `old_project_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '拆分前项目ID',
  `old_category_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '拆分来源分类ID',
  `new_project_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '新项目ID',
  `new_category_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '新项目根分类ID（沿用原分类ID）',
  `action` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'split / container',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_old_category` (`workspace_id`,`old_project_id`,`old_category_id`,`action`),
  KEY `idx_new_project` (`new_project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目拆分映射（幂等、旧链接跳转、回滚核对）';

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `requirement`
     ADD COLUMN `set_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''所属项目集（project_set.id），空=未分组'' AFTER `workspace_id`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'requirement' AND column_name = 'set_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `requirement`
     ADD COLUMN `origin_category_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''由哪个一级分类升格而来'' AFTER `set_id`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'requirement' AND column_name = 'origin_category_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `requirement`
     ADD COLUMN `container_kind` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''容器项目标记：split_container=拆分后的公共容器'' AFTER `origin_category_id`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'requirement' AND column_name = 'container_kind');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `demand`
     ADD COLUMN `version_name` varchar(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''历史目标版本名快照（版本留容器后清 version_id 时保留）'' AFTER `version_id`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'demand' AND column_name = 'version_name');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `requirement` ADD KEY `idx_ws_set` (`workspace_id`,`set_id`)',
  'DO 0') FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'requirement' AND index_name = 'idx_ws_set');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------
-- 2. 迁移闸门：只在原始数据形态且尚未拆分时执行
-- ---------------------------------------------------------------------
SET @ws := (SELECT workspace_id FROM requirement WHERE id = 'Xkp02');
SET @set := 'PSXkp02';

-- 闸门只看结构身份，不绑定决策时的任务 / 需求 / 用例条数：
-- 这三个数在 11-17 决策到上线之间可能因正常使用增长，按条数相等判断会让迁移静默跳过。
-- 7 个固定一级分类 ID 齐全且没有第 8 个一级分类、尚未拆分、新项目 ID 未被占用，即可安全执行。
SET @do := (
  SELECT CASE WHEN
    @ws IS NOT NULL
    AND (SELECT COUNT(*) FROM category WHERE project_id = 'Xkp02' AND parent_id = '') = 7
    AND (SELECT COUNT(*) FROM category
          WHERE project_id = 'Xkp02' AND parent_id = ''
            AND id IN ('Xkc002','Xkc003','Xkc004','Xkc005','Xkc007','Gmwea8xzx0sezqyfl','Gmwiy8f7vv5jx978b')) = 7
    AND NOT EXISTS (SELECT 1 FROM project_split_map WHERE old_project_id = 'Xkp02')
    AND NOT EXISTS (SELECT 1 FROM requirement WHERE id IN ('Xkp02S1','Xkp02S2','Xkp02S3','Xkp02S4','Xkp02S5','Xkp02S6','Xkp02S7'))
  THEN 1 ELSE 0 END
);

SELECT @ws AS workspace_id, @do AS run_migration;

START TRANSACTION;

-- ---------------------------------------------------------------------
-- 3. 项目集
-- ---------------------------------------------------------------------
INSERT INTO project_set (id, workspace_id, name, description, owner_user_id, status, planned_start, planned_end, sort_order)
SELECT @set, r.workspace_id, '流程引擎', r.description, r.owner_user_id, r.status, r.planned_start, r.planned_end, 0
FROM requirement r
WHERE r.id = 'Xkp02' AND @do = 1;

-- ---------------------------------------------------------------------
-- 4. 分类到新项目的映射（ID 固定，便于幂等与旧链接跳转）
-- ---------------------------------------------------------------------
INSERT INTO project_split_map (workspace_id, old_project_id, old_category_id, new_project_id, new_category_id, action)
SELECT @ws, 'Xkp02', 'Xkc002', 'Xkp02S1', 'Xkc002', 'split' WHERE @do = 1
UNION ALL SELECT @ws, 'Xkp02', 'Xkc003', 'Xkp02S2', 'Xkc003', 'split' WHERE @do = 1
UNION ALL SELECT @ws, 'Xkp02', 'Xkc004', 'Xkp02S3', 'Xkc004', 'split' WHERE @do = 1
UNION ALL SELECT @ws, 'Xkp02', 'Xkc005', 'Xkp02S4', 'Xkc005', 'split' WHERE @do = 1
UNION ALL SELECT @ws, 'Xkp02', 'Xkc007', 'Xkp02S5', 'Xkc007', 'split' WHERE @do = 1
UNION ALL SELECT @ws, 'Xkp02', 'Gmwea8xzx0sezqyfl', 'Xkp02S6', 'Gmwea8xzx0sezqyfl', 'split' WHERE @do = 1
UNION ALL SELECT @ws, 'Xkp02', 'Gmwiy8f7vv5jx978b', 'Xkp02S7', 'Gmwiy8f7vv5jx978b', 'split' WHERE @do = 1;

-- ---------------------------------------------------------------------
-- 5. 子项目：负责人、状态、计划日期、首版上线日从原项目继承
-- ---------------------------------------------------------------------
INSERT INTO requirement
  (id, workspace_id, name, description, status, release_check_policy, owner_user_id,
   planned_start, planned_end, first_released_at, sort_order, set_id, origin_category_id)
SELECT m.new_project_id, r.workspace_id, c.name,
       CONCAT('由「', r.name, '」项目的「', c.name, '」分类拆分'),
       r.status, r.release_check_policy, r.owner_user_id,
       r.planned_start, r.planned_end, r.first_released_at,
       100 + c.sort_order, @set, c.id
FROM project_split_map m
JOIN category c ON c.id = m.old_category_id
JOIN requirement r ON r.id = 'Xkp02'
WHERE m.old_project_id = 'Xkp02' AND @do = 1;

-- 容器项目：改名、挂到项目集、标记容器、排在集内最后
UPDATE requirement
SET name = '流程引擎-公共', set_id = @set, container_kind = 'split_container', sort_order = 199
WHERE id = 'Xkp02' AND @do = 1;

-- ---------------------------------------------------------------------
-- 6. 分类：ID 不变，改挂到各自新项目，作为新项目根分类
-- ---------------------------------------------------------------------
UPDATE category c
JOIN project_split_map m ON m.old_category_id = c.id
SET c.project_id = m.new_project_id
WHERE c.project_id = 'Xkp02' AND m.old_project_id = 'Xkp02' AND @do = 1;

-- ---------------------------------------------------------------------
-- 7. 分支：被迁出任务引用的改归「外接」，其余留容器
--    （必须在工作项迁走之前判断引用）
-- ---------------------------------------------------------------------
UPDATE dev_branch b
JOIN project_split_map m ON m.old_category_id = 'Xkc002'
SET b.req_id = m.new_project_id
WHERE b.req_id = 'Xkp02' AND @do = 1
  AND EXISTS (SELECT 1 FROM task t WHERE t.branch_id = b.id AND t.req_id = 'Xkp02');

-- ---------------------------------------------------------------------
-- 8. 工作项：req_id 改到新项目，no_scope 为生成列自动跟随
-- ---------------------------------------------------------------------
UPDATE task t
JOIN category c ON c.id = t.category_id
JOIN project_split_map m ON m.old_category_id = c.id
SET t.req_id = m.new_project_id
WHERE t.req_id = 'Xkp02' AND @do = 1;

-- ---------------------------------------------------------------------
-- 9. 需求：先快照版本名，再改项目，最后清掉容器版本的实时引用
-- ---------------------------------------------------------------------
UPDATE demand d
JOIN project_split_map m ON m.old_category_id = d.category_id
JOIN project_version pv ON pv.id = d.version_id
SET d.version_name = pv.name
WHERE d.req_id = 'Xkp02' AND d.version_id IS NOT NULL AND d.version_id <> '' AND @do = 1;

UPDATE demand d
JOIN project_split_map m ON m.old_category_id = d.category_id
SET d.req_id = m.new_project_id
WHERE d.req_id = 'Xkp02' AND @do = 1;

UPDATE demand d
JOIN project_split_map m ON m.old_category_id = d.category_id
SET d.version_id = NULL
WHERE d.req_id = m.new_project_id AND d.version_id IS NOT NULL AND @do = 1;

-- ---------------------------------------------------------------------
-- 10. 用例：8 条无分类的「节点去重」用例先归入基础功能，再整体迁移
-- ---------------------------------------------------------------------
UPDATE test_case
SET module_id = 'Xkc005', module = '流程引擎基础功能'
WHERE req_id = 'Xkp02' AND (module_id IS NULL OR module_id = '') AND @do = 1;

UPDATE test_case tc
JOIN project_split_map m ON m.old_category_id = tc.module_id
SET tc.req_id = m.new_project_id
WHERE tc.req_id = 'Xkp02' AND @do = 1;

-- 用例集：用例全部属于基础功能的集合整体迁到“流程引擎基础功能”
UPDATE case_set cs
JOIN project_split_map m ON m.old_category_id = 'Xkc005'
SET cs.req_id = m.new_project_id
WHERE cs.req_id = 'Xkp02' AND @do = 1
  AND NOT EXISTS (
    SELECT 1 FROM case_set_item i
    JOIN test_case tc ON tc.id = i.case_id
    WHERE i.set_id = cs.id AND IFNULL(tc.module_id, '') <> 'Xkc005'
  );

-- ---------------------------------------------------------------------
-- 11. 完成归档：项目归属与名称快照跟随工作项
-- ---------------------------------------------------------------------
UPDATE task_completion_record r
JOIN task t ON t.id = r.task_id
JOIN category c ON c.id = t.category_id
JOIN project_split_map m ON m.old_category_id = c.id
SET r.req_id = m.new_project_id,
    r.req_name = c.name,
    r.category = c.name
WHERE r.req_id = 'Xkp02' AND @do = 1;

-- ---------------------------------------------------------------------
-- 12. 版本关系：迁出工作项不再保留容器版本的实时关系（历史在发布快照）
-- ---------------------------------------------------------------------
DELETE vt
FROM version_task vt
JOIN task t ON t.id = vt.task_id
JOIN project_version pv ON pv.id = vt.version_id
WHERE pv.req_id = 'Xkp02' AND t.req_id <> 'Xkp02' AND t.workspace_id = @ws AND @do = 1;

-- ---------------------------------------------------------------------
-- 13. 编号序列：新项目需求序列取项目内最大编号；用例序列随用例迁走
-- ---------------------------------------------------------------------
INSERT INTO number_seq (workspace_id, kind, scope_id, next_no)
SELECT @ws, 'demand', m.new_project_id, COALESCE(MAX(d.demand_no), 0)
FROM project_split_map m
LEFT JOIN demand d ON d.req_id = m.new_project_id AND d.workspace_id = @ws
WHERE m.old_project_id = 'Xkp02' AND @do = 1
GROUP BY m.new_project_id;

UPDATE number_seq
SET scope_id = 'Xkp02S4'
WHERE workspace_id = @ws AND kind = 'case' AND scope_id = 'Xkp02' AND @do = 1;

UPDATE number_seq
SET next_no = GREATEST(next_no, (SELECT COALESCE(MAX(tc.case_no), 0) FROM test_case tc WHERE tc.req_id = 'Xkp02S4'))
WHERE workspace_id = @ws AND kind = 'case' AND scope_id = 'Xkp02S4' AND @do = 1;

-- ---------------------------------------------------------------------
-- 14. 留痕：容器项目一条活动 + 一条审计
-- ---------------------------------------------------------------------
INSERT INTO work_activity (workspace_id, entity_type, entity_id, actor_id, actor_name, action, detail)
SELECT @ws, 'project', 'Xkp02', NULL, '迁移脚本', 'update',
       '按模块拆分为 7 个项目：外接、主机托管、程序化报备、流程引擎基础功能、合规管理、提高出金比例、中金所套保额度申请；版本、发布、文档、未引用分支留在本项目'
WHERE @do = 1;

INSERT INTO audit_log (workspace_id, actor_id, actor_name, action, target_type, target_id, target_name, result, detail)
SELECT @ws, NULL, '迁移脚本', 'import', 'project', 'Xkp02', '流程引擎 → 流程引擎-公共', 'success',
       '项目集拆分：新建项目集「流程引擎」，7 个一级分类升为项目，原项目改为容器'
WHERE @do = 1;

COMMIT;

-- ---------------------------------------------------------------------
-- 15. 迁移后校验（只读）
-- ---------------------------------------------------------------------
SELECT 'set' AS item, id, name FROM project_set WHERE id = @set
UNION ALL SELECT 'container', id, CONCAT(name, ' / ', IFNULL(container_kind, '')) FROM requirement WHERE id = 'Xkp02';

SELECT r.id, r.name, r.set_id, r.container_kind,
       (SELECT COUNT(*) FROM task t WHERE t.req_id = r.id) AS tasks,
       (SELECT COUNT(*) FROM task t WHERE t.req_id = r.id AND t.deleted_at IS NULL) AS tasks_live,
       (SELECT COUNT(*) FROM demand d WHERE d.req_id = r.id) AS demands,
       (SELECT COUNT(*) FROM test_case tc WHERE tc.req_id = r.id) AS cases,
       (SELECT COUNT(*) FROM project_version pv WHERE pv.req_id = r.id) AS versions,
       (SELECT COUNT(*) FROM version_release vr WHERE vr.req_id = r.id) AS releases,
       (SELECT COUNT(*) FROM dev_branch b WHERE b.req_id = r.id) AS branches,
       (SELECT COUNT(*) FROM task_completion_record cr WHERE cr.req_id = r.id) AS completions
FROM requirement r
WHERE r.id = 'Xkp02' OR r.set_id = @set
ORDER BY r.sort_order, r.id;

SELECT 'unassigned_tasks' AS item, COUNT(*) AS cnt FROM task WHERE req_id = 'Xkp02'
UNION ALL SELECT 'version_task_left', COUNT(*) FROM version_task vt JOIN task t ON t.id = vt.task_id WHERE t.req_id = 'Xkp02'
UNION ALL SELECT 'demand_version_left', COUNT(*) FROM demand d WHERE d.req_id IN (SELECT new_project_id FROM project_split_map WHERE old_project_id = 'Xkp02') AND d.version_id IS NOT NULL
UNION ALL SELECT 'demand_version_snapshot', COUNT(*) FROM demand d WHERE d.req_id IN (SELECT new_project_id FROM project_split_map WHERE old_project_id = 'Xkp02') AND d.version_name IS NOT NULL
UNION ALL SELECT 'task_demand_cross', COUNT(*) FROM task t JOIN demand d ON d.id = t.demand_id WHERE t.req_id <> d.req_id
UNION ALL SELECT 'case_task_cross', COUNT(*) FROM test_case_task ct JOIN test_case tc ON tc.id = ct.case_id JOIN task t ON t.id = ct.task_id WHERE tc.req_id <> t.req_id
UNION ALL SELECT 'branch_container', COUNT(*) FROM dev_branch WHERE req_id = 'Xkp02';

SELECT kind, scope_id, next_no FROM number_seq WHERE workspace_id = @ws AND scope_id IN ('Xkp02','Xkp02S1','Xkp02S2','Xkp02S3','Xkp02S4','Xkp02S5','Xkp02S6','Xkp02S7') ORDER BY kind, scope_id;

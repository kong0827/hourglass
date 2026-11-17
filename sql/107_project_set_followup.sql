-- =====================================================================
-- 107_project_set_followup.sql · 项目集拆分后的数据修正（纯数据，无结构变更）
-- 用法（已有库升级，先全库备份）：
--   mysql -uroot -p --default-character-set=utf8mb4 hourglass < sql/107_project_set_followup.sql
-- 全新安装无需执行本文件（数据由使用过程产生）。
--
-- 解决两个问题：
--   1. 106 拆分把容器「流程引擎-公共」的首版上线日 2026-06-15 复制给了 7 个子项目。
--      子项目自己没有任何成功生产发布，但所有已完成工作项都晚于 6-15，
--      导致版本页「首版开发」恒为 0、全部成果挤进「迭代维护」。
--      口径：继承来的日期没有事实依据，清空；等子项目自己首次生产发布后再由
--      「标记首版上线」写入。容器 Xkp02 继续保留 6-15（它确有 18 条成功生产发布）。
--   2. 未归组项目散落在项目列表里，一级层级不完整。
--      为每个仍有未分组项目的空间补一个默认项目集「其他项目」，把未分组项目挂进去。
--      项目集只做归组与只读汇总、不参与权限；按项目可见性派生可见性，无需额外授权行。
--
-- 幂等：清空语句带 NOT EXISTS 事实校验；默认集按 (workspace_id, name) 判重；
--       挂载只处理 set_id IS NULL 的行。重复执行无副作用。
-- 事务：全部数据变更在一个事务内，失败整体回滚。
-- =====================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 0. 前置检查（只读）
-- ---------------------------------------------------------------------
SELECT 'split_projects_with_inherited_date' AS item, COUNT(*) AS cnt
FROM requirement r
JOIN project_split_map m ON m.new_project_id = r.id AND m.action = 'split'
WHERE r.first_released_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM version_release vr
    WHERE vr.workspace_id = r.workspace_id AND vr.req_id = r.id
      AND vr.result = 'success' AND vr.environment = 'production'
  )
UNION ALL
SELECT 'ungrouped_projects', COUNT(*) FROM requirement WHERE set_id IS NULL;

START TRANSACTION;

-- ---------------------------------------------------------------------
-- 1. 清掉拆分子项目继承来的首版上线日（只清没有自己成功生产发布的）
-- ---------------------------------------------------------------------
UPDATE requirement r
JOIN project_split_map m ON m.new_project_id = r.id AND m.action = 'split'
SET r.first_released_at = NULL,
    r.updated_at = NOW()
WHERE r.first_released_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM version_release vr
    WHERE vr.workspace_id = r.workspace_id AND vr.req_id = r.id
      AND vr.result = 'success' AND vr.environment = 'production'
  );

-- ---------------------------------------------------------------------
-- 2. 默认项目集「其他项目」：每个有未分组项目的空间补一个
--    临时表先算好 ID 与排序位，避免 INSERT ... SELECT 读目标表
-- ---------------------------------------------------------------------
DROP TEMPORARY TABLE IF EXISTS tmp_default_project_set;

CREATE TEMPORARY TABLE tmp_default_project_set AS
SELECT src.workspace_id,
       CONCAT('PS', SUBSTRING(MD5(CONCAT(src.workspace_id, '|其他项目')), 1, 20)) AS id,
       COALESCE((SELECT MAX(ps.sort_order) + 1 FROM project_set ps
                 WHERE ps.workspace_id = src.workspace_id), 0) AS sort_order
FROM (SELECT DISTINCT workspace_id FROM requirement WHERE set_id IS NULL) src
LEFT JOIN project_set existing
       ON existing.workspace_id = src.workspace_id AND existing.name = '其他项目'
WHERE existing.id IS NULL;

INSERT INTO project_set
  (id, workspace_id, name, description, owner_user_id, status, color, sort_order)
SELECT id, workspace_id, '其他项目', '未归入项目集的项目默认归入此分组', NULL, 'active', '#8a8578', sort_order
FROM tmp_default_project_set;

DROP TEMPORARY TABLE tmp_default_project_set;

-- ---------------------------------------------------------------------
-- 3. 未分组项目挂进「其他项目」（含已归档项目，仍出现在项目列表里）
-- ---------------------------------------------------------------------
UPDATE requirement r
JOIN project_set s
  ON s.workspace_id = r.workspace_id AND s.name = '其他项目'
SET r.set_id = s.id,
    r.updated_at = NOW()
WHERE r.set_id IS NULL;

COMMIT;

-- ---------------------------------------------------------------------
-- 4. 迁移后校验（只读）
-- ---------------------------------------------------------------------
SELECT r.workspace_id, r.id, r.name, r.first_released_at, r.set_id
FROM requirement r
JOIN project_split_map m ON m.new_project_id = r.id AND m.action = 'split'
ORDER BY r.id;

SELECT s.workspace_id, s.id, s.name, s.sort_order,
       (SELECT COUNT(*) FROM requirement r WHERE r.set_id = s.id) AS projects
FROM project_set s
ORDER BY s.workspace_id, s.sort_order, s.id;

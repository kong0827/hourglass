-- ============================================================================
-- 100_case_category_tree.sql · 用例改用项目目录树 + 嵌套分组 + 手动排序（2026-11-15）
--
-- 背景：
--   93 给用例单独建了 test_module 目录树，而任务 / 需求用的是项目级 category 平铺字典。
--   同一个项目里出现两套「模块」，建了目录任务侧看不到，任务侧建的模块用例侧又没有。
--   本次把两者合并成一个项目目录树：
--     1) category 增 parent_id（空串=顶级），名称上限放宽到 50，唯一键改为同级同名；
--        test_module 的节点按原 id 迁入 category，用例 module_id 与动态分组的
--        rule_json.moduleId 不需要换 id；顶层同名节点合并到已有 category，只改写引用。
--     2) case_set 增 parent_id，分组可嵌套；可见范围由子组继承父组，唯一键改为同级同名；
--        增 sort_order，同级分组可手动排序。
--     3) test_case 增 sort_order，支持目录内 / 筛选结果内手动排序。
--
-- 边界：
--   - 只增结构与迁移目录节点，不改用例编号、执行历史、缺陷回链与已冻结快照。
--   - test_module 表保留不删，作为回滚依据；服务层不再读写它。
--   - 合并只发生在「同一项目、同一父级、同一名称」；顶层同名合并后，
--     用例指向保留的 category 节点，动态分组规则里的 moduleId 同步替换。
--   - sort_order 历史回填按原创建顺序编号；已存在非 0 值时跳过，避免覆盖手工顺序。
--
-- 幂等：列 / 索引按 information_schema 判断后执行；目录迁移按 id 防重，
--       可重复执行且不会重复搬运用例引用。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/100_case_category_tree.sql
-- ============================================================================

USE hourglass;

-- ---------------------------------------------------------------------------
-- 1) category：变成项目目录树
-- ---------------------------------------------------------------------------
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `category`
     ADD COLUMN `parent_id` varchar(32) NOT NULL DEFAULT '''' COMMENT ''父目录ID（category.id），空串=顶级'' AFTER `project_id`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'category' AND column_name = 'parent_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 目录名与 test_module 对齐（原来限 12 字是为了平铺字典的展示）
ALTER TABLE `category`
  MODIFY COLUMN `name` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '目录名（同级不重名）';

-- 平铺唯一键换成分级唯一键
SET @s := (SELECT IF(COUNT(*) > 0,
  'ALTER TABLE `category` DROP KEY `uk_ws_proj_name`', 'DO 0')
  FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'category' AND index_name = 'uk_ws_proj_name');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `category`
     ADD UNIQUE KEY `uk_ws_proj_parent_name` (`workspace_id`,`project_id`,`parent_id`,`name`)',
  'DO 0') FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'category' AND index_name = 'uk_ws_proj_parent_name');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `category` ADD KEY `idx_ws_proj_parent` (`workspace_id`,`project_id`,`parent_id`)',
  'DO 0') FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'category' AND index_name = 'idx_ws_proj_parent');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 2) case_set：分组可嵌套（父级来自同一可见范围，子组继承父组可见范围）
-- ---------------------------------------------------------------------------
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `case_set`
     ADD COLUMN `parent_id` varchar(32) NOT NULL DEFAULT '''' COMMENT ''父分组ID（case_set.id），空串=顶级；子组继承父组可见范围'' AFTER `req_id`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'case_set' AND column_name = 'parent_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) > 0,
  'ALTER TABLE `case_set` DROP KEY `uk_set_name`', 'DO 0')
  FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'case_set' AND index_name = 'uk_set_name');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `case_set`
     ADD UNIQUE KEY `uk_set_parent_name` (`workspace_id`,`req_id`,`visibility`,`owner_user_id`,`parent_id`,`name`)',
  'DO 0') FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'case_set' AND index_name = 'uk_set_parent_name');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `case_set` ADD KEY `idx_ws_req_parent` (`workspace_id`,`req_id`,`parent_id`)',
  'DO 0') FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'case_set' AND index_name = 'idx_ws_req_parent');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `case_set`
     ADD COLUMN `sort_order` int NOT NULL DEFAULT 0 COMMENT ''同级手动排序序号（小在前）'' AFTER `parent_id`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'case_set' AND column_name = 'sort_order');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 历史分组按创建顺序编号，保持升级前看到的顺序；已有非 0 序号时跳过
SET @s := IF((SELECT COUNT(*) FROM `case_set` WHERE `sort_order` <> 0) = 0,
  'UPDATE `case_set` s
     JOIN (SELECT id, ROW_NUMBER() OVER (PARTITION BY workspace_id, req_id, visibility, owner_user_id, parent_id
                                         ORDER BY created_at, id) - 1 AS rn
             FROM `case_set`) t ON t.id = s.id
        SET s.sort_order = t.rn',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 3) test_case：手动排序（项目内递增整数，不要求唯一）
--    列表默认排序仍可按创建时间等；选择「手动排序」时按 sort_order，再按 id 兜底。
-- ---------------------------------------------------------------------------
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `test_case`
     ADD COLUMN `sort_order` int NOT NULL DEFAULT 0 COMMENT ''手动排序序号（项目内递增，小在前）'' AFTER `steps`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'test_case' AND column_name = 'sort_order');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `test_case` ADD KEY `idx_ws_req_sort` (`workspace_id`,`req_id`,`sort_order`)',
  'DO 0') FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'test_case' AND index_name = 'idx_ws_req_sort');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 历史回填：按原创建顺序编号，保持升级后的现有视觉顺序；已有手工顺序时跳过
SET @s := IF((SELECT COUNT(*) FROM `test_case` WHERE `sort_order` <> 0) = 0,
  'UPDATE `test_case` c
     JOIN (SELECT id, ROW_NUMBER() OVER (PARTITION BY workspace_id, req_id ORDER BY created_at, id) - 1 AS rn
             FROM `test_case`) t ON t.id = c.id
        SET c.sort_order = t.rn',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 4) test_module → category 迁移
--    4.1 顶层同名节点先映射到已有 category，再改写引用，避免插成两个同名顶级目录
--    4.2 其余节点沿用 test_module.id 原样插入（用例 module_id 不必重写）
--    4.3 子节点的 parent_id 通过映射表换成合并后的父 id
-- ---------------------------------------------------------------------------
-- 映射表用普通表：MySQL 临时表在同一语句里不能出现两次（自连接会报 1137）
DROP TABLE IF EXISTS `hg_case_dir_map_100`;
CREATE TABLE `hg_case_dir_map_100` (
  `old_id` varchar(32) NOT NULL COMMENT 'test_module.id',
  `new_id` varchar(32) NOT NULL COMMENT '迁移后的 category.id',
  `merged` tinyint NOT NULL DEFAULT '0' COMMENT '1=合并到已有 category，0=原 id 迁入',
  PRIMARY KEY (`old_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 顶层同名：项目目录里已经有同名节点（任务 / 需求在用），合并过去
INSERT INTO `hg_case_dir_map_100` (`old_id`, `new_id`, `merged`)
SELECT tm.id, c.id, 1
  FROM `test_module` tm
  JOIN `category` c
    ON c.workspace_id = tm.workspace_id
   AND c.project_id = tm.req_id
   AND c.parent_id = ''
   AND c.name = tm.name
 WHERE tm.parent_id = '';

-- 顶层不冲突的节点原 id 迁入
INSERT INTO `hg_case_dir_map_100` (`old_id`, `new_id`, `merged`)
SELECT tm.id, tm.id, 0
  FROM `test_module` tm
 WHERE tm.parent_id = ''
   AND NOT EXISTS (SELECT 1 FROM `category` c
                    WHERE c.workspace_id = tm.workspace_id AND c.project_id = tm.req_id
                      AND c.parent_id = '' AND c.name = tm.name);

-- 子节点原 id 迁入（test_module 内同级同名由唯一键保证，不会重复）
INSERT INTO `hg_case_dir_map_100` (`old_id`, `new_id`, `merged`)
SELECT tm.id, tm.id, 0
  FROM `test_module` tm
 WHERE tm.parent_id <> '';

-- 用例归属改到合并后的节点（module 文本是快照，名称一致，不改）
UPDATE `test_case` c
  JOIN `hg_case_dir_map_100` m ON m.old_id = c.module_id AND m.merged = 1
   SET c.module_id = m.new_id;

-- 动态分组的目录条件同步替换；只替换精确的 moduleId 键值，避免误伤其他字段
UPDATE `case_set` s
  JOIN `hg_case_dir_map_100` m
    ON m.merged = 1
   AND s.rule_json LIKE CONCAT('%"moduleId":"', m.old_id, '"%')
   SET s.rule_json = REPLACE(s.rule_json,
         CONCAT('"moduleId":"', m.old_id, '"'),
         CONCAT('"moduleId":"', m.new_id, '"'));

-- 未合并节点插入项目目录；父级优先取映射后的 id
INSERT INTO `category` (`id`, `workspace_id`, `project_id`, `parent_id`, `name`, `color`, `sort_order`, `created_at`)
SELECT tm.id, tm.workspace_id, tm.req_id,
       COALESCE(p.new_id, tm.parent_id),
       tm.name, '#8a8578', tm.sort_order, tm.created_at
  FROM `test_module` tm
  JOIN `hg_case_dir_map_100` m ON m.old_id = tm.id AND m.merged = 0
  LEFT JOIN `hg_case_dir_map_100` p ON p.old_id = tm.parent_id
 WHERE NOT EXISTS (SELECT 1 FROM `category` c WHERE c.id = tm.id);

DROP TABLE IF EXISTS `hg_case_dir_map_100`;

-- test_module 保留不删：回滚时仍能找回原树；服务层从本脚本起只读写 category。

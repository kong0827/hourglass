-- 流程体检（v1）：让 task_log 能算出「每列停留多久 / 有没有回退」
--
-- 背景：原来 move 事件的 detail 是自由文本「从「进行中」移动到「已完成」」，只有列名没有列 ID。
-- 列改名后文本就对不上当前列，也无法可靠判断列的先后顺序（回退判定依赖顺序）。
-- 这里补两列结构化字段：新数据由 TaskService.move 直接写入，历史数据按文本回填。

USE hourglass;

-- 幂等：先查 information_schema 再决定是否 ALTER，重复执行安全（--sql-all 重放不会报错）
SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_log' AND COLUMN_NAME = 'from_column');
SET @s := IF(@x = 0,
  'ALTER TABLE task_log ADD COLUMN from_column VARCHAR(16) DEFAULT NULL COMMENT ''移动前所在看板列 id（仅 action=move 且跨列时非空）'' AFTER detail',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_log' AND COLUMN_NAME = 'to_column');
SET @s := IF(@x = 0,
  'ALTER TABLE task_log ADD COLUMN to_column VARCHAR(16) DEFAULT NULL COMMENT ''移动后所在看板列 id（仅 action=move 且跨列时非空）'' AFTER from_column',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 流程体检按「空间 + 动作 + 时间」扫描，量最大的是 move
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_log' AND INDEX_NAME = 'idx_ws_action_time');
SET @s := IF(@x = 0,
  'ALTER TABLE task_log ADD KEY idx_ws_action_time (workspace_id, action, created_at)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 历史回填：detail 形如 从「待处理」移动到「进行中」
--   from = 第 2 个「 到其后第一个 」之间的内容
--   to   = 最后一个「 到其后第一个 」之间的内容
-- 列改名过的历史记录会回填不上（留 NULL），Service 侧会在覆盖率里体现，不做猜测。
UPDATE task_log l
SET l.from_column = (
      SELECT f.id FROM board_column f
      WHERE f.workspace_id = l.workspace_id
        AND f.name = SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(l.detail, '「', 2), '「', -1), '」', 1)
      ORDER BY f.sort_order, f.id
      LIMIT 1
    )
WHERE l.action = 'move'
  AND l.from_column IS NULL
  AND l.detail LIKE '从「%移动到「%';

UPDATE task_log l
SET l.to_column = (
      SELECT t.id FROM board_column t
      WHERE t.workspace_id = l.workspace_id
        AND t.name = SUBSTRING_INDEX(SUBSTRING_INDEX(l.detail, '「', -1), '」', 1)
      ORDER BY t.sort_order, t.id
      LIMIT 1
    )
WHERE l.action = 'move'
  AND l.to_column IS NULL
  AND l.detail LIKE '从「%移动到「%';

-- 「已完成」是内置列，不落 board_column 表（内置列只有 backlog/doing 会被种入），
-- 所以按常量补上（值同 Consts.COL_DONE）。漏了这两条，所有「→ 已完成」的移动都解析不出来，
-- 而它正是「进行中」停留的结束边界。
UPDATE task_log
SET to_column = 'done'
WHERE action = 'move'
  AND to_column IS NULL
  AND detail LIKE '%移动到「已完成」';

UPDATE task_log
SET from_column = 'done'
WHERE action = 'move'
  AND from_column IS NULL
  AND detail LIKE '从「已完成」%';

-- 校验：能解析出 from/to 的 move 占比（回填效果）
SELECT COUNT(*)                                                        AS move_total,
       SUM(from_column IS NOT NULL AND to_column IS NOT NULL)          AS move_structured,
       SUM(from_column IS NULL OR to_column IS NULL)                   AS move_unresolved
FROM task_log
WHERE action = 'move';

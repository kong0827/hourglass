-- ============================================================================
-- 甘特图 V1.4 / V2.0（2026-10-30）
--   1) 任务里程碑：单日节点，甘特图用菱形展示
--   2) 正式依赖表：支持 FS/SS/FF/SF 与滞后天数，替代单字段 blocked_by_task_id
--   3) 基线：一次快照全部任务的计划起止，用于「计划 vs 当前」偏差
--   4) 只读分享：空间级 token，公开 GET /api/share/gantt?token=
--
-- 全部语句幂等：可被 deploy.sh --sql-all 重复执行。
-- ============================================================================

USE hourglass;

-- ---------------------------------------------------------------------------
-- 1. task.is_milestone
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'is_milestone');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD COLUMN is_milestone TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''里程碑（单日节点）'' AFTER progress',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 2. task_dependency：有向边 from（前驱）→ to（后继）
--    同一对任务只保留一条；类型由 dep_type 决定，lag_days 可为负
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_dependency (
  id           VARCHAR(32) NOT NULL COMMENT '依赖ID',
  workspace_id VARCHAR(32) NOT NULL COMMENT '归属空间',
  from_task_id VARCHAR(32) NOT NULL COMMENT '前驱任务（先做）',
  to_task_id   VARCHAR(32) NOT NULL COMMENT '后继任务（后做）',
  dep_type     VARCHAR(2)  NOT NULL DEFAULT 'FS' COMMENT 'FS/SS/FF/SF',
  lag_days     INT         NOT NULL DEFAULT 0 COMMENT '滞后天数（可为负）',
  created_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_edge (from_task_id, to_task_id),
  KEY idx_ws (workspace_id),
  KEY idx_to (to_task_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '任务依赖（甘特图）';

-- 历史 blocked_by_task_id → FS 依赖（幂等，ID 由三元组哈希生成，重跑不会重复）
INSERT INTO task_dependency (id, workspace_id, from_task_id, to_task_id, dep_type, lag_days, created_at)
SELECT CONCAT('D', LEFT(MD5(CONCAT(t.workspace_id, ':', t.blocked_by_task_id, ':', t.id)), 20)),
       t.workspace_id, t.blocked_by_task_id, t.id, 'FS', 0, NOW()
FROM task t
JOIN task p ON p.id = t.blocked_by_task_id
WHERE t.deleted_at IS NULL
  AND p.deleted_at IS NULL
  AND t.blocked_by_task_id IS NOT NULL
  AND t.blocked_by_task_id <> ''
  AND t.blocked_by_task_id <> t.id
  AND NOT EXISTS (SELECT 1 FROM task_dependency d
                  WHERE d.from_task_id = t.blocked_by_task_id AND d.to_task_id = t.id);

-- ---------------------------------------------------------------------------
-- 3. task_baseline：每空间每任务一条（最后一次「设为基线」的快照）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_baseline (
  workspace_id VARCHAR(32) NOT NULL COMMENT '归属空间',
  task_id      VARCHAR(32) NOT NULL COMMENT '任务ID',
  start_date   DATE        DEFAULT NULL COMMENT '基线开始日期',
  due_date     DATE        DEFAULT NULL COMMENT '基线截止日期',
  captured_at  DATETIME    NOT NULL COMMENT '快照时间',
  PRIMARY KEY (workspace_id, task_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '甘特图基线快照';

-- ---------------------------------------------------------------------------
-- 4. gantt_share：空间级只读分享 token（每空间一个，可重置/撤销）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gantt_share (
  workspace_id VARCHAR(32) NOT NULL COMMENT '归属空间',
  token        VARCHAR(32) NOT NULL COMMENT '分享令牌（URL 参数）',
  created_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  expires_at   DATETIME    DEFAULT NULL COMMENT '过期时间（空=长期有效）',
  PRIMARY KEY (workspace_id),
  UNIQUE KEY uk_token (token)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '甘特图只读分享';

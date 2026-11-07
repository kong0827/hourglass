-- ============================================================================
-- 工作台 · 任务完成快照（2026-10-21）
--
-- 背景：需要在月底 / 任意时段统计"这段时间完成了哪些任务、各花多久"。
--       直接查 task 表不行 —— 任务被删、被改名、循环任务派生新 ID 都会让历史失真；
--       而且 time_log 只记工时，不记"归属项目名称 / 负责人"等当时的快照。
--       所以任务完成的那一刻落一条**快照**，之后任务怎么改都不影响已归档的记录。
--
-- 写入时机（由服务端负责，前端不需要调）：
--   · 任务移入「已完成」列 / 抽屉里把列改成已完成 → upsert 一条；
--   · 取消完成（离开已完成列）→ 删除该任务的记录，再次完成会重新生成；
--   · 彻底删除任务（回收站清理）→ 一并删除，避免任务 ID 复用时污染。
--
-- 设计原则：纯增量、幂等、向后兼容。
--   · CREATE TABLE IF NOT EXISTS，可重复执行；
--   · 不动既有表结构与数据；
--   · 存量已完成任务**不回填**（没有完成瞬间的快照数据，硬造不准确）；
--     如需补一份历史，可用下面的"回填"语句按当前状态粗略生成（见文件末尾，默认注释掉）。
--
-- 执行：mysql -u hourglass -p hourglass < sql/06_task_completion_record.sql
-- ============================================================================

USE hourglass;

CREATE TABLE IF NOT EXISTS task_completion_record (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '记录ID',
  workspace_id     VARCHAR(32)     NOT NULL COMMENT '归属空间ID',
  task_id          VARCHAR(32)     NOT NULL COMMENT '任务ID（任务删除后仍保留，用于追溯）',
  title            VARCHAR(60)     NOT NULL COMMENT '任务名称（完成时的快照）',
  description      VARCHAR(200)    DEFAULT NULL COMMENT '任务详情（完成时的快照）',
  req_id           VARCHAR(32)     DEFAULT NULL COMMENT '归属项目ID',
  req_name         VARCHAR(60)     DEFAULT NULL COMMENT '归属项目名称（冗余，防项目改名/删除后失真）',
  owner            VARCHAR(32)     DEFAULT NULL COMMENT '负责人（完成时的快照）',
  owner_user_id    VARCHAR(32)     DEFAULT NULL COMMENT '负责人账号ID',
  category         VARCHAR(16)     DEFAULT NULL COMMENT '分类',
  priority         VARCHAR(3)      DEFAULT NULL COMMENT '优先级 P0-P3',
  start_date       DATE            DEFAULT NULL COMMENT '任务开始日期',
  completed_at     DATE            NOT NULL COMMENT '完成日期',
  first_started_at DATETIME        DEFAULT NULL COMMENT '首次计时开始时间',
  last_ended_at    DATETIME        DEFAULT NULL COMMENT '最后一次计时结束时间',
  total_minutes    INT             NOT NULL DEFAULT 0 COMMENT '总耗时（分钟，已按每天 8h / 跳过周末裁剪）',
  created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '归档时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_ws_task (workspace_id, task_id),
  KEY idx_ws_completed (workspace_id, completed_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '任务完成快照（月度统计用）';

-- ---------------------------------------------------------------------------
-- 自检：应能看到表结构与索引
-- ---------------------------------------------------------------------------
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_completion_record'
ORDER BY ORDINAL_POSITION;

-- ---------------------------------------------------------------------------
-- （可选）存量已完成任务回填
-- 说明：没有完成瞬间的快照，这里按"当前状态"粗略补一份，项目名取当前项目的名字。
--       默认注释掉，需要时手工执行。
-- ---------------------------------------------------------------------------
-- INSERT IGNORE INTO task_completion_record
--   (workspace_id, task_id, title, description, req_id, req_name, owner, owner_user_id,
--    category, priority, start_date, completed_at, first_started_at, last_ended_at, total_minutes)
-- SELECT t.workspace_id, t.id, t.title, LEFT(t.description, 200), t.req_id, r.name, t.owner, t.owner_user_id,
--        t.category, t.priority, t.start_date, t.completed_at,
--        (SELECT MIN(l.started_at) FROM time_log l WHERE l.task_id = t.id AND l.workspace_id = t.workspace_id),
--        (SELECT MAX(l.ended_at)   FROM time_log l WHERE l.task_id = t.id AND l.workspace_id = t.workspace_id),
--        COALESCE((SELECT SUM(l.minutes) FROM time_log l WHERE l.task_id = t.id AND l.workspace_id = t.workspace_id), 0)
-- FROM task t
-- LEFT JOIN requirement r ON r.id = t.req_id AND r.workspace_id = t.workspace_id
-- WHERE t.board_column = 'done' AND t.completed_at IS NOT NULL AND t.deleted_at IS NULL;

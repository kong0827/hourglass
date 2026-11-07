-- 任务关注人：关注后该任务的字段变更、评论、移入回收站等事件都会通知关注者。
-- 执行：mysql -u hourglass -p hourglass < sql/36_task_watch.sql
-- 幂等：IF NOT EXISTS。
USE hourglass;

CREATE TABLE IF NOT EXISTS task_watch (
  task_id VARCHAR(32) NOT NULL COMMENT '任务ID',
  workspace_id VARCHAR(32) NOT NULL COMMENT '归属空间ID',
  user_id VARCHAR(32) NOT NULL COMMENT '关注人用户ID',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '关注时间',
  PRIMARY KEY (task_id, user_id),
  INDEX idx_watch_user (user_id, workspace_id),
  INDEX idx_watch_ws_task (workspace_id, task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务关注人';

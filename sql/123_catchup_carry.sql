-- 周五补记：未处理项跨周承接
-- 提交时把「未处理 / 跳过」的工作项快照到下周；下周草稿优先合并这些项，
-- 兑现「未处理的会留在下周补记」；撤销提交时按 from_session_id 删除。
CREATE TABLE IF NOT EXISTS catchup_carry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  from_session_id VARCHAR(32) NOT NULL COMMENT '产生承接的本周会话',
  to_week_start DATE NOT NULL COMMENT '承接到的周一',
  task_id VARCHAR(32) NOT NULL,
  item_no INT NULL,
  title VARCHAR(120) NOT NULL,
  project_name VARCHAR(80) NULL,
  type_label VARCHAR(16) NULL,
  status_label VARCHAR(16) NULL,
  minutes INT NOT NULL DEFAULT 0 COMMENT '快照时的本周计时，仅用于展示',
  reason VARCHAR(16) NOT NULL COMMENT 'pending / skipped',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_carry_session_task (from_session_id, task_id),
  KEY idx_carry_week (to_week_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='周五补记未处理项承接';

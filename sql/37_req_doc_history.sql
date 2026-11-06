-- 文档历史快照：正文有变化时自动留存一版，用于查看与恢复旧版本（每文档最多保留最近 20 版）。
-- 执行：mysql -u hourglass -p hourglass < sql/37_req_doc_history.sql
-- 幂等：IF NOT EXISTS。
USE hourglass;

CREATE TABLE IF NOT EXISTS requirement_doc_history (
  id VARCHAR(32) NOT NULL COMMENT '快照ID',
  doc_id VARCHAR(32) NOT NULL COMMENT '文档ID（requirement_doc.id）',
  workspace_id VARCHAR(32) NOT NULL COMMENT '归属空间ID',
  version_no INT NOT NULL COMMENT '同一文档内从 1 递增的版本号',
  title VARCHAR(100) NOT NULL COMMENT '快照时的文档标题',
  content MEDIUMTEXT COMMENT '快照时的正文（与 requirement_doc.content 同口径）',
  format VARCHAR(16) NOT NULL DEFAULT 'markdown' COMMENT '正文格式：html / markdown',
  saved_by VARCHAR(32) DEFAULT NULL COMMENT '保存人显示名',
  saved_by_user_id VARCHAR(32) DEFAULT NULL COMMENT '保存人账号ID',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '快照时间',
  PRIMARY KEY (id),
  INDEX idx_history_doc (doc_id, version_no),
  INDEX idx_history_ws (workspace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档历史快照（查看与恢复旧版本）';

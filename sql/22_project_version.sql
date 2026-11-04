USE devstudio;

CREATE TABLE IF NOT EXISTS project_version (
  id           VARCHAR(32)  NOT NULL COMMENT '版本ID',
  workspace_id VARCHAR(32)  NOT NULL COMMENT '归属空间ID',
  req_id       VARCHAR(32)  NOT NULL COMMENT '所属项目ID',
  name         VARCHAR(40)  NOT NULL COMMENT '版本名称',
  description  VARCHAR(500) DEFAULT NULL COMMENT '版本说明与发布摘要',
  status       VARCHAR(16)  NOT NULL DEFAULT 'planned' COMMENT 'planned/active/released',
  target_date  DATE         DEFAULT NULL COMMENT '计划发布日期',
  released_at  DATETIME     DEFAULT NULL COMMENT '实际发布时间',
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_req_version_name (req_id, name),
  KEY idx_ws_req (workspace_id, req_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '项目版本';

CREATE TABLE IF NOT EXISTS version_task (
  task_id      VARCHAR(32) NOT NULL COMMENT '任务ID，一个任务最多归属一个版本',
  workspace_id VARCHAR(32) NOT NULL COMMENT '归属空间ID',
  version_id   VARCHAR(32) NOT NULL COMMENT '版本ID',
  created_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '关联时间',
  PRIMARY KEY (task_id),
  KEY idx_version (version_id),
  KEY idx_workspace (workspace_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '版本任务关联';

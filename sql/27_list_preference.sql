USE devstudio;

-- 任务列表 / 项目列表的视图模式与显示列偏好（按用户、空间、视图隔离）
CREATE TABLE IF NOT EXISTS user_list_preference (
  user_id      VARCHAR(32)   NOT NULL COMMENT '用户ID',
  workspace_id VARCHAR(32)   NOT NULL COMMENT '空间ID',
  view_key     VARCHAR(32)   NOT NULL COMMENT '视图：task-list/project-list',
  view_mode    VARCHAR(16)   NOT NULL COMMENT '视图模式：table/card',
  columns_json VARCHAR(1000) NOT NULL COMMENT '显示列紧凑JSON数组',
  updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (user_id, workspace_id, view_key)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '用户列表视图与显示列偏好';

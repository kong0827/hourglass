-- 项目与项目内需求文档的通用活动轨迹；仅新增表，不迁移历史日志。
USE hourglass;

CREATE TABLE IF NOT EXISTS work_activity (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  workspace_id  VARCHAR(32)  NOT NULL COMMENT '归属空间ID',
  entity_type   VARCHAR(32)  NOT NULL COMMENT '实体类型：project/requirement_doc',
  entity_id     VARCHAR(32)  NOT NULL COMMENT '实体ID',
  actor_id      VARCHAR(32)  DEFAULT NULL COMMENT '操作人用户ID',
  actor_name    VARCHAR(64)  DEFAULT NULL COMMENT '操作人显示名快照',
  action        VARCHAR(32)  NOT NULL COMMENT 'create/update/first_release',
  detail        VARCHAR(1000) DEFAULT NULL COMMENT '变更摘要（正文不保存HTML）',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (id),
  KEY idx_ws_entity_id (workspace_id, entity_type, entity_id, id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '业务实体活动轨迹';

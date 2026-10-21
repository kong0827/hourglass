-- 工作台 · 任务看板 升级脚本 02：新增「空间邀请链接」表
-- 适用：已部署旧版数据库的升级（全新安装直接执行 01_schema.sql，已含本表）。
-- 可重复执行（IF NOT EXISTS）。执行方式：mysql -uroot -p < 02_invite.sql
USE devstudio;

CREATE TABLE IF NOT EXISTS invite (
  id           VARCHAR(16) NOT NULL COMMENT '邀请码（10 位大写字母数字）',
  workspace_id VARCHAR(32) NOT NULL COMMENT '归属空间ID',
  created_by   VARCHAR(32) NOT NULL COMMENT '创建人用户ID',
  expires_at   DATETIME    NOT NULL COMMENT '过期时间',
  used_count   INT         NOT NULL DEFAULT 0 COMMENT '已通过该链接加入的人数',
  created_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (id),
  KEY idx_ws (workspace_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '空间邀请链接';

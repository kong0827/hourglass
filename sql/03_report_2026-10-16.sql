-- ============================================================================
-- 工作台 · 功能评估报告（2026-10-16）改造 · 增量迁移脚本
--
-- 设计原则：
--   1. 纯增量：只 ADD COLUMN / ADD INDEX / CREATE TABLE，不 DROP、不改类型、不动数据。
--   2. 幂等：全部用 information_schema 判断 + PREPARE 动态执行（不依赖存储过程权限），
--      重复执行安全（--sql-all 重放也不会报错）。
--   3. 向后兼容：新列全部可空或有默认值；owner_user_id 为空时业务回落显示名文本，
--      历史数据不需要回填也能正常工作。
--
-- 执行：mysql -u hourglass -p hourglass < sql/03_report_2026-10-16.sql
-- ============================================================================

USE hourglass;

-- ---------------------------------------------------------------------------
-- task：负责人身份绑定（N-2）/ 提醒目标（N-1）/ 阻塞卡点（N-4）
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'owner_user_id');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD COLUMN owner_user_id VARCHAR(32) DEFAULT NULL COMMENT ''负责人账号ID（空=按显示名文本兼容）'' AFTER owner',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'remind_target');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD COLUMN remind_target VARCHAR(16) NOT NULL DEFAULT ''owner'' COMMENT ''提醒谁：owner / owner+admin'' AFTER remind_at',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'is_blocked');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD COLUMN is_blocked TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''是否被阻塞（卡点）'' AFTER progress',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'blocked_reason');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD COLUMN blocked_reason VARCHAR(120) DEFAULT NULL COMMENT ''卡点原因（卡在什么上/等谁）'' AFTER is_blocked',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'blocked_by_task_id');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD COLUMN blocked_by_task_id VARCHAR(32) DEFAULT NULL COMMENT ''等待的任务ID（可选的依赖关系）'' AFTER blocked_reason',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 按负责人账号检索（「我的任务」与身份聚合用）
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND INDEX_NAME = 'idx_owner_user');
SET @s := IF(@x = 0, 'CREATE INDEX idx_owner_user ON task (owner_user_id, workspace_id)', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 阻塞筛选
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND INDEX_NAME = 'idx_blocked');
SET @s := IF(@x = 0, 'CREATE INDEX idx_blocked ON task (workspace_id, is_blocked)', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- workspace：通知渠道从全局环境变量下沉到空间级（O-1）
--   说明：notify_enabled 用 NULL 表示"未设置"，服务端视为跟随全局 app.notify.enabled，
--        这样升级后行为不变（不会因为加了列而默默改变现有推送行为）。
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workspace' AND COLUMN_NAME = 'notify_channel');
SET @s := IF(@x = 0,
  'ALTER TABLE workspace ADD COLUMN notify_channel VARCHAR(16) DEFAULT NULL COMMENT ''webhook/serverchan/pushplus，空=跟随全局 NOTIFY_TYPE'' AFTER notify_webhook',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workspace' AND COLUMN_NAME = 'notify_enabled');
SET @s := IF(@x = 0,
  'ALTER TABLE workspace ADD COLUMN notify_enabled TINYINT(1) DEFAULT NULL COMMENT ''空间推送开关：NULL=跟随全局，1=开，0=关'' AFTER notify_channel',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workspace' AND COLUMN_NAME = 'notify_token');
SET @s := IF(@x = 0,
  'ALTER TABLE workspace ADD COLUMN notify_token VARCHAR(64) DEFAULT NULL COMMENT ''Server酱 SendKey / PushPlus token（空=用全局）'' AFTER notify_enabled',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workspace' AND COLUMN_NAME = 'notify_last_at');
SET @s := IF(@x = 0,
  'ALTER TABLE workspace ADD COLUMN notify_last_at DATETIME DEFAULT NULL COMMENT ''上次推送尝试时间（设置页「是否真正生效」的依据）'' AFTER notify_token',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workspace' AND COLUMN_NAME = 'notify_last_status');
SET @s := IF(@x = 0,
  'ALTER TABLE workspace ADD COLUMN notify_last_status VARCHAR(160) DEFAULT NULL COMMENT ''success / failed:原因'' AFTER notify_last_at',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- task_comment：人工讨论（N-6）
--   与 task_log 分开存：时间线记"系统做了什么"，评论记"人说了什么"。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_comment (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '评论ID',
  task_id      VARCHAR(32)     NOT NULL COMMENT '所属任务ID',
  workspace_id VARCHAR(32)     NOT NULL COMMENT '归属空间ID',
  author_id    VARCHAR(32)     DEFAULT NULL COMMENT '作者用户ID',
  author_name  VARCHAR(32)     DEFAULT NULL COMMENT '作者显示名快照（作者被删后仍可读）',
  content      VARCHAR(500)    NOT NULL COMMENT '评论正文',
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发表时间',
  PRIMARY KEY (id),
  KEY idx_task (task_id, id),
  KEY idx_ws (workspace_id, id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '任务评论（人工讨论）';

-- ---------------------------------------------------------------------------
-- app_notification：应用内通知（N-1）
--   让提醒不再只依赖外部群机器人：铃铛即通知中心，未读角标 + 列表 + 已读。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_notification (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '通知ID',
  user_id      VARCHAR(32)     NOT NULL COMMENT '收件人用户ID',
  workspace_id VARCHAR(32)     NOT NULL COMMENT '来源空间ID',
  type         VARCHAR(24)     NOT NULL COMMENT '类型：task_remind/task_due/task_assigned/task_comment',
  title        VARCHAR(120)    NOT NULL COMMENT '标题',
  body         VARCHAR(500)    DEFAULT NULL COMMENT '正文',
  ref_task_id  VARCHAR(32)     DEFAULT NULL COMMENT '关联任务ID（点击直达）',
  read_at      DATETIME        DEFAULT NULL COMMENT '已读时间，空=未读',
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '产生时间',
  PRIMARY KEY (id),
  KEY idx_user_unread (user_id, read_at, id),
  KEY idx_user_ws (user_id, workspace_id, id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '应用内通知';

-- ---------------------------------------------------------------------------
-- task_log：空间级活动流（O-9）
--   复用既有结构（已含 workspace_id），只补索引；action 新增 undo（O-26 撤销删除落时间线）。
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_log' AND INDEX_NAME = 'idx_ws');
SET @s := IF(@x = 0, 'CREATE INDEX idx_ws ON task_log (workspace_id, id)', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SELECT '03_report_2026-10-16.sql 执行完成' AS result;

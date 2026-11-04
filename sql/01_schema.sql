-- 工作台 · 任务看板 数据库基线（MySQL 8，utf8mb4）
-- 多用户 + 空间模型：每个账号有个人空间，可另建/加入共享空间；业务数据按空间隔离
CREATE DATABASE IF NOT EXISTS hourglass DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE hourglass;

-- 用户（管理员创建下发，不开放注册；首次启动由环境变量引导创建管理员）
CREATE TABLE IF NOT EXISTS app_user (
  id                VARCHAR(32) NOT NULL COMMENT '用户ID',
  username          VARCHAR(32) NOT NULL COMMENT '登录名',
  password_hash     VARCHAR(72) NOT NULL COMMENT 'bcrypt 密码哈希',
  display_name      VARCHAR(32) NOT NULL COMMENT '显示名（负责人默认值）',
  role              VARCHAR(16) NOT NULL DEFAULT 'user' COMMENT '角色：admin/user（只管账号）',
  last_workspace_id VARCHAR(32) DEFAULT NULL COMMENT '上次使用的空间',
  created_at        DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at        DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_username (username)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '用户';

-- 空间（personal=个人空间，每账号一个；shared=共享空间，多人协作）
CREATE TABLE IF NOT EXISTS workspace (
  id             VARCHAR(32)  NOT NULL COMMENT '空间ID（个人空间为 W+用户ID）',
  name           VARCHAR(20)  NOT NULL COMMENT '空间名称',
  type           VARCHAR(16)  NOT NULL DEFAULT 'shared' COMMENT 'personal/shared',
  notify_webhook VARCHAR(255) DEFAULT NULL COMMENT '空间推送 webhook（群机器人）',
  notify_channel VARCHAR(16)  DEFAULT NULL COMMENT 'webhook/serverchan/pushplus，空=跟随全局 NOTIFY_TYPE',
  notify_enabled TINYINT(1)   DEFAULT NULL COMMENT '空间推送开关：NULL=跟随全局，1=开，0=关',
  notify_token   VARCHAR(64)  DEFAULT NULL COMMENT 'Server酱 SendKey / PushPlus token（空=用全局）',
  notify_last_at DATETIME     DEFAULT NULL COMMENT '上次推送尝试时间',
  notify_last_status VARCHAR(160) DEFAULT NULL COMMENT 'success / failed:原因',
  owner_id       VARCHAR(32)  NOT NULL COMMENT '空间主用户ID',
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  KEY idx_owner (owner_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '空间';

CREATE TABLE IF NOT EXISTS workspace_member (
  workspace_id VARCHAR(32) NOT NULL COMMENT '空间ID',
  user_id      VARCHAR(32) NOT NULL COMMENT '成员用户ID',
  role         VARCHAR(16) NOT NULL DEFAULT 'member' COMMENT 'owner/member',
  created_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '加入时间',
  PRIMARY KEY (workspace_id, user_id),
  KEY idx_user (user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '空间成员';

-- 分类（每个空间一套，可增删改；任务里存分类名）
CREATE TABLE IF NOT EXISTS category (
  id           VARCHAR(32) NOT NULL COMMENT '分类ID',
  workspace_id VARCHAR(32) NOT NULL COMMENT '归属空间ID',
  name         VARCHAR(12) NOT NULL COMMENT '分类名',
  color        VARCHAR(16) NOT NULL DEFAULT '#8a8578' COMMENT '颜色',
  sort_order   INT         NOT NULL DEFAULT 0 COMMENT '排序',
  created_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_ws_name (workspace_id, name)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '分类（按空间）';

CREATE TABLE IF NOT EXISTS task (
  id           VARCHAR(32)      NOT NULL COMMENT '任务ID（沿用前端生成的字符串ID）',
  workspace_id VARCHAR(32)      NOT NULL COMMENT '归属空间ID',
  title        VARCHAR(60)      NOT NULL COMMENT '标题',
  description  VARCHAR(200)     DEFAULT NULL COMMENT '描述',
  priority     VARCHAR(4)       NOT NULL DEFAULT 'P2' COMMENT '优先级 P0/P1/P2/P3',
  owner        VARCHAR(32)      NOT NULL DEFAULT '我' COMMENT '负责人（显示名文本，历史兼容）',
  owner_user_id VARCHAR(32)     DEFAULT NULL COMMENT '负责人账号ID（空=按显示名文本兼容）',
  category     VARCHAR(16)      NOT NULL DEFAULT '' COMMENT '分类名（取值来自 category 表）',
  board_column VARCHAR(16)      NOT NULL DEFAULT 'backlog' COMMENT '看板列 id',
  start_date   DATE             DEFAULT NULL COMMENT '开始日期（空=只在截止日出现在日历上）',
  due_date     DATE             DEFAULT NULL COMMENT '截止日期',
  req_id       VARCHAR(32)      DEFAULT NULL COMMENT '所属项目ID（requirement 表）',
  req_doc_id   VARCHAR(32)      DEFAULT NULL COMMENT '关联需求ID（requirement_doc）',
  progress     TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '进度 0-100',
  is_blocked   TINYINT(1)       NOT NULL DEFAULT 0 COMMENT '是否被阻塞（卡点）',
  blocked_reason VARCHAR(120)   DEFAULT NULL COMMENT '卡点原因（卡在什么上/等谁）',
  blocked_by_task_id VARCHAR(32) DEFAULT NULL COMMENT '等待的任务ID（可选的依赖关系）',
  note         VARCHAR(80)      DEFAULT NULL COMMENT '进度备注',
  completed_at DATE             DEFAULT NULL COMMENT '完成日期',
  recur_type   VARCHAR(8)       DEFAULT NULL COMMENT '循环：daily/weekly/monthly，空为不循环',
  recur_next_id VARCHAR(32)     DEFAULT NULL COMMENT '循环派生的下一次任务ID（重复完成时复用，防重复生成）',
  remind_at    DATETIME         DEFAULT NULL COMMENT '任务级提醒时间',
  remind_target VARCHAR(16)     NOT NULL DEFAULT 'owner' COMMENT '提醒谁：owner / owner+admin',
  remind_sent  TINYINT(1)       NOT NULL DEFAULT 0 COMMENT '提醒是否已推送',
  deleted_at   DATETIME         DEFAULT NULL COMMENT '软删除时间（回收站），空为正常',
  sort_order   INT              NOT NULL DEFAULT 0 COMMENT '列内排序序号',
  created_at   DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at   DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  KEY idx_ws (workspace_id),
  KEY idx_board (workspace_id, board_column, sort_order),
  KEY idx_req (req_id),
  KEY idx_req_doc (req_doc_id),
  KEY idx_due (due_date),
  KEY idx_deleted (deleted_at),
  KEY idx_remind (remind_at, remind_sent),
  KEY idx_owner_user (owner_user_id, workspace_id),
  KEY idx_blocked (workspace_id, is_blocked)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '任务';

CREATE TABLE IF NOT EXISTS requirement (
  id           VARCHAR(32)  NOT NULL COMMENT '项目ID',
  workspace_id VARCHAR(32)  NOT NULL COMMENT '归属空间ID',
  name         VARCHAR(40)  NOT NULL COMMENT '项目名称',
  description  VARCHAR(160) DEFAULT NULL COMMENT '项目描述',
  status       VARCHAR(16)  NOT NULL DEFAULT 'active' COMMENT '状态：active/done/hold',
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  KEY idx_ws (workspace_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '项目（原需求）';

-- 需求：挂在项目下的一层，带富文本正文；任务通过 task.req_doc_id 关联
CREATE TABLE IF NOT EXISTS requirement_doc (
  id            VARCHAR(32)  NOT NULL COMMENT '需求ID',
  workspace_id  VARCHAR(32)  NOT NULL COMMENT '归属空间ID',
  req_id        VARCHAR(32)  NOT NULL COMMENT '所属项目ID（requirement.id）',
  title         VARCHAR(100) NOT NULL COMMENT '需求标题',
  content       MEDIUMTEXT   DEFAULT NULL COMMENT '需求正文（清洗后的 HTML）',
  status        VARCHAR(16)  NOT NULL DEFAULT 'draft' COMMENT '状态：draft/active/done',
  owner         VARCHAR(32)  DEFAULT NULL COMMENT '负责人显示名',
  owner_user_id VARCHAR(32)  DEFAULT NULL COMMENT '负责人账号ID',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  KEY idx_ws (workspace_id),
  KEY idx_req (req_id),
  KEY idx_ws_updated (workspace_id, updated_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '需求（项目下的需求文档）';

CREATE TABLE IF NOT EXISTS task_log (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '日志ID',
  task_id    VARCHAR(32)     NOT NULL COMMENT '任务ID',
  workspace_id VARCHAR(32)   NOT NULL COMMENT '归属空间ID',
  actor_id   VARCHAR(32)     DEFAULT NULL COMMENT '操作人用户ID（历史数据可空）',
  action     VARCHAR(16)     NOT NULL COMMENT '动作：create/update/move/delete/restore/undo',
  detail     VARCHAR(255)    DEFAULT NULL COMMENT '变更摘要',
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发生时间',
  PRIMARY KEY (id),
  KEY idx_task (task_id, id),
  KEY idx_ws (workspace_id, id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '任务操作日志（时间线）';

-- 任务评论（人工讨论，与 task_log 的系统动作分开）
CREATE TABLE IF NOT EXISTS task_comment (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '评论ID',
  task_id      VARCHAR(32)     NOT NULL COMMENT '所属任务ID',
  workspace_id VARCHAR(32)     NOT NULL COMMENT '归属空间ID',
  author_id    VARCHAR(32)     DEFAULT NULL COMMENT '作者用户ID',
  author_name  VARCHAR(32)     DEFAULT NULL COMMENT '作者显示名快照',
  content      VARCHAR(500)    NOT NULL COMMENT '评论正文',
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发表时间',
  PRIMARY KEY (id),
  KEY idx_task (task_id, id),
  KEY idx_ws (workspace_id, id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '任务评论';

-- 应用内通知（铃铛即通知中心，不依赖外部 IM）
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

CREATE TABLE IF NOT EXISTS subtask (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '子任务ID',
  task_id      VARCHAR(32)     NOT NULL COMMENT '所属任务ID',
  workspace_id VARCHAR(32)     NOT NULL COMMENT '归属空间ID',
  title        VARCHAR(60)     NOT NULL COMMENT '子任务内容',
  done         TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '是否完成',
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  KEY idx_task (task_id, id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '子任务（检查清单）';

CREATE TABLE IF NOT EXISTS board_column (
  id           VARCHAR(16) NOT NULL COMMENT '列ID',
  workspace_id VARCHAR(32) NOT NULL COMMENT '归属空间ID',
  name         VARCHAR(12) NOT NULL COMMENT '列名',
  color        VARCHAR(16) NOT NULL DEFAULT '#8a8578' COMMENT '列颜色',
  sort_order   INT         NOT NULL DEFAULT 0 COMMENT '排序',
  created_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (workspace_id, id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '看板列配置（每个空间一套）';

-- 内置列由服务在每个空间创建时自动种入（backlog/doing），此处不预置

CREATE TABLE IF NOT EXISTS tag (
  id           VARCHAR(32) NOT NULL COMMENT '标签ID',
  workspace_id VARCHAR(32) NOT NULL COMMENT '归属空间ID',
  name         VARCHAR(16) NOT NULL COMMENT '标签名',
  created_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_ws_name (workspace_id, name)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '标签（按空间唯一）';

CREATE TABLE IF NOT EXISTS task_tag (
  task_id      VARCHAR(32) NOT NULL COMMENT '任务ID',
  tag_id       VARCHAR(32) NOT NULL COMMENT '标签ID',
  workspace_id VARCHAR(32) NOT NULL COMMENT '归属空间ID',
  PRIMARY KEY (task_id, tag_id),
  KEY idx_tag (tag_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '任务-标签关联';

-- 保存的筛选视图（个人偏好：按 人+空间 各一套）
CREATE TABLE IF NOT EXISTS saved_view (
  id           VARCHAR(32)  NOT NULL COMMENT '视图ID',
  user_id      VARCHAR(32)  NOT NULL COMMENT '归属用户ID',
  workspace_id VARCHAR(32)  NOT NULL COMMENT '归属空间ID',
  name         VARCHAR(20)  NOT NULL COMMENT '视图名称',
  params       VARCHAR(600) NOT NULL COMMENT '筛选参数 JSON',
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (id),
  KEY idx_user_ws (user_id, workspace_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '保存的筛选视图';

CREATE TABLE IF NOT EXISTS attachment (
  id           VARCHAR(32)  NOT NULL COMMENT '附件ID',
  task_id      VARCHAR(32)  NOT NULL COMMENT '所属任务ID',
  workspace_id VARCHAR(32)  NOT NULL COMMENT '归属空间ID',
  filename     VARCHAR(120) NOT NULL COMMENT '原始文件名',
  content_type VARCHAR(64)  DEFAULT NULL COMMENT 'MIME 类型',
  size         BIGINT       NOT NULL DEFAULT 0 COMMENT '字节数',
  stored_name  VARCHAR(64)  NOT NULL COMMENT '磁盘文件名',
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '上传时间',
  PRIMARY KEY (id),
  KEY idx_task (task_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '任务附件';

CREATE TABLE IF NOT EXISTS time_log (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '记录ID',
  task_id      VARCHAR(32)     NOT NULL COMMENT '任务ID',
  workspace_id VARCHAR(32)     NOT NULL COMMENT '归属空间ID',
  user_id      VARCHAR(32)     NOT NULL DEFAULT '' COMMENT '计时人（个人计时）',
  started_at   DATETIME        NOT NULL COMMENT '开始时间',
  ended_at     DATETIME        DEFAULT NULL COMMENT '结束时间',
  minutes      INT             DEFAULT NULL COMMENT '时长（分钟）',
  PRIMARY KEY (id),
  KEY idx_task (task_id, ended_at),
  KEY idx_ws (workspace_id, ended_at),
  KEY idx_user_timer (user_id, ended_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '工时记录';

-- 空间邀请链接（空间主生成，凭链接注册新账号或登录后加入共享空间；7 天有效）
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

-- 任务完成快照（月度统计用）：任务完成那一刻落一条，之后改名 / 改项目 / 删除都不影响历史统计
CREATE TABLE IF NOT EXISTS task_completion_record (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '记录ID',
  workspace_id     VARCHAR(32)     NOT NULL COMMENT '归属空间ID',
  task_id          VARCHAR(32)     NOT NULL COMMENT '任务ID（任务删除后仍保留）',
  title            VARCHAR(60)     NOT NULL COMMENT '任务名称（完成时快照）',
  description      VARCHAR(200)    DEFAULT NULL COMMENT '任务详情（完成时快照）',
  req_id           VARCHAR(32)     DEFAULT NULL COMMENT '归属项目ID',
  req_name         VARCHAR(60)     DEFAULT NULL COMMENT '归属项目名称（冗余，防改名失真）',
  req_doc_id       VARCHAR(32)     DEFAULT NULL COMMENT '关联需求ID（requirement_doc）',
  req_doc_title    VARCHAR(100)    DEFAULT NULL COMMENT '需求名称（完成时快照）',
  owner            VARCHAR(32)     DEFAULT NULL COMMENT '负责人（完成时快照）',
  owner_user_id    VARCHAR(32)     DEFAULT NULL COMMENT '负责人账号ID',
  category         VARCHAR(16)     DEFAULT NULL COMMENT '分类',
  priority         VARCHAR(3)      DEFAULT NULL COMMENT '优先级 P0-P3',
  start_date       DATE            DEFAULT NULL COMMENT '任务开始日期',
  completed_at     DATE            NOT NULL COMMENT '完成日期',
  first_started_at DATETIME        DEFAULT NULL COMMENT '首次计时开始时间',
  last_ended_at    DATETIME        DEFAULT NULL COMMENT '最后一次计时结束时间',
  total_minutes    INT             NOT NULL DEFAULT 0 COMMENT '总耗时（分钟，每天 8h / 跳过周末）',
  created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '归档时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_ws_task (workspace_id, task_id),
  KEY idx_ws_completed (workspace_id, completed_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '任务完成快照（月度统计用）';

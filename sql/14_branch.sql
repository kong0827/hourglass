-- ============================================================================
-- 工作台 · 「分支」模块（2026-10-26）
--
-- 背景：开发过程中一条分支从拉出来到发布要跨好几天，中间「开发中 → 待测试 →
--       待合并 → 已发布」的每一步都得有人盯着。原来只能靠任务清单猜，缺一个
--       能看「这条分支卡在哪一步、卡了多久、上线了没」的地方。
--
-- 设计：
--   · dev_branch 是**空间级**的分支池（一个空间一个列表，不绑项目）——
--     同一份代码里往往主干、发布、feature 混着来，按项目切反而更乱；
--   · 四个状态时间点各存一列（dev_at / test_at / merge_at / released_at），
--     记的是**首次进入**该状态的时间，用来算「多久发布」「卡在待测试几天」；
--   · dev_branch_log 记每一次状态变更（谁、从哪到哪、什么时候），
--     详情页的时间线由它渲染；时间点列负责快速统计，日志负责追溯；
--   · task.branch_id 让任务挂到具体分支上，删分支时把任务解绑（任务本身保留）。
--
-- 设计原则：纯增量、幂等、向后兼容。
--   · 新表 CREATE TABLE IF NOT EXISTS；
--   · task 只 ADD COLUMN（branch_id），老数据为 NULL，行为与升级前一致。
--
-- 执行：mysql -u devstudio -p devstudio < sql/14_branch.sql
-- ============================================================================

USE devstudio;

CREATE TABLE IF NOT EXISTS dev_branch (
  id            VARCHAR(32)  NOT NULL COMMENT '分支ID',
  workspace_id  VARCHAR(32)  NOT NULL COMMENT '归属空间ID',
  name          VARCHAR(80)  NOT NULL COMMENT '分支名（如 feature/login，允许 / . - _ 等字符）',
  status        VARCHAR(16)  NOT NULL DEFAULT 'dev' COMMENT '状态：dev=开发中 / testing=待测试 / merging=待合并 / released=已发布',
  owner         VARCHAR(32)  DEFAULT NULL COMMENT '负责人显示名',
  owner_user_id VARCHAR(32)  DEFAULT NULL COMMENT '负责人账号ID',
  target_branch VARCHAR(80)  DEFAULT NULL COMMENT '目标分支（要合到哪，如 main / release/1.2）',
  note          VARCHAR(200) DEFAULT NULL COMMENT '备注',
  dev_at        DATETIME     DEFAULT NULL COMMENT '进入「开发中」的时间',
  test_at       DATETIME     DEFAULT NULL COMMENT '进入「待测试」的时间',
  merge_at      DATETIME     DEFAULT NULL COMMENT '进入「待合并」的时间',
  released_at   DATETIME     DEFAULT NULL COMMENT '进入「已发布」的时间（发布周期 = released_at - created_at）',
  sort_order    INT          NOT NULL DEFAULT 0 COMMENT '同状态内的排序',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_ws_name (workspace_id, name),
  KEY idx_ws_status (workspace_id, status),
  KEY idx_ws_updated (workspace_id, updated_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '分支（空间级分支池）';

CREATE TABLE IF NOT EXISTS dev_branch_log (
  id            VARCHAR(32)  NOT NULL COMMENT '日志ID',
  workspace_id  VARCHAR(32)  NOT NULL COMMENT '归属空间ID',
  branch_id     VARCHAR(32)  NOT NULL COMMENT '分支ID',
  action        VARCHAR(16)  NOT NULL COMMENT '动作：create / status / update',
  from_status   VARCHAR(16)  DEFAULT NULL COMMENT '变更前状态（create 时为空）',
  to_status     VARCHAR(16)  DEFAULT NULL COMMENT '变更后状态',
  detail        VARCHAR(200) DEFAULT NULL COMMENT '补充说明（状态备注 / 改了哪些字段）',
  actor_name    VARCHAR(32)  DEFAULT NULL COMMENT '操作人显示名',
  actor_user_id VARCHAR(32)  DEFAULT NULL COMMENT '操作人账号ID',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
  PRIMARY KEY (id),
  KEY idx_branch (branch_id, created_at),
  KEY idx_ws (workspace_id, created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '分支状态变更记录（时间线）';

-- ---------------------------------------------------------------------------
-- task：关联分支
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'branch_id');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD COLUMN branch_id VARCHAR(32) DEFAULT NULL COMMENT ''关联分支ID（dev_branch）'' AFTER req_doc_id',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND INDEX_NAME = 'idx_branch');
SET @s := IF(@x = 0, 'ALTER TABLE task ADD KEY idx_branch (branch_id)', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 自检：应看到两张新表 + task.branch_id 列
-- ---------------------------------------------------------------------------
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME IN ('req_doc_id', 'branch_id');

SELECT TABLE_NAME FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('dev_branch', 'dev_branch_log');

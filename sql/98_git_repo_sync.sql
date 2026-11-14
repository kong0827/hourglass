USE hourglass;
-- 执行时请带 --default-character-set=utf8mb4，否则列注释中的中文会写成乱码。

-- 项目多仓库 Git 只读同步：仓库绑定、远程分支事实、生命周期判定与待确认队列。
-- 本脚本只增结构、可重复执行；不删除既有分支、不回填历史提交事实。

-- ---------------------------------------------------------------------------
-- 1. 项目仓库绑定
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `project_repo` (
  `id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '仓库绑定ID',
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `req_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属项目ID（requirement.id）',
  `name` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '仓库显示名',
  `provider` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'gitlab' COMMENT '仓库服务：gitlab',
  `repo_url` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'GitLab 站点地址（如 https://gitlab.example.com）',
  `project_ref` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'GitLab 项目标识：数字ID 或 group/project 路径',
  `default_target` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '默认目标分支（同步时排除，不导入）',
  `token_cipher` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '访问令牌密文（AES-GCM，复用 AiCrypto）',
  `import_policy` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'recent90' COMMENT '首次导入策略：recent90 / all / manual',
  `sync_enabled` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否参与定时同步',
  `last_sync_at` datetime DEFAULT NULL COMMENT '最近一次同步开始时间',
  `last_sync_status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '最近同步结果：ok / error',
  `last_sync_error` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '最近同步失败原因（不含令牌）',
  `last_sync_summary` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '最近同步摘要（分支/合并/待确认数量）',
  `created_by` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '绑定人账号ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ws_repo` (`workspace_id`,`repo_url`,`project_ref`),
  KEY `idx_ws_req` (`workspace_id`,`req_id`),
  KEY `idx_ws_sync` (`workspace_id`,`sync_enabled`,`last_sync_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目仓库绑定（GitLab 只读同步）';

-- repo_url 是 GitLab 站点地址，project_ref 才标识具体仓库；旧键只按站点唯一会挡住同站多仓库。
-- 已有安装先加新键再加旧键删除，保证脚本中途失败也不会失去唯一约束。
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `project_repo` ADD UNIQUE KEY `uk_ws_repo` (`workspace_id`,`repo_url`,`project_ref`)',
  'DO 0') FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'project_repo' AND index_name = 'uk_ws_repo');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) > 0,
  'ALTER TABLE `project_repo` DROP KEY `uk_ws_repo_url`',
  'DO 0') FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'project_repo' AND index_name = 'uk_ws_repo_url');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 2. dev_branch：远程事实、生命周期与人工判定列
-- ---------------------------------------------------------------------------
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `dev_branch` ADD COLUMN `repo_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''来源仓库ID（project_repo.id），空=手工/空间级'' AFTER `req_id`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dev_branch' AND column_name = 'repo_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `dev_branch` ADD COLUMN `source` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''manual'' COMMENT ''来源：manual 手工 / git 同步'' AFTER `repo_id`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dev_branch' AND column_name = 'source');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `dev_branch` ADD COLUMN `remote_state` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''远程状态：active 存在 / deleted 已删除；人工分支为空'' AFTER `note`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dev_branch' AND column_name = 'remote_state');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `dev_branch` ADD COLUMN `remote_head_sha` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''远程 HEAD 提交 SHA'' AFTER `remote_state`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dev_branch' AND column_name = 'remote_head_sha');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `dev_branch` ADD COLUMN `remote_head_at` datetime DEFAULT NULL COMMENT ''远程 HEAD 提交时间'' AFTER `remote_head_sha`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dev_branch' AND column_name = 'remote_head_at');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `dev_branch` ADD COLUMN `remote_head_author` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''远程 HEAD 提交作者'' AFTER `remote_head_at`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dev_branch' AND column_name = 'remote_head_author');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `dev_branch` ADD COLUMN `last_seen_at` datetime DEFAULT NULL COMMENT ''最近一次在远程列表中看到的时间'' AFTER `remote_head_author`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dev_branch' AND column_name = 'last_seen_at');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `dev_branch` ADD COLUMN `last_seen_head_sha` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''最近一次看到时的 HEAD SHA（改名识别用）'' AFTER `last_seen_at`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dev_branch' AND column_name = 'last_seen_head_sha');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `dev_branch` ADD COLUMN `merged` tinyint(1) NOT NULL DEFAULT ''0'' COMMENT ''是否有已合并 MR 证据'' AFTER `last_seen_head_sha`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dev_branch' AND column_name = 'merged');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `dev_branch` ADD COLUMN `merged_into` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''合并目标分支'' AFTER `merged`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dev_branch' AND column_name = 'merged_into');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `dev_branch` ADD COLUMN `merged_at` datetime DEFAULT NULL COMMENT ''合并时间'' AFTER `merged_into`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dev_branch' AND column_name = 'merged_at');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `dev_branch` ADD COLUMN `merge_evidence` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''合并证据（MR 编号/目标/链接摘要）'' AFTER `merged_at`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dev_branch' AND column_name = 'merge_evidence');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `dev_branch` ADD COLUMN `decision` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''人工判定：done / canceled / ignored；空=未判定'' AFTER `merge_evidence`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dev_branch' AND column_name = 'decision');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `dev_branch` ADD COLUMN `decision_reason` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''人工判定理由（取消/忽略必填，≤32 字）'' AFTER `decision`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dev_branch' AND column_name = 'decision_reason');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `dev_branch` ADD COLUMN `decision_note` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''人工判定备注'' AFTER `decision_reason`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dev_branch' AND column_name = 'decision_note');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `dev_branch` ADD COLUMN `decided_by_user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''判定人账号ID'' AFTER `decision_note`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dev_branch' AND column_name = 'decided_by_user_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `dev_branch` ADD COLUMN `decided_at` datetime DEFAULT NULL COMMENT ''判定时间'' AFTER `decided_by_user_id`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dev_branch' AND column_name = 'decided_at');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `dev_branch` ADD COLUMN `outcome` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''open'' COMMENT ''生命周期：open / done / canceled / ignored / pending'' AFTER `decided_at`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dev_branch' AND column_name = 'outcome');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `dev_branch` ADD COLUMN `pending_reason` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''待确认原因：disappeared / closed_new_commit / name_conflict'' AFTER `outcome`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dev_branch' AND column_name = 'pending_reason');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `dev_branch` ADD COLUMN `sync_status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''最近同步状态：ok / error'' AFTER `pending_reason`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dev_branch' AND column_name = 'sync_status');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `dev_branch` ADD COLUMN `sync_error` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''最近同步失败原因'' AFTER `sync_status`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dev_branch' AND column_name = 'sync_error');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- owner_key：仓库分支按 repo 隔离，手工分支按项目隔离（空项目归到空间级）
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `dev_branch` ADD COLUMN `owner_key` varchar(96) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci GENERATED ALWAYS AS (ifnull(`repo_id`, concat(''m:'', ifnull(`req_id`, ''''))) ) STORED COMMENT ''唯一性归一化：仓库分支用 repo_id，手工分支用 m:req_id'' AFTER `sync_error`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dev_branch' AND column_name = 'owner_key');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 旧唯一键 (workspace_id, req_id, name) 对 NULL 项目不约束，可能已有同名空间级手工分支；
-- 加新唯一键前按 ID 确定性改名，保证脚本可重复执行且不丢分支。
UPDATE `dev_branch` b
JOIN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY workspace_id, owner_key, name ORDER BY id) AS rn
    FROM `dev_branch`
  ) ranked WHERE ranked.rn > 1
) dup ON dup.id = b.id
SET b.name = CONCAT(LEFT(b.name, 42), '-dup-', b.id);

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `dev_branch` ADD UNIQUE KEY `uk_ws_owner_name` (`workspace_id`,`owner_key`,`name`)',
  'DO 0') FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'dev_branch' AND index_name = 'uk_ws_owner_name');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) > 0,
  'ALTER TABLE `dev_branch` DROP KEY `uk_ws_req_name`',
  'DO 0') FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'dev_branch' AND index_name = 'uk_ws_req_name');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `dev_branch` ADD KEY `idx_ws_outcome` (`workspace_id`,`outcome`)',
  'DO 0') FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'dev_branch' AND index_name = 'idx_ws_outcome');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `dev_branch` ADD KEY `idx_ws_repo_state` (`workspace_id`,`repo_id`,`remote_state`)',
  'DO 0') FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'dev_branch' AND index_name = 'idx_ws_repo_state');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 3. 分支改名记录
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dev_branch_alias` (
  `id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '改名记录ID',
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `repo_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '来源仓库ID',
  `branch_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分支ID（改名后）',
  `old_name` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '旧分支名',
  `new_name` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '新分支名',
  `detected_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '识别时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ws_repo_old_name` (`workspace_id`,`repo_id`,`old_name`),
  KEY `idx_alias_branch` (`branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='分支改名识别记录';

-- ---------------------------------------------------------------------------
-- 4. 时间线：区分人工操作与系统同步
-- ---------------------------------------------------------------------------
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `dev_branch_log` ADD COLUMN `actor_type` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''user'' COMMENT ''操作来源：user 人工 / system 同步'' AFTER `actor_user_id`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'dev_branch_log' AND column_name = 'actor_type');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 120 周五补记：按人按周保存补记会话、逐条决策、工时归属与可撤销写入
-- 说明：补记只追加「确认记录」与「工时归属」，不自动改工作项状态；
-- 提交后 5 分钟内可撤销，撤销依据 catchup_write 精确回滚本次写入。

CREATE TABLE IF NOT EXISTS `catchup_session` (
  `id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '会话ID',
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '补记人',
  `week_start` date NOT NULL COMMENT '本周周一（自然日）',
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft' COMMENT 'draft 草稿 / submitted 已提交 / skipped 本周跳过',
  `started_at` datetime DEFAULT NULL COMMENT '开始补记时间（计时起点）',
  `submitted_at` datetime DEFAULT NULL COMMENT '提交时间（撤销窗口起点）',
  `undone_at` datetime DEFAULT NULL COMMENT '最近一次撤销时间',
  `elapsed_seconds` int NOT NULL DEFAULT '0' COMMENT '本次补记用时（秒，提交时结算）',
  `no_other_risk` tinyint(1) NOT NULL DEFAULT '0' COMMENT '已确认本周无其他已知风险',
  `review_json` text COMMENT '提交时的周回顾快照',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_catchup_week` (`workspace_id`,`user_id`,`week_start`),
  KEY `idx_catchup_user_week` (`user_id`,`week_start`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='周五补记会话';

CREATE TABLE IF NOT EXISTS `catchup_decision` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `session_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '会话ID（catchup_session.id）',
  `draft_key` varchar(96) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '草稿键：task:<id> / risk:<kind>:<id>',
  `kind` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'work 工作项 / risk 风险',
  `action` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'accept/skip/merge/edit/answer/confirm/record/ignore/unblock/link',
  `answer` varchar(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '低置信回答或编辑后的状态',
  `title` varchar(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '编辑后的标题快照',
  `payload_json` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '附加说明（备注等）',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_catchup_decision` (`session_id`,`draft_key`),
  KEY `idx_catchup_decision_session` (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='周五补记逐条决策';

CREATE TABLE IF NOT EXISTS `catchup_time_alloc` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `session_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '会话ID',
  `row_key` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属行：req:<项目ID> / unassigned',
  `day` date NOT NULL COMMENT '归属自然日',
  `req_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '项目ID；空=内部/其他',
  `minutes` int NOT NULL DEFAULT '0' COMMENT '归属分钟数',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_catchup_alloc` (`session_id`,`row_key`,`day`),
  KEY `idx_catchup_alloc_session` (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='周五补记工时归属';

CREATE TABLE IF NOT EXISTS `catchup_write` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `session_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '会话ID',
  `write_type` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'task_log 时间线 / blocked 阻塞字段 / time_alloc 工时归属',
  `ref_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '写入对象ID（task_log.id / task.id / catchup_time_alloc.id）',
  `prev_json` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '写前快照（撤销用）',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_catchup_write_session` (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='周五补记可撤销写入台账';

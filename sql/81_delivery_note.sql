-- 一页式交付说明：把版本承诺、实际发布、变更、质量、投入与验收收成一页对外说明。
-- 三张表分工：delivery_note 只存「人写的部分 + 记忆下来的生成控制」，
-- delivery_note_snapshot 存导出瞬间的完整不可变聚合，delivery_note_share 是快照级只读令牌。
-- 数字一律实时来自版本/发布/测试/工时记录，本脚本不回填、不构造历史交付证据。
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/81_delivery_note.sql

USE hourglass;

CREATE TABLE IF NOT EXISTS `delivery_note` (
  `workspace_id` varchar(32) NOT NULL,
  `version_id` varchar(32) NOT NULL,
  `req_id` varchar(32) NOT NULL,
  `audience` varchar(120) DEFAULT NULL COMMENT '交付对象（客户/验收方），首次确认后按版本记忆',
  `support_contact` varchar(200) DEFAULT NULL COMMENT '对外支持联系方式',
  `options` json DEFAULT NULL COMMENT '生成控制：语气/范围/粒度/证据密度/排版，一次配置全员受益',
  `narratives` json DEFAULT NULL COMMENT '人工改写的叙述文字，key=区块字段',
  `confirmed` json DEFAULT NULL COMMENT '已确认的待确认项 key 列表',
  `acceptance` varchar(1000) DEFAULT NULL COMMENT '验收结论补充说明（人工填写，选填）',
  `updated_by` varchar(32) DEFAULT NULL,
  `revision` bigint NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`workspace_id`, `version_id`),
  KEY `idx_ws_req` (`workspace_id`, `req_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='交付说明草稿与生成控制（按版本记忆）';

CREATE TABLE IF NOT EXISTS `delivery_note_snapshot` (
  `id` varchar(32) NOT NULL,
  `workspace_id` varchar(32) NOT NULL,
  `version_id` varchar(32) NOT NULL,
  `req_id` varchar(32) NOT NULL,
  `release_id` varchar(32) DEFAULT NULL COMMENT '取哪条发布记录；空=未确认发布的内部草稿',
  `seq` int NOT NULL COMMENT '同一版本内第几次导出，从 1 起',
  `doc_no` varchar(40) NOT NULL COMMENT '对外编号 DS-YYYYMMDD-NN',
  `tone` varchar(16) NOT NULL COMMENT 'customer / manager / internal',
  `title` varchar(200) NOT NULL,
  `payload` mediumtext NOT NULL COMMENT '导出瞬间的完整聚合 JSON，之后系统变化不影响它',
  `content_hash` char(64) NOT NULL COMMENT 'payload 的 SHA-256，用于校验快照未被篡改',
  `created_by` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(80) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ws_version_seq` (`workspace_id`, `version_id`, `seq`),
  KEY `idx_ws_req` (`workspace_id`, `req_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='交付说明不可变快照';

CREATE TABLE IF NOT EXISTS `delivery_note_share` (
  `workspace_id` varchar(32) NOT NULL,
  `snapshot_id` varchar(32) NOT NULL,
  `token` varchar(32) NOT NULL,
  `allow_download` tinyint(1) NOT NULL DEFAULT '1' COMMENT '接收人是否可下载 PDF',
  `view_count` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` datetime DEFAULT NULL COMMENT '空=长期有效',
  PRIMARY KEY (`workspace_id`, `snapshot_id`),
  UNIQUE KEY `uk_token` (`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='交付说明快照只读分享';
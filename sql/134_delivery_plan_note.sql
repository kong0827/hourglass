-- ============================================================================
-- 134_delivery_plan_note.sql · 交付说明支持「发布计划」维度（2026-11-28）
--
-- 背景：交付说明原先只能按单个版本生成。一个发布计划可以跨项目、跨版本，
--       对外交付时常需要一份覆盖整个计划的说明，而不是逐版本各发一份。
-- 做法：
--   1) delivery_note_plan：计划维度的人工层（语气/叙述/确认/交付对象），
--      数字仍实时从各版本聚合，不落事实表的拷贝；
--   2) delivery_note_snapshot 增加 scope_type / scope_id / scope_name，
--      把「版本快照」与「计划快照」收敛到同一条快照/分享管线；
--      存量行回填为 scope_type='version'、scope_id=version_id。
--   3) 唯一键由 (workspace, version, seq) 改为 (workspace, scope_type, scope_id, seq)；
--      version_id 允许为空，仅计划快照为 NULL。
-- 幂等：可重复执行；列已存在、索引已是新键时跳过。
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/134_delivery_plan_note.sql
-- ============================================================================

USE hourglass;

CREATE TABLE IF NOT EXISTS `delivery_note_plan` (
  `workspace_id` varchar(32) NOT NULL,
  `plan_id` varchar(32) NOT NULL,
  `audience` varchar(120) DEFAULT NULL COMMENT '交付对象（客户/验收方）',
  `support_contact` varchar(200) DEFAULT NULL COMMENT '对外支持联系方式',
  `options` json DEFAULT NULL COMMENT '生成控制：语气/范围/证据密度/排版',
  `narratives` json DEFAULT NULL COMMENT '人工改写的叙述文字，key=区块字段',
  `confirmed` json DEFAULT NULL COMMENT '已确认的待确认项 key 列表',
  `acceptance` varchar(1000) DEFAULT NULL COMMENT '验收结论补充说明（人工填写，选填）',
  `updated_by` varchar(32) DEFAULT NULL,
  `revision` bigint NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`workspace_id`, `plan_id`),
  KEY `idx_dnp_plan` (`workspace_id`, `plan_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='交付说明草稿与生成控制（按发布计划记忆）';

DROP PROCEDURE IF EXISTS hg_delivery_plan_note;
DELIMITER $$
CREATE PROCEDURE hg_delivery_plan_note()
BEGIN
  DECLARE col_count INT DEFAULT 0;
  DECLARE idx_count INT DEFAULT 0;

  SELECT COUNT(*) INTO col_count FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'delivery_note_snapshot' AND column_name = 'scope_type';
  IF col_count = 0 THEN
    ALTER TABLE `delivery_note_snapshot`
      ADD COLUMN `scope_type` varchar(16) NOT NULL DEFAULT 'version' COMMENT 'version / plan' AFTER `workspace_id`,
      ADD COLUMN `scope_id` varchar(32) NULL COMMENT '版本ID或计划ID，与 scope_type 成对' AFTER `scope_type`,
      ADD COLUMN `scope_name` varchar(200) NULL COMMENT '冻结时的范围名称，便于列表与审计' AFTER `scope_id`;
  END IF;

  UPDATE `delivery_note_snapshot`
     SET `scope_type` = 'version'
   WHERE `scope_type` IS NULL OR `scope_type` = '';

  UPDATE `delivery_note_snapshot`
     SET `scope_id` = `version_id`
   WHERE `scope_id` IS NULL;

  SELECT COUNT(*) INTO col_count FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'delivery_note_snapshot'
     AND column_name = 'scope_id' AND is_nullable = 'YES';
  IF col_count > 0 THEN
    ALTER TABLE `delivery_note_snapshot` MODIFY `scope_id` varchar(32) NOT NULL;
  END IF;

  SELECT COUNT(*) INTO col_count FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'delivery_note_snapshot'
     AND column_name = 'version_id' AND is_nullable = 'NO';
  IF col_count > 0 THEN
    ALTER TABLE `delivery_note_snapshot` MODIFY `version_id` varchar(32) DEFAULT NULL;
  END IF;

  /* 计划快照不归属单个项目与版本，req_id 同样要允许为空 */
  SELECT COUNT(*) INTO col_count FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'delivery_note_snapshot'
     AND column_name = 'req_id' AND is_nullable = 'NO';
  IF col_count > 0 THEN
    ALTER TABLE `delivery_note_snapshot` MODIFY `req_id` varchar(32) DEFAULT NULL;
  END IF;

  SELECT COUNT(*) INTO idx_count FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'delivery_note_snapshot' AND index_name = 'uk_ws_scope_seq';
  IF idx_count = 0 THEN
    SELECT COUNT(*) INTO idx_count FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = 'delivery_note_snapshot' AND index_name = 'uk_ws_version_seq';
    IF idx_count > 0 THEN
      ALTER TABLE `delivery_note_snapshot` DROP INDEX `uk_ws_version_seq`;
    END IF;
    ALTER TABLE `delivery_note_snapshot`
      ADD UNIQUE KEY `uk_ws_scope_seq` (`workspace_id`, `scope_type`, `scope_id`, `seq`);
  END IF;

  SELECT COUNT(*) INTO idx_count FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'delivery_note_snapshot'
     AND index_name = 'idx_ws_scope' AND column_name = 'scope_type';
  IF idx_count = 0 THEN
    ALTER TABLE `delivery_note_snapshot` ADD KEY `idx_ws_scope` (`workspace_id`, `scope_type`, `scope_id`, `created_at`);
  END IF;
END$$
DELIMITER ;

CALL hg_delivery_plan_note();
DROP PROCEDURE hg_delivery_plan_note;

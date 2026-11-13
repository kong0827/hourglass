-- ============================================================================
-- 72_demand_closed_delivery_stage.sql · 需求四主状态与关闭归档（2026-11-13）
--
-- review / pass / plan / closed 为四个主状态；rej 与 canceled 合并为 closed。
-- close_reason 保留评审不通过、中途取消、重复需求；close_stage 决定恢复去向。
-- 已完成、已交付仍是证据派生阶段，不写需求主状态。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/72_demand_closed_delivery_stage.sql
-- 可重复执行；历史状态回填只处理尚未迁移的 rej / canceled。
-- ============================================================================

USE hourglass;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `demand` ADD COLUMN `close_reason` varchar(16) DEFAULT NULL COMMENT ''关闭原因：rej评审不通过/cancel中途取消/dup重复需求'' AFTER `status`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demand' AND COLUMN_NAME = 'close_reason');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `demand` ADD COLUMN `close_stage` varchar(16) DEFAULT NULL COMMENT ''关闭前主状态：review/pass/plan'' AFTER `close_reason`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'demand' AND COLUMN_NAME = 'close_stage');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

UPDATE `demand`
SET close_reason = 'rej', close_stage = 'review', status = 'closed'
WHERE status = 'rej';

UPDATE `demand` d
SET close_reason = 'cancel',
    close_stage = COALESCE((
      SELECT CASE
               WHEN dl.action IN ('plan', 'replan') THEN 'plan'
               WHEN dl.action = 'pass' THEN 'pass'
               ELSE 'review'
             END
      FROM `demand_log` dl
      WHERE dl.workspace_id = d.workspace_id AND dl.demand_id = d.id
        AND dl.action IN ('plan', 'replan', 'pass', 'unpass', 'reopen')
      ORDER BY dl.created_at DESC, dl.id DESC LIMIT 1
    ), CASE WHEN d.version_id IS NOT NULL OR d.planned_start IS NOT NULL OR d.planned_end IS NOT NULL
            THEN 'plan' ELSE 'review' END),
    status = 'closed'
WHERE d.status = 'canceled';

ALTER TABLE `demand`
  MODIFY COLUMN `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'review'
  COMMENT '状态机：review待评审/pass已通过/plan已排期/closed已关闭';

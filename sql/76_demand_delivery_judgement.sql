-- ============================================================================
-- 76_demand_delivery_judgement.sql · 需求人工交付判定（2026-11-13）
--
-- 交付阶段仍由工作项、用例与发布证据派生；人工判定只用于补录缺失证据，
-- 不覆盖 demand 派生字段。每条判定独立留痕，撤销后保留历史。
-- 每个需求同一时刻最多一条生效记录：active_demand_id 生成列 + 唯一键保证。
-- 真实发布证据优先于人工判定，判定不改变任何发布记录。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/76_demand_delivery_judgement.sql
-- 可重复执行；只建表，不回填、不推断历史判定。
-- ============================================================================

USE hourglass;

CREATE TABLE IF NOT EXISTS `demand_delivery_judgement` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '人工判定记录ID',
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `demand_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '需求ID（demand.id）',
  `version_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '判定时的目标版本快照；需求换版本后旧判定不再生效',
  `judged_stage` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '人工判定阶段：donePending已完成待发布/delivered已交付',
  `effective_on` date NOT NULL COMMENT '判定生效日期；已交付时作为实际交付日期',
  `judge_reason` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '人工判定原因',
  `judged_by_user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '判定人账号ID',
  `judged_by_name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '判定人名称快照',
  `judged_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '判定时间',
  `revoked_at` datetime(6) DEFAULT NULL COMMENT '撤销时间；为空表示当前生效',
  `revoked_by_user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '撤销人账号ID',
  `revoked_by_name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '撤销人名称快照',
  `revoke_reason` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '撤销原因',
  `active_demand_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    GENERATED ALWAYS AS (CASE WHEN `revoked_at` IS NULL THEN `demand_id` ELSE NULL END) STORED
    COMMENT '生效判定归一化键；撤销后为NULL',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_demand_active_judgement` (`workspace_id`,`active_demand_id`),
  KEY `idx_demand_judgement_history` (`workspace_id`,`demand_id`,`judged_at`,`id`),
  CONSTRAINT `chk_demand_judgement_stage`
    CHECK (`judged_stage` IN ('donePending','delivered')),
  CONSTRAINT `chk_demand_judgement_revoke`
    CHECK (
      (`revoked_at` IS NULL AND `revoked_by_user_id` IS NULL
        AND `revoked_by_name` IS NULL AND `revoke_reason` IS NULL)
      OR
      (`revoked_at` IS NOT NULL AND `revoked_by_user_id` IS NOT NULL
        AND `revoked_by_name` IS NOT NULL AND `revoke_reason` IS NOT NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='需求人工交付判定（追加式，撤销后保留历史）';

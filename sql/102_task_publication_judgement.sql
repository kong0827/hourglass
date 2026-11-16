-- ============================================================================
-- 102_task_publication_judgement.sql · 工作项历史发布人工标记（2026-11-16）
--
-- 工作项「已发布」仍由正式生产发布记录派生；本表只用于补录从其他系统迁移过来、
-- 没有发布记录的历史事实，仅影响工作项徽标与「发布态」筛选，不写入版本发布记录，
-- 不改变 publicationState，也不参与需求交付阶段派生、交付说明与版本统计。
-- 每条标记追加留痕，撤销后保留历史；每个工作项同一时刻最多一条生效记录，
-- 由 active_task_id 生成列 + 唯一键保证。撤销后回落为「未发布」。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/102_task_publication_judgement.sql
-- 可重复执行；只建表，不回填、不推断历史标记。
-- ============================================================================

USE hourglass;

CREATE TABLE IF NOT EXISTS `task_publication_judgement` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '人工标记记录ID',
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `task_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '工作项ID（task.id）',
  `judged_state` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '人工标记状态：published已发布',
  `effective_on` date NOT NULL COMMENT '标记生效日期；历史迁移时填写实际发布时间',
  `judge_reason` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '人工标记原因（迁移来源、无发布记录说明）',
  `judged_by_user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '标记人账号ID',
  `judged_by_name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '标记人名称快照',
  `judged_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '标记时间',
  `revoked_at` datetime(6) DEFAULT NULL COMMENT '撤销时间；为空表示当前生效',
  `revoked_by_user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '撤销人账号ID',
  `revoked_by_name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '撤销人名称快照',
  `revoke_reason` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '撤销原因',
  `active_task_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    GENERATED ALWAYS AS (CASE WHEN `revoked_at` IS NULL THEN `task_id` ELSE NULL END) STORED
    COMMENT '生效标记归一化键；撤销后为NULL',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_task_active_judgement` (`workspace_id`,`active_task_id`),
  KEY `idx_task_judgement_history` (`workspace_id`,`task_id`,`judged_at`,`id`),
  CONSTRAINT `chk_task_judgement_state`
    CHECK (`judged_state` IN ('published')),
  CONSTRAINT `chk_task_judgement_revoke`
    CHECK (
      (`revoked_at` IS NULL AND `revoked_by_user_id` IS NULL
        AND `revoked_by_name` IS NULL AND `revoke_reason` IS NULL)
      OR
      (`revoked_at` IS NOT NULL AND `revoked_by_user_id` IS NOT NULL
        AND `revoked_by_name` IS NOT NULL AND `revoke_reason` IS NOT NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='工作项历史发布人工标记（追加式，撤销后保留历史；不作为生产发布证据）';

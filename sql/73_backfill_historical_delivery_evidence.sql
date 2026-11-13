-- ============================================================================
-- 73_backfill_historical_delivery_evidence.sql · 历史已交付证据补录（2026-11-13）
--
-- 只处理同时满足以下条件的已排期需求：
--   1. 目标版本状态为 released；
--   2. 版本有真实 released_at；
--   3. 需求尚无成功生产发布条目。
-- 不读取 target_date / updated_at 推断实际发布日期，不补造工作项、用例或完成时间。
-- 没有 released_at 的记录不会被推进，执行后的查询结果就是人工补录清单。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/73_backfill_historical_delivery_evidence.sql
-- 可重复执行；执行前建议备份 version_release / version_release_item。
-- ============================================================================

USE hourglass;

-- 每个版本补一条明确标记为历史导入的生产发布记录；执行人使用系统迁移身份，不归到个人。
INSERT INTO `version_release` (
  `id`, `workspace_id`, `req_id`, `version_id`, `plan_id`, `plan_revision`,
  `occurred_at`, `environment`, `target_keys`, `coverage`,
  `artifact_ref`, `artifact_digest`, `operation`, `related_release_id`,
  `executor_user_id`, `executor_name`, `deviation_reason`, `result`, `published_on`,
  `recorded_at`, `released_by`, `released_by_name`, `version_name`, `project_name`,
  `notes`, `failure_reason`, `published_count`, `excluded_count`,
  `idempotency_key`, `request_hash`, `plan_snapshot`
)
SELECT CONCAT('HR', LEFT(MD5(CONCAT(v.workspace_id, ':', v.id)), 30)),
       v.workspace_id, v.req_id, v.id, NULL, NULL,
       v.released_at, 'production', JSON_ARRAY('historical'), 'full',
       'historical-version-release', SHA2(CONCAT(v.workspace_id, ':', v.id, ':', v.released_at), 256),
       'deploy', NULL,
       'system', '历史数据迁移', '依据已发布版本与实际发布时间补录历史证据', 'success', DATE(v.released_at),
       CURRENT_TIMESTAMP(6), 'system', '历史数据迁移', v.name, r.name,
       '历史导入：未补造工作项、用例或完成时间', NULL, 0, 0,
       'historical-version-release-v1', SHA2(CONCAT('historical:', v.workspace_id, ':', v.id), 256),
       JSON_OBJECT('source', 'historical_import', 'versionId', v.id, 'releasedAt', v.released_at)
FROM `project_version` v
INNER JOIN `requirement` r ON r.id = v.req_id AND r.workspace_id = v.workspace_id
WHERE v.status = 'released' AND v.released_at IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM `demand` d
    WHERE d.workspace_id = v.workspace_id AND d.version_id = v.id AND d.status = 'plan'
      AND NOT EXISTS (
        SELECT 1 FROM `version_release_item` ei
        INNER JOIN `version_release` er ON er.workspace_id = ei.workspace_id AND er.id = ei.release_id
        WHERE ei.workspace_id = d.workspace_id AND ei.demand_id = d.id
          AND er.result = 'success' AND er.environment = 'production' AND ei.disposition = 'published'
      )
  )
ON DUPLICATE KEY UPDATE `request_hash` = VALUES(`request_hash`);

-- 发布条目使用独立的历史快照 ID，不指向或虚构 task 表记录；board_column/completed_at 保持空。
INSERT INTO `version_release_item` (
  `workspace_id`, `release_id`, `task_id`, `title`, `item_type`,
  `owner_user_id`, `owner_name`, `demand_id`, `demand_title`,
  `target_version_id`, `target_version_name`, `board_column`, `completed_at`,
  `disposition`, `reason`, `content_summary`, `work_minutes`, `estimate_minutes`
)
SELECT d.workspace_id, CONCAT('HR', LEFT(MD5(CONCAT(v.workspace_id, ':', v.id)), 30)),
       CONCAT('HD', LEFT(MD5(CONCAT(d.workspace_id, ':', d.id)), 30)), LEFT(d.title, 60), 'historical',
       NULL, NULL, d.id, d.title,
       v.id, v.name, NULL, NULL,
       'published', '历史导入：依据已发布版本及实际发布时间补录，未补造工作项或用例',
       LEFT(d.description, 2000), 0, NULL
FROM `demand` d
INNER JOIN `project_version` v ON v.workspace_id = d.workspace_id AND v.id = d.version_id
WHERE d.status = 'plan' AND v.status = 'released' AND v.released_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `version_release_item` ei
    INNER JOIN `version_release` er ON er.workspace_id = ei.workspace_id AND er.id = ei.release_id
    WHERE ei.workspace_id = d.workspace_id AND ei.demand_id = d.id
      AND er.result = 'success' AND er.environment = 'production' AND ei.disposition = 'published'
  )
ON DUPLICATE KEY UPDATE `disposition` = VALUES(`disposition`);

UPDATE `version_release` vr
SET vr.published_count = (
  SELECT COUNT(*) FROM `version_release_item` i
  WHERE i.workspace_id = vr.workspace_id AND i.release_id = vr.id AND i.disposition = 'published'
)
WHERE vr.idempotency_key = 'historical-version-release-v1';

-- 执行后仍需人工处理的清单：版本已发布但缺少实际发布时间。
SELECT d.workspace_id AS `空间ID`, d.id AS `需求ID`, d.title AS `需求标题`,
       d.version_id AS `目标版本ID`, v.name AS `目标版本`, v.status AS `版本状态`,
       v.released_at AS `实际发布时间`,
       '缺少实际发布时间，请补录版本 released_at 后重跑本脚本' AS `待处理原因`
FROM `demand` d
INNER JOIN `project_version` v ON v.workspace_id = d.workspace_id AND v.id = d.version_id
WHERE d.status = 'plan' AND v.status = 'released' AND v.released_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM `version_release_item` i
    INNER JOIN `version_release` vr ON vr.workspace_id = i.workspace_id AND vr.id = i.release_id
    WHERE i.workspace_id = d.workspace_id AND i.demand_id = d.id
      AND vr.result = 'success' AND vr.environment = 'production' AND i.disposition = 'published'
  )
ORDER BY d.workspace_id, d.req_id, d.id;

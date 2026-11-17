-- 108_demand_done_backfill.sql
-- 需求主状态「已完成 done」回填与历史数据修复（数据脚本，不改表结构）。
-- 执行顺序：105（状态机结构）→ 106（项目集拆分）→ 本脚本。
-- 106 会迁移工作项 / 需求的所属项目，并清空拆分需求的 version_id（只留 version_name 快照），
-- 完成证据随之变化，因此在拆分之后统一重算一次，避免历史需求停在「已排期」。
--
-- 判定与 DemandCompletionService.selectCompletionEvidence 完全一致（完成 ≠ 交付）：
--   1) release：存在成功、生产、全量覆盖、非回滚且未被后续回滚按工作项撤销的发布条目；
--   2) manual ：存在生效的人工交付判定，且判定版本与需求当前目标版本一致（双方为空也算一致）；
--   3) derived：至少 1 个未删除工作项且全部处于完成列，关联用例最新一次执行全部通过
--              （需求没有用例视为通过）。
--
-- 修复范围：
--   A. plan 且满足任一证据 → done，追加 demand_log(action='complete')；
--   B. done 但证据已全部失效 → plan，追加 demand_log(action='auto_reopen')。
--      done 只能由完成判定产生（没有人工置 done 入口），因此退回与后端自动退回口径一致；
--   C. done 但缺少 complete 日志（旧脚本只改状态 / 日志写入失败）→ 补一条历史日志。
-- 脚本幂等：状态更新带原状态条件，日志只在同类动作缺失时补写，重复执行不重复改状态。

SET NAMES utf8mb4;

DROP TEMPORARY TABLE IF EXISTS tmp_108_done;
CREATE TEMPORARY TABLE tmp_108_done (
  id varchar(32) NOT NULL,
  workspace_id varchar(32) NOT NULL,
  reason varchar(20) NOT NULL,
  PRIMARY KEY (id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A1) 真实发布证据优先（成功、生产、非回滚、全量覆盖，且未被后续回滚按工作项撤销）
INSERT IGNORE INTO tmp_108_done (id, workspace_id, reason)
SELECT d.id, d.workspace_id, 'release'
FROM demand d
WHERE d.status = 'plan'
  AND EXISTS (
    SELECT 1
    FROM version_release_item i
    INNER JOIN version_release vr
      ON vr.workspace_id = i.workspace_id AND vr.id = i.release_id
    WHERE i.workspace_id = d.workspace_id AND i.demand_id = d.id
      AND i.disposition = 'published'
      AND vr.result = 'success' AND vr.environment = 'production'
      AND vr.operation <> 'rollback' AND vr.coverage = 'full'
      AND NOT EXISTS (
        SELECT 1
        FROM version_release rb
        INNER JOIN version_release_item ri
          ON ri.workspace_id = rb.workspace_id AND ri.release_id = rb.id
        WHERE rb.workspace_id = vr.workspace_id AND rb.related_release_id = vr.id
          AND rb.result = 'success' AND rb.environment = 'production' AND rb.operation = 'rollback'
          AND ri.task_id = i.task_id
          AND (rb.occurred_at > vr.occurred_at
               OR (rb.occurred_at = vr.occurred_at AND rb.recorded_at > vr.recorded_at)
               OR (rb.occurred_at = vr.occurred_at AND rb.recorded_at = vr.recorded_at AND rb.id > vr.id))
      )
  );

-- A2) 人工交付判定（判定版本须与当前目标版本一致）
INSERT IGNORE INTO tmp_108_done (id, workspace_id, reason)
SELECT d.id, d.workspace_id, 'manual'
FROM demand d
INNER JOIN demand_delivery_judgement dj
  ON dj.workspace_id = d.workspace_id AND dj.active_demand_id = d.id
 AND dj.version_id <=> d.version_id
WHERE d.status = 'plan' AND dj.judged_stage = 'delivered';

-- A3) 工作项全部完成 + 用例最新结果全部通过
INSERT IGNORE INTO tmp_108_done (id, workspace_id, reason)
SELECT d.id, d.workspace_id, 'derived'
FROM demand d
WHERE d.status = 'plan'
  AND EXISTS (
    SELECT 1 FROM task t
    WHERE t.workspace_id = d.workspace_id AND t.demand_id = d.id AND t.deleted_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM task t
    WHERE t.workspace_id = d.workspace_id AND t.demand_id = d.id AND t.deleted_at IS NULL
      AND t.board_column <> 'done'
  )
  AND NOT EXISTS (
    SELECT 1 FROM test_case tc
    WHERE tc.workspace_id = d.workspace_id AND tc.demand_id = d.id
      AND COALESCE((
        SELECT r.status FROM test_case_run r
        WHERE r.workspace_id = tc.workspace_id AND r.case_id = tc.id
        ORDER BY r.created_at DESC, r.id DESC LIMIT 1
      ), '') <> 'passed'
  );

-- B) 已完成但证据全部失效（在 A 改状态之前取样，A 命中的需求量本身都有证据，不会落入这里）
DROP TEMPORARY TABLE IF EXISTS tmp_108_reopen;
CREATE TEMPORARY TABLE tmp_108_reopen (
  id varchar(32) NOT NULL,
  workspace_id varchar(32) NOT NULL,
  PRIMARY KEY (id)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO tmp_108_reopen (id, workspace_id)
SELECT d.id, d.workspace_id
FROM demand d
WHERE d.status = 'done'
  AND NOT EXISTS (
    SELECT 1
    FROM version_release_item i
    INNER JOIN version_release vr
      ON vr.workspace_id = i.workspace_id AND vr.id = i.release_id
    WHERE i.workspace_id = d.workspace_id AND i.demand_id = d.id
      AND i.disposition = 'published'
      AND vr.result = 'success' AND vr.environment = 'production'
      AND vr.operation <> 'rollback' AND vr.coverage = 'full'
      AND NOT EXISTS (
        SELECT 1
        FROM version_release rb
        INNER JOIN version_release_item ri
          ON ri.workspace_id = rb.workspace_id AND ri.release_id = rb.id
        WHERE rb.workspace_id = vr.workspace_id AND rb.related_release_id = vr.id
          AND rb.result = 'success' AND rb.environment = 'production' AND rb.operation = 'rollback'
          AND ri.task_id = i.task_id
          AND (rb.occurred_at > vr.occurred_at
               OR (rb.occurred_at = vr.occurred_at AND rb.recorded_at > vr.recorded_at)
               OR (rb.occurred_at = vr.occurred_at AND rb.recorded_at = vr.recorded_at AND rb.id > vr.id))
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM demand_delivery_judgement dj
    WHERE dj.workspace_id = d.workspace_id AND dj.active_demand_id = d.id
      AND dj.judged_stage = 'delivered' AND dj.version_id <=> d.version_id
  )
  AND NOT (
    EXISTS (
      SELECT 1 FROM task t
      WHERE t.workspace_id = d.workspace_id AND t.demand_id = d.id AND t.deleted_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM task t
      WHERE t.workspace_id = d.workspace_id AND t.demand_id = d.id AND t.deleted_at IS NULL
        AND t.board_column <> 'done'
    )
    AND NOT EXISTS (
      SELECT 1 FROM test_case tc
      WHERE tc.workspace_id = d.workspace_id AND tc.demand_id = d.id
        AND COALESCE((
          SELECT r.status FROM test_case_run r
          WHERE r.workspace_id = tc.workspace_id AND r.case_id = tc.id
          ORDER BY r.created_at DESC, r.id DESC LIMIT 1
        ), '') <> 'passed'
    )
  );

UPDATE demand d
INNER JOIN tmp_108_done t ON t.id = d.id
SET d.status = 'done', d.revision = d.revision + 1, d.updated_at = NOW()
WHERE d.status = 'plan';

INSERT INTO demand_log (workspace_id, demand_id, action, note, operator, change_data)
SELECT t.workspace_id, t.id, 'complete',
       CASE t.reason
         WHEN 'release' THEN '迁移回填：存在成功生产发布记录，自动置为已完成'
         WHEN 'manual' THEN '迁移回填：存在生效的人工交付判定，自动置为已完成'
         ELSE '迁移回填：关联工作项全部完成且用例最新执行全部通过，自动置为已完成'
       END,
       NULL,
       JSON_OBJECT('before', JSON_OBJECT('status', 'plan'),
                   'after', JSON_OBJECT('status', 'done'),
                   'reason', CASE t.reason
                     WHEN 'release' THEN '存在成功生产发布记录'
                     WHEN 'manual' THEN '存在生效的人工交付判定'
                     ELSE '关联工作项全部完成且用例最新执行全部通过'
                   END)
FROM tmp_108_done t
WHERE EXISTS (SELECT 1 FROM demand d WHERE d.id = t.id AND d.workspace_id = t.workspace_id AND d.status = 'done')
  AND NOT EXISTS (
    SELECT 1 FROM demand_log l
    WHERE l.workspace_id = t.workspace_id AND l.demand_id = t.id AND l.action = 'complete'
  );

UPDATE demand d
INNER JOIN tmp_108_reopen t ON t.id = d.id
SET d.status = 'plan', d.revision = d.revision + 1, d.updated_at = NOW()
WHERE d.status = 'done';

INSERT INTO demand_log (workspace_id, demand_id, action, note, operator, change_data)
SELECT t.workspace_id, t.id, 'auto_reopen',
       '迁移修复：完成条件不再成立（工作项、用例或发布证据已变化），自动退回已排期；目标版本与计划日期保留',
       NULL,
       JSON_OBJECT('before', JSON_OBJECT('status', 'done'),
                   'after', JSON_OBJECT('status', 'plan'),
                   'reason', '完成证据失效')
FROM tmp_108_reopen t
WHERE EXISTS (SELECT 1 FROM demand d WHERE d.id = t.id AND d.workspace_id = t.workspace_id AND d.status = 'plan')
  AND NOT EXISTS (
    SELECT 1 FROM demand_log l
    WHERE l.workspace_id = t.workspace_id AND l.demand_id = t.id AND l.action = 'auto_reopen'
  );

-- C) 已完成但没有任何完成日志（历史遗留）→ 补齐
INSERT INTO demand_log (workspace_id, demand_id, action, note, operator, change_data)
SELECT d.workspace_id, d.id, 'complete',
       '迁移修复：已完成状态缺少完成日志，补齐历史记录',
       NULL,
       JSON_OBJECT('before', JSON_OBJECT('status', 'plan'),
                   'after', JSON_OBJECT('status', 'done'),
                   'reason', '补齐历史完成记录')
FROM demand d
WHERE d.status = 'done'
  AND NOT EXISTS (
    SELECT 1 FROM demand_log l
    WHERE l.workspace_id = d.workspace_id AND l.demand_id = d.id AND l.action = 'complete'
  );

SELECT 'demand_done' AS metric, COUNT(*) AS total FROM demand WHERE status = 'done'
UNION ALL
SELECT 'demand_plan', COUNT(*) FROM demand WHERE status = 'plan'
UNION ALL
SELECT 'log_complete', COUNT(*) FROM demand_log WHERE action = 'complete'
UNION ALL
SELECT 'log_auto_reopen', COUNT(*) FROM demand_log WHERE action = 'auto_reopen';

DROP TEMPORARY TABLE IF EXISTS tmp_108_done;
DROP TEMPORARY TABLE IF EXISTS tmp_108_reopen;

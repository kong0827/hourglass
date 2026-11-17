-- 105_demand_done_status.sql
-- 需求主状态新增「已完成 done」（完成 ≠ 交付）：
--   review 待评审 → pass 已通过 → plan 已排期 → done 已完成；closed 仍为异常终止。
-- 交付阶段（待开工/推进中/待发布/已交付）改为 done / plan 上的只读派生展示，不改表结构。
--
-- 回填口径（只处理存量 plan 需求，证据优先）：
--   1. 有成功、生产、全量覆盖且未被后续回滚撤销的发布条目
--      （version_release.result='success' AND environment='production' AND operation<>'rollback'
--      AND coverage='full' AND version_release_item.disposition='published'）→ done
--   2. 有生效的人工交付判定（judged_stage='delivered'，且判定版本与需求当前目标版本一致）→ done
--   3. 至少 1 个未删除工作项、全部处于完成列，且关联用例最新一次执行全部通过（无用例视为通过）→ done
-- 其余 plan 需求保持不动；回填同时追加 demand_log（action='complete'），便于追溯。
-- 脚本幂等：重复执行不会重复改状态或重复写日志。

CREATE TEMPORARY TABLE IF NOT EXISTS tmp_105_done (
  id varchar(32) NOT NULL,
  workspace_id varchar(32) NOT NULL,
  reason varchar(20) NOT NULL,
  PRIMARY KEY (id)
);

-- 1) 真实发布证据优先（成功、生产、非回滚、全量覆盖，且未被后续回滚按工作项撤销）
INSERT IGNORE INTO tmp_105_done (id, workspace_id, reason)
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

-- 2) 人工交付判定（仅补真实发布缺失的场景，且判定绑定当前目标版本）
INSERT IGNORE INTO tmp_105_done (id, workspace_id, reason)
SELECT d.id, d.workspace_id, 'manual'
FROM demand d
INNER JOIN demand_delivery_judgement dj
  ON dj.workspace_id = d.workspace_id AND dj.active_demand_id = d.id
 AND dj.version_id <=> d.version_id
WHERE d.status = 'plan' AND dj.judged_stage = 'delivered';

-- 3) 工作项全部完成 + 用例最新结果全部通过
INSERT IGNORE INTO tmp_105_done (id, workspace_id, reason)
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

UPDATE demand d
INNER JOIN tmp_105_done t ON t.id = d.id
SET d.status = 'done', d.revision = d.revision + 1, d.updated_at = NOW()
WHERE d.status = 'plan';

INSERT INTO demand_log (workspace_id, demand_id, action, note, operator)
SELECT t.workspace_id, t.id, 'complete',
       CASE t.reason
         WHEN 'release' THEN '迁移回填：存在成功生产发布记录，自动置为已完成'
         WHEN 'manual' THEN '迁移回填：存在生效的人工交付判定，自动置为已完成'
         ELSE '迁移回填：关联工作项全部完成且用例最新执行全部通过，自动置为已完成'
       END,
       NULL
FROM tmp_105_done t
WHERE EXISTS (SELECT 1 FROM demand d WHERE d.id = t.id AND d.status = 'done')
  AND NOT EXISTS (
    SELECT 1 FROM demand_log l
    WHERE l.workspace_id = t.workspace_id AND l.demand_id = t.id AND l.action = 'complete'
  );

DROP TEMPORARY TABLE IF EXISTS tmp_105_done;

-- ============================================================================
-- 流程引擎 · 14 个工作项「已发布」历史补录（2026-11-26）
--
-- 场景：下列工作项历史上确已发布，但系统内没有正式生产发布记录，列表「发布态」显示未发布。
-- 渠道：task_publication_judgement（人工标记表，sql/102）。
--   只影响工作项徽标（显示「已发布（人工）」）与「发布态」筛选：
--   不改变 publicationState，不进版本统计，不参与需求交付阶段派生。
--   若还要求影响版本统计 / 需求交付阶段，必须补 version_release + version_release_item，本脚本不做。
--
-- 幂等：已有生效标记的跳过；active_task_id 唯一键兜底。
-- 保护：默认只处理已完成（board_column='done'）的工作项，测试中 / 进行中的自动跳过，
--       第 4 段预览会标出跳过原因。确需强制全量，执行前把 @only_done 改成 0。
--
-- 执行：cmd /c "mysql -uroot -p --default-character-set=utf8mb4 hourglass < D:\project\hourglass\_backfill_publication_flow14_20261126.sql"
-- 两遍走：第一遍不提交（只看第 3、4 段预览）→ 取消第 5 段 COMMIT 注释 → 再整份执行一遍落库。
-- ============================================================================

USE hourglass;
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 0. 参数与前置检查
-- ---------------------------------------------------------------------------
SET @ws        := 'SXk01' COLLATE utf8mb4_unicode_ci;  -- 限定空间；NULL 表示不限
SET @operator  := 'admin' COLLATE utf8mb4_unicode_ci;  -- 标记人登录名，须在 app_user 中存在
SET @only_done := 1;                                   -- 1=只标已完成；0=不限制看板列
SET @reason    := '历史发布补录：流程引擎 14 项已发布但无发布记录（2026-11-26）' COLLATE utf8mb4_unicode_ci;

-- 0.1 人工标记表是否已建（sql/102）；返回 0 则先执行 sql/102_task_publication_judgement.sql
SELECT COUNT(*) AS has_judgement_table
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name = 'task_publication_judgement';

-- 0.2 操作人必须有效，否则第 5 段插入 0 行
SELECT u.id AS operator_id, u.username, u.display_name, u.disabled
FROM app_user u
WHERE u.username = @operator;

-- ---------------------------------------------------------------------------
-- 1. 白名单（14 条；task_id 为主键，title 仅作兜底匹配与预览）
-- ---------------------------------------------------------------------------
DROP TEMPORARY TABLE IF EXISTS tmp_pub_ids;
CREATE TEMPORARY TABLE tmp_pub_ids (
  seq     int         NOT NULL AUTO_INCREMENT,
  task_id varchar(32) NOT NULL COMMENT '工作项ID',
  title   varchar(120) NOT NULL COMMENT '期望标题（按 ID 匹配不到时按标题+项目兜底）',
  PRIMARY KEY (seq),
  UNIQUE KEY uk_task_id (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tmp_pub_ids (task_id, title) VALUES
('Xkt0071', '超时自动审批'),
('Xkt0084', '待办流程中添加字段'),
('Xkt0085', '待办中加批量审批功能'),
('Xkt0101', '流程设计支持导入导出'),
('Xkt0112', '流程description与title字段渲染调整'),
('Xkt0116', '业务中台待办对接'),
('Xkt0194', '点击催办出现“当前流程节点无处理人!”报错'),
('Xkt0195', '流程表单页面, 催办弹窗会被顶部的冻结区域覆盖'),
('Xkt0198', '自研流程菜单角色权限配置调整'),
('Xkt0211', 'OA待办标题长度调整'),
('Xkt0218', '常用语字体优化'),
('Xkt0226', '流程查询及任务中心下流程列表客户信息鉴权渲染优化'),
('Xkt0269', '在途流程支持运维设置委托代理人'),
('Xkt0270', '注销账号存在在途流程定时通知运维');

SELECT COUNT(*) AS whitelist_cnt FROM tmp_pub_ids;   -- 期望 14

-- ---------------------------------------------------------------------------
-- 2. 展开命中（按 ID 匹配；ID 不存在时按「标题 + 项目名=流程引擎」兜底）
-- ---------------------------------------------------------------------------
DROP TEMPORARY TABLE IF EXISTS tmp_pub_hit;
CREATE TEMPORARY TABLE tmp_pub_hit (
  seq           int         NOT NULL,
  task_id_key   varchar(32) NOT NULL COMMENT '白名单里的期望ID',
  task_id       varchar(32) DEFAULT NULL,
  workspace_id  varchar(32) DEFAULT NULL,
  item_no       int         DEFAULT NULL,
  title         varchar(120) DEFAULT NULL,
  project_name  varchar(40) DEFAULT NULL,
  module_name   varchar(50) DEFAULT NULL,
  board_column  varchar(24) DEFAULT NULL,
  completed_at  datetime    DEFAULT NULL,
  match_by      varchar(8)  NOT NULL COMMENT 'id / title',
  is_done       tinyint     NOT NULL DEFAULT 0,
  has_judgement tinyint     NOT NULL DEFAULT 0 COMMENT '1=已有生效人工标记，跳过',
  real_pub      tinyint     NOT NULL DEFAULT 0 COMMENT '1=已有正式生产发布记录（补标记冗余但不冲突）',
  KEY idx_task (task_id),
  KEY idx_seq  (seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tmp_pub_hit
  (seq, task_id_key, task_id, workspace_id, item_no, title,
   project_name, module_name, board_column, completed_at, match_by,
   is_done, has_judgement, real_pub)
SELECT
  p.seq,
  p.task_id,
  t.id,
  t.workspace_id,
  t.item_no,
  t.title,
  rp.name,
  c.name,
  t.board_column,
  t.completed_at,
  CASE WHEN t.id = p.task_id THEN 'id' ELSE 'title' END,
  CASE WHEN t.board_column = 'done' THEN 1 ELSE 0 END,
  CASE WHEN tj.id IS NULL THEN 0 ELSE 1 END,
  CASE WHEN EXISTS (
         SELECT 1
         FROM version_release_item ri
         JOIN version_release vr
           ON vr.id = ri.release_id AND vr.workspace_id = ri.workspace_id
         WHERE ri.workspace_id = t.workspace_id
           AND ri.task_id = t.id
           AND vr.environment = 'production'
           AND vr.result = 'success'
           AND ri.disposition IN ('published','rolled_back')
       ) THEN 1 ELSE 0 END
FROM tmp_pub_ids p
JOIN task t
  ON t.deleted_at IS NULL
 AND (@ws IS NULL OR t.workspace_id = @ws)
 AND (t.id = p.task_id OR t.title = p.title)
LEFT JOIN requirement rp ON rp.id = t.req_id       AND rp.workspace_id = t.workspace_id
LEFT JOIN category    c  ON c.id  = t.category_id  AND c.workspace_id  = t.workspace_id
LEFT JOIN task_publication_judgement tj
       ON tj.workspace_id = t.workspace_id
      AND tj.active_task_id = t.id
WHERE t.id = p.task_id
   OR (t.title = p.title AND rp.name = '流程引擎');

-- ---------------------------------------------------------------------------
-- 3. 覆盖自检
-- ---------------------------------------------------------------------------
-- 3.1 命中工作项条数（期望 14）
SELECT COUNT(*) AS hit_task_cnt FROM tmp_pub_hit;

-- 3.2 清单里没有匹配到任何 task 的项（应为空；非空说明 ID/标题在目标库不存在或已删除）
SELECT p.seq, p.task_id, p.title
FROM tmp_pub_ids p
LEFT JOIN tmp_pub_hit h ON h.seq = p.seq
WHERE h.seq IS NULL
ORDER BY p.seq;

-- 3.3 一条白名单命中多个工作项（应为空；非空说明标题重名，需改用 ID 精确匹配）
SELECT seq, task_id_key, COUNT(*) AS cnt, GROUP_CONCAT(task_id ORDER BY task_id) AS tasks
FROM tmp_pub_hit
GROUP BY seq, task_id_key
HAVING COUNT(*) > 1;

-- 3.4 分档统计
SELECT
  SUM(is_done = 1 AND has_judgement = 0)                  AS will_insert,
  SUM(is_done = 1 AND has_judgement = 1)                  AS skip_already_marked,
  SUM(is_done = 0)                                        AS skip_not_done,
  SUM(is_done = 1 AND has_judgement = 0 AND real_pub = 1) AS of_which_has_real_pub
FROM tmp_pub_hit;

-- ---------------------------------------------------------------------------
-- 4. 逐条预览（先看这一份再执行第 5 步）
-- ---------------------------------------------------------------------------
SELECT h.seq,
       CONCAT('WI-', LPAD(h.item_no, 3, '0')) AS wi,
       h.task_id,
       h.title,
       h.project_name,
       h.module_name,
       h.board_column,
       h.completed_at,
       h.match_by,
       CASE WHEN h.has_judgement = 1                THEN '跳过：已有生效标记'
            WHEN @only_done = 1 AND h.is_done = 0   THEN '跳过：未完成'
            ELSE '将写入' END AS action,
       h.real_pub
FROM tmp_pub_hit h
ORDER BY h.seq;

-- ---------------------------------------------------------------------------
-- 5. 写入
-- ---------------------------------------------------------------------------
START TRANSACTION;

INSERT INTO task_publication_judgement
  (workspace_id, task_id, judged_state, effective_on, judge_reason,
   judged_by_user_id, judged_by_name)
SELECT h.workspace_id,
       h.task_id,
       'published',
       COALESCE(DATE(h.completed_at), CURDATE()),
       @reason,
       u.id,
       u.display_name
FROM tmp_pub_hit h
JOIN app_user u ON u.username = @operator
WHERE h.has_judgement = 0
  AND (@only_done = 0 OR h.is_done = 1)
ORDER BY h.seq;

SELECT ROW_COUNT() AS inserted_rows;   -- 应等于 3.4 的 will_insert

-- 5.1 复核 1：本批生效标记条数
SELECT COUNT(*) AS active_marked_in_batch
FROM task_publication_judgement
WHERE revoked_at IS NULL AND judge_reason = @reason;

-- 5.2 复核 2：应写而未写的工作项（应为 0 行）
SELECT h.task_id, h.title, h.board_column
FROM tmp_pub_hit h
LEFT JOIN task_publication_judgement tj
       ON tj.workspace_id = h.workspace_id AND tj.active_task_id = h.task_id
WHERE h.has_judgement = 0
  AND (@only_done = 0 OR h.is_done = 1)
  AND tj.id IS NULL;

-- 默认不提交：第一遍原样执行，结果只在当前会话可见，连接断开即回滚。
-- 看完第 3、4 段与两条复核后，取消下一行 COMMIT 的注释，再整份执行一遍落库。
-- COMMIT;

-- ---------------------------------------------------------------------------
-- 6. 回退（整批撤销，保留留痕，不动正式发布记录）
-- ---------------------------------------------------------------------------
-- UPDATE task_publication_judgement
-- SET revoked_at = CURRENT_TIMESTAMP(6),
--     revoked_by_user_id = (SELECT id           FROM app_user WHERE username = @operator),
--     revoked_by_name    = (SELECT display_name FROM app_user WHERE username = @operator),
--     revoke_reason      = '撤销流程引擎 14 项发布补录'
-- WHERE judge_reason = @reason
--   AND revoked_at IS NULL;
--
-- 撤销后 active_task_id 归 NULL，唯一键释放，可重新执行第 5 步补录。

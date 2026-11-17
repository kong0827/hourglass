-- ============================================================================
-- 工作项「已发布」历史补录 · 白名单一次性修正（按 task.id 精确匹配）
--
-- 场景：下列 331 个工作项历史上确已发布，但迁移数据错误导致系统内没有发布记录，
--       需要把它们标记为「已发布」。附加条件：只处理已完成（board_column='done'）的工作项。
--
-- 渠道：task_publication_judgement（人工标记表，sql/102）。
--   只影响工作项徽标与「发布态」筛选，不改变 publicationState，
--   不进版本统计、不参与需求交付阶段派生。若还要求影响统计，必须补
--   version_release / version_release_item，本脚本不做。
--
-- 幂等：已有生效标记的行跳过；重复执行不会重复插入（active_task_id 唯一键兜底）。
-- 一次性数据修正脚本，不属于 sql/ 编号增量链，勿纳入自动部署。
--
-- 执行：cmd /c "mysql -uroot -p --default-character-set=utf8mb4 hourglass < D:\project\hourglass\_backfill_publication_whitelist.sql"
-- 两遍走：第一遍不提交（看预览与复核）→ 取消第 5 段 COMMIT 注释 → 再执行一遍落库。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. 参数
-- ---------------------------------------------------------------------------
-- 库表统一 utf8mb4_unicode_ci，而 MySQL 8 连接默认 0900_ai_ci；
-- 用户变量会继承连接排序规则，与列比较会报 Illegal mix of collations。
-- 先统一连接排序规则，并给变量显式带上 COLLATE，双保险。
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @ws       := 'SXk01' COLLATE utf8mb4_unicode_ci;                 -- 限定空间；改成 NULL 表示不限空间
SET @operator := 'admin' COLLATE utf8mb4_unicode_ci;                 -- 标记人登录名（需在 app_user 中存在）
SET @reason   := '迁移数据错误补录：历史已发布无发布记录（按工作项ID白名单修正）' COLLATE utf8mb4_unicode_ci;

-- 操作人必须是有效账号，否则后面插入会 0 行
SELECT u.id AS operator_id, u.username, u.display_name, u.disabled
FROM app_user u
WHERE u.username = @operator;

-- ---------------------------------------------------------------------------
-- 1. 白名单（331 条：328 个完整 ID + 3 个前缀模式）
-- ---------------------------------------------------------------------------
DROP TEMPORARY TABLE IF EXISTS tmp_pub_ids;
CREATE TEMPORARY TABLE tmp_pub_ids (
  seq        int         NOT NULL AUTO_INCREMENT,
  id_pattern varchar(64) NOT NULL COMMENT '工作项ID；以 % 结尾表示前缀匹配',
  PRIMARY KEY (seq),
  UNIQUE KEY uk_pattern (id_pattern)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tmp_pub_ids (id_pattern) VALUES
('Xkt0164'),('Xkt0230'),('Xkt0006'),('Xkt0031'),('Xkt0034'),('Xkt0038'),('Xkt0032'),('Xkt0033'),('Xkt0035'),('Xkt0036'),
('Xkt0040'),('Xkt0044'),('Xkt0037'),('Xkt0039'),('Xkt0041'),('Xkt0042'),('Xkt0047'),('Xkt0050'),('Xkt0045'),('Xkt0049'),
('Xkt0043'),('Xkt0046'),('Xkt0053'),('Xkt0054'),('Xkt0056'),('Xkt0057'),('Xkt0068'),('Xkt0069'),('Xkt0070'),('Xkt0071'),
('Xkt0072'),('Xkt0073'),('Xkt0075'),('Xkt0055'),('Xkt0074'),('Xkt0079'),('Xkt0080'),('Xkt0081'),('Xkt0082'),('Xkt0083'),
('Xkt0084'),('Xkt0085'),('Xkt0089'),('Xkt0087'),('Xkt0088'),('Xkt0090'),('Xkt0100'),('Xkt0101'),('Xkt0102'),('Xkt0103'),
('Xkt0105'),('Xkt0106'),('Xkt0107'),('Xkt0104'),('Xkt0108'),('Xkt0110'),('Xkt0112'),('Xkt0109'),('Xkt0111'),('Xkt0114'),
('Xkt0117'),('Xkt0118'),('Xkt0130'),('Xkt0124'),('Xkt0115'),('Xkt0119'),('Xkt0125'),('Xkt0127'),('Xkt0132'),('Xkt0133'),
('Xkt0134'),('Xkt0116'),('Xkt0120'),('Xkt0126'),('Xkt0129'),('Xkt0137'),('Xkt0128'),('Xkt0136'),('Xkt0138'),('Xkt0142'),
('Xkt0143'),('Xkt0011'),('Xkt0274'),('Xkt0007'),('Xkt0250'),('Xkt0155'),('Xkt0289'),('Xkt0901'),('Xkt0902'),('Xkt0158'),
('Xkt0159'),('Xkt0162'),('Xkt0163'),('Xkt0222'),('Xkt0257'),('Xkt0271'),('Xkt0903'),('Xkt0904'),('Xkt0238'),('Xkt0272'),
('Xkt0288'),('Xkt0177'),('Xkt0204'),('Xkt0255'),('Xkt0001'),('Xkt0237'),('Xkt0905'),('Xkt0906'),('Xkt0907'),('Xkt0908'),
('Xkt0909'),('Xkt0179'),('Xkt0180'),('Xkt0181'),('Xkt0269'),('Xkt0008'),('Xkt0287'),('Xkt0910'),('Xkt0911'),('Xkt0912'),
('Xkt0913'),('Xkt0915'),('Xkt0917'),('Xkt0918'),('Xkt0919'),('Xkt0190'),('Xkt1001'),('Xkt0254'),('Xkt0192'),('Xkt0231'),
('Xkt0291'),('Xkt0920'),('Xkt0194'),('Xkt0921'),('Xkt0922'),('Xkt0927'),('Xkt0928'),('Xkt0929'),('Xkt0197'),('Xkt0198'),
('Xkt0169'),('Xkt0195'),('Xkt0052'),('Xkt0201'),('Xkt1004'),('Xkt1007'),('Xkt0270'),('Xkt0263'),('Xkt0930'),('Xkt0200'),
('Xkt0206'),('Xkt1006'),('Xkt1008'),('Xkt0199'),('Xkt0211'),('Xkt0213'),('Xkt0214'),('Xkt1002'),('Xkt1005'),('Xkt1009'),
('Xkt1010'),('Xkt0010'),('Xkt0215'),('Xkt0914'),('Xkt0931'),('Xkt1003'),('Xkt0916'),('Xkt0013'),('Xkt0014'),('Xkt0015'),
('Xkt0016'),('Xkt0216'),('Xkt0218'),('Xkt0145'),('Xkt1011'),('Xkt1012'),('Xkt1014'),('Xkt0165'),('Xkt0227'),('Xkt0229'),
('Xkt0233'),('Xkt0228'),('Xkt0235'),('Xkt0236'),('Xkt0012'),('Xkt0234'),('Xkt1015'),('Xkt1013'),('Xkt0193'),('Xkt0009'),
('Xkt0171'),('Xkt0224'),('Xkt0265'),('Xkt0290'),('Xkt0146'),('Xkt0168'),('Xkt0212'),('Xkt0239'),('Xkt0252'),('Xkt0253'),
('Xkt0002'),('Xkt0185'),('Xkt0161'),('Xkt0266'),('Xkt0156'),('Xkt1022'),('Xkt1028'),('Xkt1019'),('Xkt1021'),('Xkt1023'),
('Xkt0170'),('Xkt0256'),('Xkt1017'),('Xkt1024'),('Xkt1025'),('Xkt1034'),('Xkt1037'),('Xkt1038'),('Xkt1039'),('Xkt0144'),
('Xkt0226'),('Xkt0932'),('Xkt0933'),('Xkt0934'),('Xkt0935'),('Xkt0936'),('Xkt1018'),('Xkt1020'),('Xkt1026'),('Xkt1027'),
('Xkt1032'),('Xkt0086'),('Xkt1033'),('Xkt1035'),('Xkt1040'),('Xkt1043'),('Xkt1036'),('Xkt0264'),('Xkt1041'),('Xkt1042'),
('Xkt0157'),('Xkt0166'),('Xkt0178'),('Xkt0160'),('Xkt1045'),('Xkt1047'),('Xkt1049'),('Xkt1051'),('Xkt1046'),('Xkt1044'),
('Xkt1048'),('Xkt1050'),('Xkt1052'),('Kmwel32ic%'),('Xkt0077'),('Xkt0113'),('Xkt0048'),('Xkt0051'),('Xkt0058'),('Xkt0062'),
('Xkt0059'),('Xkt0060'),('Xkt0061'),('Xkt0063'),('Xkt0093'),('Xkt0092'),('Xkt0094'),('Xkt0064'),('Xkt0096'),('Xkt0095'),
('Xkt0097'),('Xkt0065'),('Xkt0098'),('Xkt0066'),('Xkt0099'),('Xkt0121'),('Xkt0122'),('Xkt0067'),('Xkt0123'),('Xkt0135'),
('Xkt0140'),('Xkt0139'),('Xkt0131'),('Xkt0187'),('Xkt0147'),('Xkt0148'),('Xkt0149'),('Xkt0150'),('Xkt0153'),('Xkt0154'),
('Xkt0167'),('Xkt0175'),('Xkt0141'),('Xkt0172'),('Xkt0183'),('Xkt0184'),('Xkt0173'),('Xkt0182'),('Xkt0176'),('Xkt0267'),
('Xkt0174'),('Xkt0208'),('Xkt0207'),('Xkt0925'),('Xkt0926'),('Xkt0209'),('Xkt0210'),('Xkt1029'),('Xkt1030'),('Kmwk0iehgz%'),
('Kmwk0mx18a%'),('Xkt0076'),('Xkt0078'),('Xkt0091'),('Xkt0005'),('Xkt0203'),('Xkt0019'),('Xkt0020'),('Xkt0021'),('Xkt0022'),
('Xkt0023'),('Xkt0024'),('Xkt0025'),('Xkt0026'),('Xkt0027'),('Xkt0028'),('Xkt0029'),('Xkt0030'),('Xkt0018'),('Xkt0017'),
('Xkt1031');

SELECT COUNT(*) AS whitelist_cnt FROM tmp_pub_ids;   -- 期望 331

-- ---------------------------------------------------------------------------
-- 2. 展开命中（一个前缀可能命中多个工作项，故按 task 展开）
-- ---------------------------------------------------------------------------
DROP TEMPORARY TABLE IF EXISTS tmp_pub_hit;
CREATE TEMPORARY TABLE tmp_pub_hit (
  seq           int         NOT NULL,
  id_pattern    varchar(64) NOT NULL,
  task_id       varchar(32) DEFAULT NULL,
  workspace_id  varchar(32) DEFAULT NULL,
  item_no       int         DEFAULT NULL,
  title         varchar(60) DEFAULT NULL,
  project_name  varchar(40) DEFAULT NULL,
  module_name   varchar(50) DEFAULT NULL,
  board_column  varchar(24) DEFAULT NULL,
  completed_at  datetime    DEFAULT NULL,
  is_done       tinyint     NOT NULL DEFAULT 0 COMMENT '1=已完成（board_column=done）',
  has_judgement tinyint     NOT NULL DEFAULT 0 COMMENT '1=已有生效人工标记，跳过',
  real_pub      tinyint     NOT NULL DEFAULT 0 COMMENT '1=已有正式生产发布记录（加了标记也冗余）',
  KEY idx_task (task_id),
  KEY idx_seq  (seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tmp_pub_hit
  (seq, id_pattern, task_id, workspace_id, item_no, title,
   project_name, module_name, board_column, completed_at,
   is_done, has_judgement, real_pub)
SELECT
  p.seq,
  p.id_pattern,
  t.id,
  t.workspace_id,
  t.item_no,
  t.title,
  rp.name,
  c.name,
  t.board_column,
  t.completed_at,
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
 AND ( t.id = p.id_pattern
       OR (INSTR(p.id_pattern, '%') > 0 AND t.id LIKE p.id_pattern) )
LEFT JOIN requirement rp ON rp.id = t.req_id        AND rp.workspace_id = t.workspace_id
LEFT JOIN category    c  ON c.id  = t.category_id   AND c.workspace_id  = t.workspace_id
LEFT JOIN task_publication_judgement tj
       ON tj.workspace_id = t.workspace_id
      AND tj.active_task_id = t.id;

-- 注意：这里只认 board_column='done'。
-- 若自建「已完成」列（board_column.processing_rule='ended'）也要算，把上一段
-- CASE WHEN t.board_column = 'done' THEN 1 ELSE 0 END 换成：
--   CASE WHEN t.board_column = 'done' OR EXISTS (
--     SELECT 1 FROM board_column bc
--     WHERE bc.workspace_id = t.workspace_id AND bc.id = t.board_column
--       AND bc.processing_rule = 'ended') THEN 1 ELSE 0 END

-- ---------------------------------------------------------------------------
-- 3. 覆盖自检
-- ---------------------------------------------------------------------------
-- 3.1 命中工作项条数（应 >= 331；前缀命中多个时会大于清单条数）
SELECT COUNT(*) AS hit_task_cnt FROM tmp_pub_hit;

-- 3.2 清单里没匹配到任何 task 的项（应为空；非空说明 ID 写错或工作项已删除）
SELECT p.seq, p.id_pattern
FROM tmp_pub_ids p
LEFT JOIN tmp_pub_hit h ON h.seq = p.seq
WHERE h.seq IS NULL
ORDER BY p.seq;

-- 3.3 一个 ID 命中多条 task（只应出现在 3 个前缀模式上；其他行出现说明 ID 冲突）
SELECT seq, id_pattern, COUNT(*) AS cnt, GROUP_CONCAT(task_id ORDER BY task_id) AS tasks
FROM tmp_pub_hit
GROUP BY seq, id_pattern
HAVING COUNT(*) > 1;

-- 3.4 分档统计
SELECT
  SUM(is_done = 1 AND has_judgement = 0)               AS will_insert,
  SUM(is_done = 1 AND has_judgement = 1)               AS skip_already_marked,
  SUM(is_done = 0)                                     AS skip_not_done,
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
       CASE WHEN h.has_judgement = 1 THEN '跳过：已有生效标记'
            WHEN h.is_done = 0       THEN '跳过：未完成'
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
WHERE h.is_done = 1
  AND h.has_judgement = 0
ORDER BY h.seq;

SELECT ROW_COUNT() AS inserted_rows;   -- 应等于 3.4 的 will_insert

-- 5.1 复核 1：本次写入条数
SELECT COUNT(*) AS active_marked_now
FROM task_publication_judgement
WHERE revoked_at IS NULL AND judge_reason = @reason;

-- 5.2 复核 2：白名单里已完成的工作项是否都有生效标记（应为 0 行）
SELECT h.task_id, h.id_pattern, h.board_column
FROM tmp_pub_hit h
LEFT JOIN task_publication_judgement tj
       ON tj.workspace_id = h.workspace_id AND tj.active_task_id = h.task_id
WHERE h.is_done = 1
  AND tj.id IS NULL;

-- 默认不提交：第一遍原样执行，结果只在当前会话可见，连接断开即回滚。
-- 看完第 4 段预览与这两条复核后，取消下一行 COMMIT 的注释，再整份执行一遍落库。
-- COMMIT;

-- ---------------------------------------------------------------------------
-- 6. 回退（如需整批撤销，保留留痕，不动历史）
-- ---------------------------------------------------------------------------
-- UPDATE task_publication_judgement
-- SET revoked_at = CURRENT_TIMESTAMP(6),
--     revoked_by_user_id = (SELECT id           FROM app_user WHERE username = @operator),
--     revoked_by_name    = (SELECT display_name FROM app_user WHERE username = @operator),
--     revoke_reason      = '撤销白名单补录（误标回滚）'
-- WHERE judge_reason = @reason
--   AND revoked_at IS NULL;
--
-- 撤销后 active_task_id 归 NULL，唯一键释放，可重新执行第 5 步补录。

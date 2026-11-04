-- ============================================================================
-- 工作台 · 「需求」模块（2026-10-21）
--
-- 背景：原来只有两层 —— 空间 → 项目(requirement) → 任务。实际使用时发现
--       "项目"里还需要再分需求（一个项目下往往有好几份需求文档，每份对应一
--       批任务）。所以引入第三层：
--
--           空间 workspace
--             └─ 项目 requirement        （已有，界面上叫「项目」）
--                  └─ 需求 requirement_doc（本次新增，带富文本正文）
--                       └─ 任务 task.req_doc_id
--
-- 设计原则：纯增量、幂等、向后兼容。
--   · 新表 CREATE TABLE IF NOT EXISTS；
--   · task 只 ADD COLUMN（req_doc_id），老数据为 NULL，行为与升级前一致；
--   · 正文 content 存清洗后的 HTML（服务端 jsoup 白名单清洗，见 RequirementDocService）。
--
-- 执行：mysql -u hourglass -p hourglass < sql/07_requirement_doc.sql
-- ============================================================================

USE hourglass;

CREATE TABLE IF NOT EXISTS requirement_doc (
  id            VARCHAR(32)  NOT NULL COMMENT '需求ID',
  workspace_id  VARCHAR(32)  NOT NULL COMMENT '归属空间ID',
  req_id        VARCHAR(32)  NOT NULL COMMENT '所属项目ID（requirement.id）',
  title         VARCHAR(100) NOT NULL COMMENT '需求标题',
  content       MEDIUMTEXT   DEFAULT NULL COMMENT '需求正文（清洗后的 HTML）',
  status        VARCHAR(16)  NOT NULL DEFAULT 'draft' COMMENT '状态：draft/active/done',
  owner         VARCHAR(32)  DEFAULT NULL COMMENT '负责人显示名',
  owner_user_id VARCHAR(32)  DEFAULT NULL COMMENT '负责人账号ID',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  KEY idx_ws (workspace_id),
  KEY idx_req (req_id),
  KEY idx_ws_updated (workspace_id, updated_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '需求（项目下的需求文档）';

-- ---------------------------------------------------------------------------
-- task：关联需求
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'req_doc_id');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD COLUMN req_doc_id VARCHAR(32) DEFAULT NULL COMMENT ''关联需求ID（requirement_doc）'' AFTER req_id',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND INDEX_NAME = 'idx_req_doc');
SET @s := IF(@x = 0, 'ALTER TABLE task ADD KEY idx_req_doc (req_doc_id)', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 自检：应看到新表与 task 的新列
-- ---------------------------------------------------------------------------
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME IN ('req_id', 'req_doc_id');

SELECT COUNT(*) AS requirement_doc_exists
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement_doc';

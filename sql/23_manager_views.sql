USE devstudio;

-- ============================================================================
-- 23_manager_views.sql · 管理者视图 M0 数据模型（2026-11-03）
--
-- 依据：docs/manager-view-gap-and-plan-2026-11-02.md
--   T0.1 需求池实体（方案 B：独立需求实体，不复用 requirement_doc）
--   T0.2 项目首版上线日（「首版开发 / 迭代维护」阶段归组分界）
--   T0.5 工作项类型 story/task/bug/epic（product-analysis 阶段 0 口径）
--
-- 设计原则：纯增量、幂等、向后兼容（information_schema 判断 + PREPARE，可重复执行）。
-- 存量数据：task.item_type 默认 'task'；requirement.first_released_at 为 NULL =
--           未标记上线，行为与升级前一致。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- T0.5 task：工作项类型 + Epic 关联
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'item_type');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD COLUMN item_type VARCHAR(16) NOT NULL DEFAULT ''task'' COMMENT ''工作项类型：story需求/task任务/bug缺陷/epic'' AFTER description',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME = 'epic_id');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD COLUMN epic_id VARCHAR(32) DEFAULT NULL COMMENT ''所属Epic任务ID（item_type=epic 时为空）'' AFTER item_type',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND INDEX_NAME = 'idx_ws_type');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD KEY idx_ws_type (workspace_id, item_type)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND INDEX_NAME = 'idx_epic');
SET @s := IF(@x = 0,
  'ALTER TABLE task ADD KEY idx_epic (epic_id)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- T0.2 requirement：首版上线日
-- ---------------------------------------------------------------------------
SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement' AND COLUMN_NAME = 'first_released_at');
SET @s := IF(@x = 0,
  'ALTER TABLE requirement ADD COLUMN first_released_at DATE DEFAULT NULL COMMENT ''首版上线日（空=未上线，全部投入归入首版开发）'' AFTER status',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- T0.1 需求池实体（状态机 review → pass / rej；pass → plan）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demand (
  id            VARCHAR(32)   NOT NULL COMMENT '需求ID',
  workspace_id  VARCHAR(32)   NOT NULL COMMENT '归属空间ID',
  req_id        VARCHAR(32)   NOT NULL COMMENT '所属项目ID（requirement 表）',
  title         VARCHAR(80)   NOT NULL COMMENT '需求标题',
  description   VARCHAR(2000) DEFAULT NULL COMMENT '为什么做（背景与价值）',
  source        VARCHAR(40)   DEFAULT NULL COMMENT '来源（谁提的，如「财务 · 刘」）',
  item_kind     VARCHAR(16)   NOT NULL DEFAULT '新功能' COMMENT '类型：新功能/体验优化/缺陷/其他',
  priority      VARCHAR(4)    NOT NULL DEFAULT 'P2' COMMENT '优先级 P0/P1/P2/P3',
  status        VARCHAR(16)   NOT NULL DEFAULT 'review' COMMENT '状态机：review待评审/pass已通过/plan已排期/rej已拒绝',
  expect_date   DATE          DEFAULT NULL COMMENT '期望交付时间',
  accept_text   VARCHAR(2000) DEFAULT NULL COMMENT '验收标准',
  version_id    VARCHAR(32)   DEFAULT NULL COMMENT '目标版本（project_version，排期时选择）',
  review_note   VARCHAR(500)  DEFAULT NULL COMMENT '评审备注（通过理由/拒绝原因/排期说明）',
  wsjf_business TINYINT UNSIGNED DEFAULT NULL COMMENT 'WSJF·业务价值 0-10',
  wsjf_urgency TINYINT UNSIGNED DEFAULT NULL COMMENT 'WSJF·时间紧迫度 0-10',
  wsjf_risk     TINYINT UNSIGNED DEFAULT NULL COMMENT 'WSJF·风险降低/机会 0-10',
  wsjf_effort   TINYINT UNSIGNED DEFAULT NULL COMMENT 'WSJF·工作量 0-10（分母，需 ≥1）',
  created_by    VARCHAR(32)   DEFAULT NULL COMMENT '提交人账号ID',
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  KEY idx_ws_status (workspace_id, status),
  KEY idx_ws_req (workspace_id, req_id),
  KEY idx_version (version_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '需求池（评审状态机）';

-- 需求流转留痕（create/pass/rej/plan/reopen/update）
CREATE TABLE IF NOT EXISTS demand_log (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '记录ID',
  workspace_id VARCHAR(32)   NOT NULL COMMENT '归属空间ID',
  demand_id    VARCHAR(32)   NOT NULL COMMENT '需求ID',
  action       VARCHAR(16)   NOT NULL COMMENT '动作：create/pass/rej/plan/reopen/update',
  note         VARCHAR(500)  DEFAULT NULL COMMENT '备注（拒绝原因/排期说明等）',
  operator     VARCHAR(32)   DEFAULT NULL COMMENT '操作人账号ID',
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
  PRIMARY KEY (id),
  KEY idx_ws_demand (workspace_id, demand_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '需求流转日志';

-- ---------------------------------------------------------------------------
-- 自检：应能看到新列与两张新表
-- ---------------------------------------------------------------------------
SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task' AND COLUMN_NAME IN ('item_type', 'epic_id');
SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement' AND COLUMN_NAME = 'first_released_at';
SHOW TABLES LIKE 'demand%';

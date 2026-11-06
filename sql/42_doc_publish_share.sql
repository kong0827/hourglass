-- ============================================================================
-- 需求文档「草稿/发布」可见性 + 只读分享链接
--
-- 1. requirement_doc 新增 published_at：
--    空 = 草稿（仅作者与空间 owner/admin 可见）；非空 = 已发布（按项目可见范围）。
--    与既有 status（draft/active/done 生命周期）正交，两套状态互不干扰。
-- 2. req_doc_share：每文档一个只读分享 token（同 gantt_share 模式）。
--
-- 幂等：列与表都用 information_schema / IF NOT EXISTS 判断，可重复执行；
--       存量回填仅在新列首次创建时发生（@x = 0），重跑不会把用户主动收回的草稿重新发布。
-- ============================================================================

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'requirement_doc' AND COLUMN_NAME = 'published_at');
SET @s := IF(@x = 0,
  'ALTER TABLE requirement_doc ADD COLUMN published_at DATETIME DEFAULT NULL COMMENT ''发布时间（空=草稿，仅作者与空间管理员可见）'' AFTER status',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 存量文档一律视为已发布：升级不改变现有成员的可见性
UPDATE requirement_doc SET published_at = created_at WHERE published_at IS NULL AND @x = 0;

-- ---------------------------------------------------------------------------
-- req_doc_share：文档级只读分享（每文档一个 token，可重置/撤销）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS req_doc_share (
  workspace_id VARCHAR(32) NOT NULL COMMENT '归属空间',
  doc_id       VARCHAR(32) NOT NULL COMMENT '文档ID（requirement_doc.id）',
  token        VARCHAR(32) NOT NULL COMMENT '分享令牌（URL 参数）',
  created_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  expires_at   DATETIME    DEFAULT NULL COMMENT '过期时间（空=长期有效）',
  PRIMARY KEY (workspace_id, doc_id),
  UNIQUE KEY uk_token (token)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '需求文档只读分享';

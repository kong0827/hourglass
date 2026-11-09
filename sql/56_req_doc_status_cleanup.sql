-- 文档 status 只表达流转状态（draft/active/done）；发布可见性由 published_at 单独表达。
-- 历史种子把 published 写进了 status，导致前端状态列兜底成「草稿」，与「已发布」徽标冲突。
UPDATE requirement_doc SET status = 'active' WHERE status NOT IN ('draft', 'active', 'done');

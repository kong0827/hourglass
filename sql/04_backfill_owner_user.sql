-- ============================================================================
-- 【可选】把历史任务的「负责人显示名文本」回填成账号ID（N-2 身份绑定）
--
-- 什么时候需要跑？
--   不需要也能用：「我的任务」与定向通知都已支持"owner_user_id 为空时回落显示名匹配"，
--   所以不跑这个脚本，功能同样可用（只是同名成员无法区分）。
--   想彻底消除"同名串号"风险、并让改名不再依赖字符串替换时，再跑它。
--
-- 安全性：
--   1. 只填空值（owner_user_id IS NULL 的行），绝不覆盖已有绑定；
--   2. 只在本空间成员范围内匹配；同一显示名对应多个账号时不会盲选——
--      下面的 UPDATE 以 (空间成员 ∩ 显示名相同) 为条件，若同空间内有两个同名账号，
--      两者都会命中，因此本脚本先用一段排查查询列出"同空间同名"的空间，建议先看结果。
--   3. 不修改 owner 文本列，回滚只需把 owner_user_id 置回 NULL。
--
-- 用法：
--   1) 先跑「排查查询」看有没有同空间同名的歧义；
--   2) 再跑回填；
--   3) 需要回滚：UPDATE task SET owner_user_id = NULL;（谨慎，会清掉全部绑定）
-- ============================================================================

USE devstudio;

-- ---------- 1) 排查：同一空间内是否存在同名显示名（有歧义的空间请手工处理） ----------
SELECT w.name AS workspace_name, u.display_name AS owner_text, COUNT(DISTINCT u.id) AS same_name_accounts
FROM workspace_member m
JOIN app_user u ON u.id = m.user_id
JOIN workspace w ON w.id = m.workspace_id
GROUP BY m.workspace_id, u.display_name
HAVING COUNT(DISTINCT u.id) > 1;

-- ---------- 2) 回填：按「空间成员 + 显示名完全一致」把空值补上 ----------
UPDATE task t
JOIN workspace_member m ON m.workspace_id = t.workspace_id
JOIN app_user u ON u.id = m.user_id AND u.display_name = t.owner
SET t.owner_user_id = u.id
WHERE t.owner_user_id IS NULL
  AND t.owner IS NOT NULL
  AND t.owner <> '';

-- ---------- 3) 结果核对 ----------
SELECT
  SUM(CASE WHEN owner_user_id IS NULL THEN 1 ELSE 0 END) AS still_text_only,
  SUM(CASE WHEN owner_user_id IS NOT NULL THEN 1 ELSE 0 END) AS bound_to_account,
  COUNT(*) AS total
FROM task;

SELECT '04_backfill_owner_user.sql 执行完成' AS result;

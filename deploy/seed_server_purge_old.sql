-- ============================================================================
-- deploy/seed_server_purge_old.sql · 清理 2026-11-07 首次部署时插入的旧演示数据
--
-- 背景：首次部署用 seed_demo.sql + seed_demo_extra.sql 插入了 Useed* / Rseed* / Tseed*
--       系列演示数据（挂在 admin 个人空间 WUmw5tt2nqz9s9b8sq 下）。
-- 本脚本只清这批数据：内容表按空间清空；tag/category/board_column 只删 seed 插入的行，
-- 保留注册时生成的默认看板列与默认分类（工作/学习/生活/其他）。
-- 重复执行安全（无行可删）。
-- ============================================================================

USE hourglass;
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @ws := 'WUmw5tt2nqz9s9b8sq';

START TRANSACTION;

DELETE FROM task_tag            WHERE workspace_id = @ws;
DELETE FROM subtask              WHERE workspace_id = @ws;
DELETE FROM task_comment         WHERE workspace_id = @ws;
DELETE FROM task_log             WHERE workspace_id = @ws;
DELETE FROM time_log             WHERE workspace_id = @ws;
DELETE FROM task_completion_record WHERE workspace_id = @ws;
DELETE FROM task_dependency      WHERE workspace_id = @ws;
DELETE FROM task_baseline        WHERE workspace_id = @ws;
DELETE FROM version_task        WHERE workspace_id = @ws;
DELETE FROM attachment          WHERE workspace_id = @ws;
DELETE FROM demand_doc_link     WHERE workspace_id = @ws;
DELETE FROM demand_log          WHERE workspace_id = @ws;
DELETE FROM demand              WHERE workspace_id = @ws;
DELETE FROM dev_branch_log      WHERE workspace_id = @ws;
DELETE FROM dev_branch          WHERE workspace_id = @ws;
DELETE FROM requirement_doc_history WHERE workspace_id = @ws;
DELETE FROM req_doc_comment     WHERE workspace_id = @ws;
DELETE FROM req_doc_share        WHERE workspace_id = @ws;
DELETE FROM requirement_doc     WHERE workspace_id = @ws;
DELETE FROM test_case_run       WHERE workspace_id = @ws;
DELETE FROM test_case           WHERE workspace_id = @ws;
DELETE FROM project_version     WHERE workspace_id = @ws;
DELETE FROM project_member      WHERE workspace_id = @ws;
DELETE FROM work_activity        WHERE workspace_id = @ws;
DELETE FROM app_notification    WHERE workspace_id = @ws OR user_id LIKE 'Useed%';
DELETE FROM user_notification_preference WHERE user_id LIKE 'Useed%';
DELETE FROM gantt_share          WHERE workspace_id = @ws;
DELETE FROM saved_view           WHERE workspace_id = @ws;
DELETE FROM user_list_preference WHERE workspace_id = @ws;
DELETE FROM task_watch           WHERE workspace_id = @ws;
DELETE FROM task                 WHERE workspace_id = @ws;
DELETE FROM requirement         WHERE workspace_id = @ws;
DELETE FROM invite              WHERE workspace_id = @ws;
DELETE FROM tag                  WHERE id LIKE 'Gseed%';
DELETE FROM category            WHERE id LIKE 'Cseed%';
DELETE FROM workspace_member    WHERE workspace_id = @ws AND user_id LIKE 'Useed%';
DELETE FROM app_user            WHERE id LIKE 'Useed%';

-- 个人空间保留（admin 的默认空间），恢复默认名称
UPDATE workspace SET name = '我的看板' WHERE id = @ws;

COMMIT;

-- 自检：旧演示数据应全部归零
SELECT '任务' AS 项, COUNT(*) AS 数 FROM task WHERE workspace_id = @ws
UNION ALL SELECT '项目', COUNT(*) FROM requirement WHERE workspace_id = @ws
UNION ALL SELECT '文档', COUNT(*) FROM requirement_doc WHERE workspace_id = @ws
UNION ALL SELECT '旧演示成员', COUNT(*) FROM app_user WHERE id LIKE 'Useed%';

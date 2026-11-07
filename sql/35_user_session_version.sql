USE hourglass;

-- ============================================================================
-- 35_user_session_version.sql · 会话代次持久化（2026-11-04）
--
-- 原会话代次只存在进程内存，重启后丢失；改为 app_user.session_version。
-- 密码/角色变更时递增，旧会话在下一个请求校验失败后失效。
-- ============================================================================

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'session_version');
SET @s := IF(@x = 0,
  'ALTER TABLE app_user ADD COLUMN session_version BIGINT NOT NULL DEFAULT 1 COMMENT ''账号级会话代次；密码/角色变更时递增，旧会话失效'' AFTER role',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

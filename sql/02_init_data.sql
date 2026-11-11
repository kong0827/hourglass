-- ============================================================================
-- sql/02_init_data.sql · 沙漏 Hourglass 初始化基础数据（MySQL 8，utf8mb4）
-- Updated 2026-11-10: 三文件体系之二。必须紧接 sql/01_schema.sql 在空库上执行。
--
-- 内容：
--   1. 管理员账号 admin / admin123（bcrypt；首次登录后请立即在用户管理中改密）
--   2. 共享空间「演示空间」SXh01（admin 为 owner；admin 的个人空间由后端启动时自动创建）
--   3. 该空间的工作项状态（看板列）：待处理 backlog / 进行中 doing / 待验证 verify / 已完成 done
--      · 已完成列处理规则=ended：任务到达该列后停止计时与逾期判定
--      · 列流转矩阵（column_transition）不预置行 = 默认全部放开；可在界面按需收紧
--   4. 优先级档位 P0 紧急 / P1 高 / P2 中 / P3 低（与后端内置默认一致，显式落库便于界面调整）
--   5. 全局 SMTP 配置单例行（enabled=0，占位；在界面配置后生效）
--
-- 说明：
--   · 本文件只做增量 INSERT，不删任何数据；重复执行会因唯一键冲突报错（属预期保护）
--   · 种子演示数据见 sql/03_seed_data.sql（会挂在本文件创建的 SXh01 空间下）
-- 执行：
--   mysql -uroot -p --default-character-set=utf8mb4 hourglass < sql/02_init_data.sql
-- ============================================================================

USE hourglass;
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

START TRANSACTION;

-- admin 账号（密码 admin123，bcrypt；auth 引导逻辑仅在用户表为空时创建账号，与后端启动不冲突）
SET @pw := '$2a$10$QBO0xFZfsFrZglKQ0w5gSeEgc5A5mPSq.09pYPGxysz5tYIE/xfPS';
INSERT INTO app_user (id, username, password_hash, display_name, email, role, disabled, session_version,
                      work_start_hour, work_end_hour, work_max_hours, last_workspace_id, created_at, updated_at) VALUES
  ('Uadmin01', 'admin', @pw, '管理员', NULL, 'admin', 0, 1, 9, 18, 8, 'SXh01', '2026-11-01 09:00:00', '2026-11-01 09:00:00');

-- 共享空间
INSERT INTO workspace (id, name, type, owner_id, created_at, updated_at) VALUES
  ('SXh01', '演示空间', 'shared', 'Uadmin01', '2026-11-01 09:00:00', '2026-11-01 09:00:00');

INSERT INTO workspace_member (workspace_id, user_id, role, created_at) VALUES
  ('SXh01', 'Uadmin01', 'owner', '2026-11-01 09:00:00');

-- 工作项状态（看板列，每空间一套）
INSERT INTO board_column (id, workspace_id, name, color, processing_rule, sort_order, created_at) VALUES
  ('backlog', 'SXh01', '待处理', '#c08a3e', 'normal', 0, '2026-11-01 09:00:00'),
  ('doing',   'SXh01', '进行中', '#5b83ad', 'normal', 1, '2026-11-01 09:00:00'),
  ('verify',  'SXh01', '待验证', '#8f7ee0', 'normal', 2, '2026-11-01 09:00:00'),
  ('done',    'SXh01', '已完成', '#6b8f71', 'ended',  3, '2026-11-01 09:00:00');

-- 优先级档位（与后端内置默认一致）
INSERT INTO workspace_priority (id, workspace_id, code, name, color, created_at) VALUES
  ('SXh01P0', 'SXh01', 'P0', '紧急', '#F04438', '2026-11-01 09:00:00'),
  ('SXh01P1', 'SXh01', 'P1', '高',   '#F79009', '2026-11-01 09:00:00'),
  ('SXh01P2', 'SXh01', 'P2', '中',   '#2E90FA', '2026-11-01 09:00:00'),
  ('SXh01P3', 'SXh01', 'P3', '低',   '#98A2B3', '2026-11-01 09:00:00');

-- 全局 SMTP 配置占位（单例行，id 固定为 1；界面配置后生效）
INSERT INTO mail_setting (id, enabled, host, port, username, password, from_email, updated_at) VALUES
  (1, 0, NULL, 587, NULL, NULL, NULL, '2026-11-01 09:00:00');

COMMIT;

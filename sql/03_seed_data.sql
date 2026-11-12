-- ============================================================================
-- sql/03_seed_data.sql · 沙漏 Hourglass 种子数据（全量覆盖模拟数据，MySQL 8，utf8mb4）
-- Updated 2026-11-11: 对齐测试流转列、项目授权模式与发布计划跨版本结构。用于本地/演示环境功能验证。
--
-- 前置：先执行 sql/01_schema.sql 与 sql/02_init_data.sql（本文件挂在其创建的 SXh01 空间下）。
-- 内容（全部为虚构模拟数据，不指向任何真实人员）：
--   · 8 名模拟用户（统一密码 admin123，同 admin）+ 空间/项目成员关系
--   · 3 个项目（客户门户重构 / 移动端 App 2.0 / 数据看板）、模块、版本
--   · 需求池 12 条覆盖全部状态机（review/pass/plan/rej/canceled）与 WSJF 字段
--   · 需求文档 7 篇（层级/分类/格式/状态覆盖）+ 历史/评论/分享
--   · 工作项 34 条覆盖史诗/故事/任务/缺陷、阻塞、里程碑、循环、软删除、发布标记
--   · 依赖/基线/子任务/评论/标签/关注/工时（计时器+手工补记）/完成快照
--   · 分支池与状态时间线、测试模块/用例/执行流水/计划
--   · 发布闭环：计划（含跨版本关联）、计划任务范围、发布记录（成功/回滚）、条目快照、版本日志
--   · 邀请预分配（invite_project_grant）示例；测试窗口字段（test_started_at / test_finished_at）
--     与按项目分配成员（S9u07 孙敏 project_access_mode=assigned：可见 客户门户重构(写) / 数据看板(读)）
--   · 通知、邀请、分享、保存视图、列表与通知偏好、审计与活动日志、附件行
-- ⚠ 幂等策略：文件开头按 ID 前缀 S9* 与 SXh01 空间清空旧种子后重灌；
--   勿在存有真实业务数据的库上执行（会清掉 SXh01 空间下的动态数据）。
--   attachment 两行仅为数据占位，磁盘上并无对应文件，界面打开会 404。
-- 执行：
--   mysql -uroot -p --default-character-set=utf8mb4 hourglass < sql/03_seed_data.sql
-- ============================================================================

USE hourglass;
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

START TRANSACTION;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- 清理旧种子（S9 前缀 + SXh01 空间的动态数据；02 建的账号/空间/列/优先级不受影响）
-- ---------------------------------------------------------------------------
DELETE FROM app_user WHERE id LIKE 'S9u%';
DELETE FROM workspace_member WHERE user_id LIKE 'S9u%';
DELETE FROM requirement WHERE id LIKE 'S9p%';
DELETE FROM project_member WHERE project_id LIKE 'S9p%';
DELETE FROM category WHERE id LIKE 'S9c%';
DELETE FROM project_version WHERE id LIKE 'S9v%';
DELETE FROM demand WHERE id LIKE 'S9d%';
DELETE FROM demand_doc_link WHERE demand_id LIKE 'S9d%';
DELETE FROM demand_log WHERE demand_id LIKE 'S9d%';
DELETE FROM requirement_doc WHERE id LIKE 'S9o%';
DELETE FROM requirement_doc_history WHERE doc_id LIKE 'S9o%';
DELETE FROM req_doc_comment WHERE doc_id LIKE 'S9o%';
DELETE FROM req_doc_share WHERE doc_id LIKE 'S9o%';
DELETE FROM task WHERE id LIKE 'S9t%';
DELETE FROM task_baseline WHERE task_id LIKE 'S9t%';
DELETE FROM task_dependency WHERE from_task_id LIKE 'S9t%' OR to_task_id LIKE 'S9t%';
DELETE FROM subtask WHERE task_id LIKE 'S9t%';
DELETE FROM task_comment WHERE task_id LIKE 'S9t%';
DELETE FROM task_tag WHERE task_id LIKE 'S9t%';
DELETE FROM task_watch WHERE task_id LIKE 'S9t%';
DELETE FROM time_log WHERE task_id LIKE 'S9t%';
DELETE FROM task_completion_record WHERE workspace_id = 'SXh01';
DELETE FROM task_log WHERE task_id LIKE 'S9t%';
DELETE FROM dev_branch WHERE id LIKE 'S9b%';
DELETE FROM dev_branch_log WHERE branch_id LIKE 'S9b%';
DELETE FROM test_module WHERE id LIKE 'S9m%';
DELETE FROM test_case WHERE id LIKE 'S9tc%';
DELETE FROM test_case_run WHERE case_id LIKE 'S9tc%';
DELETE FROM test_plan WHERE id LIKE 'S9pn%';
DELETE FROM test_plan_case WHERE plan_id LIKE 'S9pn%';
DELETE FROM version_task WHERE task_id LIKE 'S9t%' OR version_id LIKE 'S9v%';
DELETE FROM version_release_plan WHERE id LIKE 'S9rp%';
DELETE FROM version_release_plan_task WHERE plan_id LIKE 'S9rp%';
DELETE FROM version_release_plan_version WHERE plan_id LIKE 'S9rp%';
DELETE FROM version_release WHERE id LIKE 'S9rel%';
DELETE FROM version_release_item WHERE release_id LIKE 'S9rel%';
DELETE FROM version_log WHERE version_id LIKE 'S9v%';
DELETE FROM app_notification WHERE workspace_id = 'SXh01';
DELETE FROM work_activity WHERE workspace_id = 'SXh01';
DELETE FROM audit_log WHERE workspace_id = 'SXh01';
DELETE FROM invite WHERE workspace_id = 'SXh01';
DELETE FROM invite_project_grant WHERE workspace_id = 'SXh01';
DELETE FROM gantt_share WHERE workspace_id = 'SXh01';
DELETE FROM saved_view WHERE user_id LIKE 'S9u%' OR (user_id = 'Uadmin01' AND workspace_id = 'SXh01');
DELETE FROM user_list_preference WHERE user_id LIKE 'S9u%' OR (user_id = 'Uadmin01' AND workspace_id = 'SXh01');
DELETE FROM user_notification_preference WHERE user_id LIKE 'S9u%' OR user_id = 'Uadmin01';
DELETE FROM attachment WHERE target_id LIKE 'S9t%' AND target_kind = 'task';
DELETE FROM column_transition WHERE workspace_id = 'SXh01';
DELETE FROM tag WHERE id LIKE 'S9g%';

-- ---------------------------------------------------------------------------
-- 模拟用户（密码同 admin：admin123）
-- ---------------------------------------------------------------------------
SET @pw := '$2a$10$QBO0xFZfsFrZglKQ0w5gSeEgc5A5mPSq.09pYPGxysz5tYIE/xfPS';
INSERT INTO app_user (id, username, password_hash, display_name, email, role, disabled, session_version,
                      work_start_hour, work_end_hour, work_max_hours, last_workspace_id, created_at, updated_at) VALUES
  ('S9u01', 'zhangsan', @pw, '张伟', 'zhangsan@example.com', 'user', 0, 1, 9, 18, 8, 'SXh01', '2026-09-01 09:00:00', '2026-09-01 09:00:00'),
  ('S9u02', 'lina',     @pw, '李娜', 'lina@example.com',     'user', 0, 1, 9, 18, 8, 'SXh01', '2026-09-01 09:05:00', '2026-09-01 09:05:00'),
  ('S9u03', 'wanghao',  @pw, '王浩', 'wanghao@example.com',  'user', 0, 1, 9, 18, 8, 'SXh01', '2026-09-01 09:10:00', '2026-09-01 09:10:00'),
  ('S9u04', 'liuyang',  @pw, '刘洋', 'liuyang@example.com',  'user', 0, 1, 9, 18, 8, 'SXh01', '2026-09-01 09:15:00', '2026-09-01 09:15:00'),
  ('S9u05', 'chenjing', @pw, '陈静', 'chenjing@example.com', 'user', 0, 1, 9, 18, 8, 'SXh01', '2026-09-01 09:20:00', '2026-09-01 09:20:00'),
  ('S9u06', 'zhaolei',  @pw, '赵磊', 'zhaolei@example.com',  'user', 0, 1, 9, 18, 8, 'SXh01', '2026-09-01 09:25:00', '2026-09-01 09:25:00'),
  ('S9u07', 'sunmin',   @pw, '孙敏', 'sunmin@example.com',   'user', 0, 1, 9, 18, 8, 'SXh01', '2026-09-01 09:30:00', '2026-09-01 09:30:00'),
  ('S9u08', 'zhoutao',  @pw, '周涛', 'zhoutao@example.com',  'user', 0, 1, 9, 18, 8, 'SXh01', '2026-09-01 09:35:00', '2026-09-01 09:35:00');

INSERT INTO workspace_member (workspace_id, user_id, role, project_access_mode, created_at) VALUES
  ('SXh01', 'S9u01', 'admin',  'all',      '2026-09-01 10:00:00'),
  ('SXh01', 'S9u02', 'member', 'all',      '2026-09-01 10:00:00'),
  ('SXh01', 'S9u03', 'member', 'all',      '2026-09-01 10:00:00'),
  ('SXh01', 'S9u04', 'member', 'all',      '2026-09-01 10:00:00'),
  ('SXh01', 'S9u05', 'member', 'all',      '2026-09-01 10:00:00'),
  ('SXh01', 'S9u06', 'member', 'all',      '2026-09-01 10:00:00'),
  ('SXh01', 'S9u07', 'member', 'assigned', '2026-09-01 10:00:00'),
  ('SXh01', 'S9u08', 'viewer', 'all',      '2026-09-01 10:00:00');

-- ---------------------------------------------------------------------------
-- 项目 / 成员可见范围 / 模块 / 版本
-- ---------------------------------------------------------------------------
INSERT INTO requirement (id, workspace_id, name, description, objective, status, owner_user_id,
                         planned_start, planned_end, first_released_at, created_at, updated_at) VALUES
  ('S9p01', 'SXh01', '客户门户重构', '面向外部客户的统一门户，整合登录、首页、消息与账号能力', '客户自助率提升 30%', 'active', 'S9u01', '2026-09-01', '2026-12-31', '2026-10-20', '2026-09-01 10:00:00', '2026-10-20 14:00:00'),
  ('S9p02', 'SXh01', '移动端 App 2.0', '全新视觉与信息架构的移动端第二版', '次日留存提升 5 个点', 'active', 'S9u03', '2026-10-01', '2027-01-31', NULL, '2026-09-15 10:00:00', '2026-11-01 10:00:00'),
  ('S9p03', 'SXh01', '数据看板', '经营数据的可视化看板与导出', '周报制作时间缩短一半', 'done', 'S9u05', '2026-09-01', '2026-10-31', '2026-10-15', '2026-09-01 10:30:00', '2026-10-31 10:00:00');

INSERT INTO project_member (workspace_id, project_id, user_id, access, created_at, updated_at) VALUES
  ('SXh01', 'S9p01', 'Uadmin01', 'write', '2026-09-01 10:00:00', '2026-09-01 10:00:00'),
  ('SXh01', 'S9p01', 'S9u01',    'write', '2026-09-01 10:00:00', '2026-09-01 10:00:00'),
  ('SXh01', 'S9p01', 'S9u02',    'write', '2026-09-01 10:00:00', '2026-09-01 10:00:00'),
  ('SXh01', 'S9p01', 'S9u03',    'write', '2026-09-01 10:00:00', '2026-09-01 10:00:00'),
  ('SXh01', 'S9p01', 'S9u04',    'read',  '2026-09-01 10:00:00', '2026-09-01 10:00:00'),
  ('SXh01', 'S9p01', 'S9u07',    'write', '2026-09-01 10:00:00', '2026-09-01 10:00:00'),
  ('SXh01', 'S9p01', 'S9u08',    'none',  '2026-09-01 10:00:00', '2026-09-01 10:00:00'),
  ('SXh01', 'S9p02', 'Uadmin01', 'write', '2026-09-15 10:00:00', '2026-09-15 10:00:00'),
  ('SXh01', 'S9p02', 'S9u03',    'write', '2026-09-15 10:00:00', '2026-09-15 10:00:00'),
  ('SXh01', 'S9p02', 'S9u06',    'write', '2026-09-15 10:00:00', '2026-09-15 10:00:00'),
  ('SXh01', 'S9p03', 'Uadmin01', 'write', '2026-09-01 10:30:00', '2026-09-01 10:30:00'),
  ('SXh01', 'S9p03', 'S9u05',    'write', '2026-09-01 10:30:00', '2026-09-01 10:30:00'),
  ('SXh01', 'S9p03', 'S9u04',    'write', '2026-09-01 10:30:00', '2026-09-01 10:30:00'),
  ('SXh01', 'S9p03', 'S9u07',    'read',  '2026-09-01 10:30:00', '2026-09-01 10:30:00');

INSERT INTO category (id, workspace_id, project_id, name, color, sort_order, created_at) VALUES
  ('S9c01', 'SXh01', 'S9p01', '前端', '#5b83ad', 0, '2026-09-01 10:00:00'),
  ('S9c02', 'SXh01', 'S9p01', '后端', '#6b8f71', 1, '2026-09-01 10:00:00'),
  ('S9c03', 'SXh01', 'S9p01', '账号', '#c08a3e', 2, '2026-09-01 10:00:00'),
  ('S9c04', 'SXh01', 'S9p02', 'App框架', '#5b83ad', 0, '2026-09-15 10:00:00'),
  ('S9c05', 'SXh01', 'S9p02', '消息', '#8f7ee0', 1, '2026-09-15 10:00:00'),
  ('S9c06', 'SXh01', 'S9p03', '图表', '#c08a3e', 0, '2026-09-01 10:30:00');

INSERT INTO project_version (id, workspace_id, req_id, name, description, status, start_date, target_date, released_at, revision, created_at, updated_at) VALUES
  ('S9v01', 'SXh01', 'S9p01', 'v1.0', '门户首个可用版本：登录、首页、消息中心', 'released', '2026-09-01', '2026-10-20', '2026-10-20 14:00:00', 3, '2026-09-01 10:00:00', '2026-10-20 14:00:00'),
  ('S9v02', 'SXh01', 'S9p01', 'v1.1', '权限矩阵、账号注销与体验优化', 'active', '2026-10-21', '2026-11-30', NULL, 1, '2026-10-21 09:00:00', '2026-11-01 09:00:00'),
  ('S9v03', 'SXh01', 'S9p02', 'v2.0-beta', '移动端二版首个公测', 'planned', '2026-11-01', '2027-01-15', NULL, 0, '2026-10-25 09:00:00', '2026-10-25 09:00:00'),
  ('S9v04', 'SXh01', 'S9p03', 'v1.0', '看板首版：核心图表与导出', 'released', '2026-09-01', '2026-10-15', '2026-10-15 16:00:00', 2, '2026-09-01 10:30:00', '2026-10-15 16:00:00');

-- ---------------------------------------------------------------------------
-- 需求池（状态机 review/pass/plan/rej/canceled 全覆盖）
-- ---------------------------------------------------------------------------
INSERT INTO demand (id, workspace_id, req_id, title, description, source, item_kind, category_id, priority, status,
                    expect_date, planned_start, planned_end, revision, accept_text, version_id, review_note,
                    wsjf_business, wsjf_urgency, wsjf_risk, wsjf_effort, created_by, created_at, updated_at) VALUES
  ('S9d01', 'SXh01', 'S9p01', '首页主题换肤', '支持浅色/深色与品牌主题切换', '客户成功 · 张伟', '新功能', 'S9c01', 'P2', 'review',
   '2026-12-15', NULL, NULL, 0, '提供主题预览与跟随系统开关', NULL, NULL, 8, 6, 4, 3, 'S9u01', '2026-11-02 09:00:00', '2026-11-02 09:00:00'),
  ('S9d02', 'SXh01', 'S9p01', '登录注册流程改版', '手机号+验证码与密码双通道', '客户成功 · 李娜', '新功能', 'S9c03', 'P1', 'pass',
   '2026-09-30', NULL, NULL, 2, '两种方式均可完成注册登录，错误提示明确', NULL, '已评审通过，进入开发', 9, 8, 3, 5, 'S9u02', '2026-09-02 09:00:00', '2026-09-08 10:00:00'),
  ('S9d03', 'SXh01', 'S9p01', '全局搜索', '跨文档、任务与需求的统一搜索入口', '产品 · 王浩', '体验优化', 'S9c01', 'P1', 'review',
   '2026-12-31', NULL, NULL, 1, '搜索结果按类型分组，支持跳转', NULL, NULL, 7, 7, 5, 5, 'S9u03', '2026-10-12 09:00:00', '2026-11-08 15:00:00'),
  ('S9d04', 'SXh01', 'S9p01', '账号注销流程', '自助注销与冷静期', '客户成功 · 李娜', '新功能', 'S9c03', 'P1', 'plan',
   '2026-11-30', '2026-11-10', '2026-11-25', 3, '注销需二次确认并保留 7 天冷静期', 'S9v02', '排期至 v1.1，与权限矩阵同批', 8, 7, 2, 4, 'S9u02', '2026-09-20 09:00:00', '2026-10-28 10:00:00'),
  ('S9d05', 'SXh01', 'S9p02', 'App 全新首页', '卡片式信息流与常用功能聚合', '产品 · 王浩', '新功能', 'S9c04', 'P0', 'pass',
   '2026-12-20', NULL, NULL, 1, '首页加载不超过 1.5 秒', NULL, '评审通过，作为 2.0 首个故事', 9, 9, 4, 6, 'S9u03', '2026-10-02 09:00:00', '2026-10-10 10:00:00'),
  ('S9d06', 'SXh01', 'S9p01', '消息聚合与免打扰', '按应用聚合通知并支持时段免打扰', '客户成功 · 张伟', '体验优化', 'S9c02', 'P2', 'plan',
   '2026-12-10', '2026-11-20', '2026-12-05', 1, '免打扰时段内不产生推送', 'S9v02', '随 v1.1 后半段排期', 6, 5, 3, 3, 'S9u01', '2026-10-05 09:00:00', '2026-10-30 10:00:00'),
  ('S9d07', 'SXh01', 'S9p03', '旧版报表导出修复', '修复导出乱码问题', '运维 · 刘洋', '缺陷', 'S9c06', 'P1', 'rej',
   NULL, NULL, NULL, 0, NULL, NULL, '与 v1.0 已修复项重复，关闭', NULL, NULL, NULL, NULL, 'S9u04', '2026-09-10 09:00:00', '2026-09-11 10:00:00'),
  ('S9d08', 'SXh01', 'S9p01', '会议纪要模板库', '内置常用纪要模板', '行政 · 孙敏', '其他', NULL, 'P3', 'canceled',
   NULL, NULL, NULL, 0, NULL, NULL, '需求方自行撤回', 3, 2, 2, 2, 'S9u07', '2026-09-25 09:00:00', '2026-10-08 10:00:00'),
  ('S9d09', 'SXh01', 'S9p01', '多语言支持', '界面文案中英双语', '海外销售 · 周涛', '新功能', 'S9c01', 'P3', 'review',
   '2027-03-31', NULL, NULL, 0, '首期覆盖门户核心页面', NULL, NULL, 6, 3, 6, 8, 'S9u08', '2026-11-05 09:00:00', '2026-11-05 09:00:00'),
  ('S9d10', 'SXh01', 'S9p02', '移动端离线缓存', '弱网下可浏览最近数据', '客户成功 · 李娜', '新功能', 'S9c04', 'P1', 'pass',
   '2027-01-31', NULL, NULL, 1, '离线可打开最近 7 天数据', NULL, '评审通过，进入 2.0 backlog', 7, 6, 5, 7, 'S9u02', '2026-10-15 09:00:00', '2026-10-22 10:00:00'),
  ('S9d11', 'SXh01', 'S9p03', '看板配色自定义', '用户自定义图表配色', '产品 · 王浩', '体验优化', 'S9c06', 'P3', 'rej',
   NULL, NULL, NULL, 0, NULL, NULL, '当前排期外，暂缓', 4, 2, 1, 3, 'S9u03', '2026-09-18 09:00:00', '2026-09-20 10:00:00'),
  ('S9d12', 'SXh01', 'S9p01', '数据导出 API', '开放任务与工时导出接口', '集成方 · 陈静', '其他', 'S9c02', 'P2', 'review',
   '2027-01-15', NULL, NULL, 0, '提供分页导出与调用方限流', NULL, NULL, 7, 4, 4, 5, 'S9u05', '2026-11-06 09:00:00', '2026-11-06 09:00:00');

INSERT INTO demand_log (workspace_id, demand_id, action, note, change_data, operator, created_at) VALUES
  ('SXh01', 'S9d01', 'create',  '提交评审', NULL, 'S9u01', '2026-11-02 09:00:00'),
  ('SXh01', 'S9d02', 'create',  '提交评审', NULL, 'S9u02', '2026-09-02 09:00:00'),
  ('SXh01', 'S9d02', 'pass',    '评审通过', '{"status":"pass"}', 'Uadmin01', '2026-09-08 10:00:00'),
  ('SXh01', 'S9d03', 'create',  '提交评审', NULL, 'S9u03', '2026-10-12 09:00:00'),
  ('SXh01', 'S9d03', 'reopen',  '补充全局搜索范围后重新提交', '{"status":"review"}', 'S9u03', '2026-11-08 15:00:00'),
  ('SXh01', 'S9d04', 'create',  '提交评审', NULL, 'S9u02', '2026-09-20 09:00:00'),
  ('SXh01', 'S9d04', 'plan',    '排期至 v1.1', '{"versionId":"S9v02"}', 'Uadmin01', '2026-10-28 10:00:00'),
  ('SXh01', 'S9d05', 'create',  '提交评审', NULL, 'S9u03', '2026-10-02 09:00:00'),
  ('SXh01', 'S9d05', 'pass',    '评审通过', '{"status":"pass"}', 'Uadmin01', '2026-10-10 10:00:00'),
  ('SXh01', 'S9d06', 'create',  '提交评审', NULL, 'S9u01', '2026-10-05 09:00:00'),
  ('SXh01', 'S9d06', 'plan',    '随 v1.1 后半段排期', '{"versionId":"S9v02"}', 'Uadmin01', '2026-10-30 10:00:00'),
  ('SXh01', 'S9d07', 'create',  '提交评审', NULL, 'S9u04', '2026-09-10 09:00:00'),
  ('SXh01', 'S9d07', 'rej',     '与 v1.0 已修复项重复', '{"status":"rej"}', 'Uadmin01', '2026-09-11 10:00:00'),
  ('SXh01', 'S9d08', 'create',  '提交评审', NULL, 'S9u07', '2026-09-25 09:00:00'),
  ('SXh01', 'S9d08', 'canceled','需求方撤回', '{"status":"canceled"}', 'S9u07', '2026-10-08 10:00:00'),
  ('SXh01', 'S9d10', 'create',  '提交评审', NULL, 'S9u02', '2026-10-15 09:00:00'),
  ('SXh01', 'S9d10', 'pass',    '评审通过', '{"status":"pass"}', 'Uadmin01', '2026-10-22 10:00:00'),
  ('SXh01', 'S9d11', 'create',  '提交评审', NULL, 'S9u03', '2026-09-18 09:00:00'),
  ('SXh01', 'S9d11', 'rej',     '当前排期外', '{"status":"rej"}', 'Uadmin01', '2026-09-20 10:00:00');

INSERT INTO demand_doc_link (workspace_id, demand_id, doc_id, created_by, created_at) VALUES
  ('SXh01', 'S9d02', 'S9o01', 'S9u01', '2026-09-09 10:00:00'),
  ('SXh01', 'S9d04', 'S9o03', 'S9u02', '2026-10-28 10:30:00');

-- ---------------------------------------------------------------------------
-- 需求文档（层级/分类/格式/状态覆盖）
-- ---------------------------------------------------------------------------
INSERT INTO requirement_doc (id, workspace_id, req_id, parent_id, title, doc_type, content, format, content_brief,
                             status, published_at, sort_order, owner, owner_user_id, created_at, updated_at) VALUES
  ('S9o01', 'SXh01', 'S9p01', NULL, '客户门户重构总体方案', 'requirement',
   '# 背景与目标\n\n客户门户将整合登录、首页、消息与账号能力，目标客户自助率提升 30%。\n\n## 范围\n\n- 登录注册流程改版\n- 首页信息架构与骨架屏\n- 站内消息中心\n\n## 里程碑\n\n- v1.0：2026-10-20 发布\n- v1.1：2026-11-30 发布',
   'markdown', '客户门户整合登录、首页、消息与账号，自助率提升 30%。', 'active', '2026-09-10 10:00:00', 0, '张伟', 'S9u01', '2026-09-02 10:00:00', '2026-10-20 15:00:00'),
  ('S9o02', 'SXh01', 'S9p01', 'S9o01', '消息中心技术设计', 'technical',
   '<h1>消息中心技术设计</h1><p>消息采用单表+已读回执设计，红点计数走缓存聚合，推送走 outbox。</p>', 'html',
   '单表+回执，红点缓存聚合，推送 outbox。', 'active', '2026-09-28 10:00:00', 1, '王浩', 'S9u03', '2026-09-20 10:00:00', '2026-09-28 10:00:00'),
  ('S9o03', 'SXh01', 'S9p01', 'S9o01', '账号注销验收标准', 'acceptance',
   '# 验收标准\n\n1. 注销需二次确认\n2. 保留 7 天冷静期，期间可撤销\n3. 冷静期后账号与个人空间数据清除',
   'markdown', '二次确认、7 天冷静期、到期清除。', 'draft', NULL, 2, '李娜', 'S9u02', '2026-10-28 10:00:00', '2026-10-28 10:00:00'),
  ('S9o04', 'SXh01', 'S9p02', NULL, 'App 2.0 产品概述', 'requirement',
   '# App 2.0\n\n全新视觉与信息架构：卡片式首页、会话消息与离线缓存。', 'markdown',
   '卡片式首页、会话消息与离线缓存。', 'draft', NULL, 0, '王浩', 'S9u03', '2026-09-18 10:00:00', '2026-09-18 10:00:00'),
  ('S9o05', 'SXh01', 'S9p03', NULL, '数据看板需求说明', 'requirement',
   '# 数据看板\n\n核心图表：经营概览、趋势与明细导出。', 'markdown',
   '经营概览、趋势与明细导出。', 'done', '2026-10-12 10:00:00', 0, '陈静', 'S9u05', '2026-09-05 10:00:00', '2026-10-15 16:00:00'),
  ('S9o06', 'SXh01', 'S9p03', 'S9o05', '图表组件清单', 'technical',
   '# 图表组件\n\n- 折线/柱状/环形\n- 下钻与联动\n- 大数据量采样', 'markdown',
   '折线/柱状/环形、下钻联动、大数据量采样。', 'done', '2026-10-12 10:30:00', 1, '陈静', 'S9u05', '2026-09-08 10:00:00', '2026-10-15 16:00:00'),
  ('S9o07', 'SXh01', 'S9p01', NULL, '门户埋点方案', 'technical',
   '# 埋点方案\n\n页面浏览、关键点击与漏斗三档事件，随 v1.1 上线。', 'markdown',
   '浏览、点击、漏斗三档事件。', 'draft', NULL, 3, '张伟', 'S9u01', '2026-10-25 10:00:00', '2026-10-25 10:00:00');

INSERT INTO requirement_doc_history (id, doc_id, workspace_id, version_no, title, content, format, saved_by, saved_by_user_id, created_at) VALUES
  ('S9h01', 'S9o01', 'SXh01', 1, '客户门户重构总体方案', '# 背景与目标\n\n客户门户将整合登录、首页与消息能力。', 'markdown', '张伟', 'S9u01', '2026-09-05 10:00:00'),
  ('S9h02', 'S9o01', 'SXh01', 2, '客户门户重构总体方案', '# 背景与目标\n\n客户门户将整合登录、首页、消息与账号能力。', 'markdown', '张伟', 'S9u01', '2026-09-12 10:00:00'),
  ('S9h03', 'S9o05', 'SXh01', 1, '数据看板需求说明', '# 数据看板\n\n核心图表：经营概览与趋势。', 'markdown', '陈静', 'S9u05', '2026-09-10 10:00:00');

INSERT INTO req_doc_comment (id, workspace_id, doc_id, user_id, content, quote_text, created_at, updated_at) VALUES
  ('S9om01', 'SXh01', 'S9o01', 'S9u02', '里程碑建议给 v1.1 预留回归一周。', 'v1.1：2026-11-30 发布', '2026-09-13 10:00:00', '2026-09-13 10:00:00'),
  ('S9om02', 'SXh01', 'S9o01', 'Uadmin01', '消息中心依赖的 outbox 需要运维评审。', NULL, '2026-09-14 09:30:00', '2026-09-14 09:30:00'),
  ('S9om03', 'SXh01', 'S9o05', 'S9u04', '导出明细建议加上筛选条件透传。', '核心图表：经营概览、趋势与明细导出。', '2026-09-15 14:00:00', '2026-09-15 14:00:00');

INSERT INTO req_doc_share (workspace_id, doc_id, token, created_at, expires_at) VALUES
  ('SXh01', 'S9o01', 'dshare000000000000000000abcdef', '2026-10-01 10:00:00', NULL);

-- ---------------------------------------------------------------------------
-- 工作项（epic/story/task/bug；阻塞/里程碑/循环/软删除/发布标记覆盖）
-- ---------------------------------------------------------------------------
INSERT INTO task (id, workspace_id, title, description, item_type, epic_id, demand_id, severity, environment, reproduce_steps,
                  found_version_id, regression_status, priority, owner, owner_user_id, category_id, board_column,
                  start_date, due_date, req_id, req_doc_id, branch_id, progress, is_milestone, estimate_minutes,
                  is_blocked, blocked_reason, blocked_by_task_id, note, completed_at, published_at, publish_source,
                  published_release_id, recur_type, recur_next_id, remind_at, remind_target, remind_sent, deleted_at,
                  sort_order, created_at, updated_at) VALUES
  ('S9t01', 'SXh01', '门户整体框架', '客户门户一期史诗：信息架构、登录与消息', 'epic', NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, 'P1', '张伟', 'S9u01', '', 'backlog',
   '2026-09-01', '2026-11-30', 'S9p01', NULL, NULL, 40, 0, NULL,
   0, NULL, NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 0, '2026-09-01 10:00:00', '2026-11-05 10:00:00'),
  ('S9t02', 'SXh01', '首页信息架构', '首页卡片分区与导航定稿', 'story', 'S9t01', NULL, NULL, NULL, NULL,
   NULL, NULL, 'P1', '张伟', 'S9u01', 'S9c01', 'done',
   '2026-09-08', '2026-09-25', 'S9p01', 'S9o01', NULL, 100, 0, 480,
   0, NULL, NULL, NULL, '2026-09-25', NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 1, '2026-09-08 09:00:00', '2026-09-25 17:00:00'),
  ('S9t03', 'SXh01', '登录注册流程开发', '手机号+验证码与密码双通道', 'story', 'S9t01', 'S9d02', NULL, NULL, NULL,
   NULL, NULL, 'P1', '李娜', 'S9u02', 'S9c03', 'doing',
   '2026-09-14', '2026-10-09', 'S9p01', 'S9o01', 'S9b01', 70, 0, 960,
   0, NULL, NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 2, '2026-09-14 09:00:00', '2026-11-06 18:00:00'),
  ('S9t04', 'SXh01', '门户首页切图', '首页静态页与响应式适配', 'task', NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, 'P2', '王浩', 'S9u03', 'S9c01', 'doing',
   '2026-09-14', '2026-09-30', 'S9p01', NULL, NULL, 80, 0, 480,
   0, NULL, NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 3, '2026-09-14 09:10:00', '2026-11-07 16:00:00'),
  ('S9t05', 'SXh01', 'SSO 单点登录对接', '对接客户统一认证沙箱', 'task', NULL, 'S9d02', NULL, NULL, NULL,
   NULL, NULL, 'P1', '王浩', 'S9u03', 'S9c03', 'doing',
   '2026-10-12', '2026-11-13', 'S9p01', NULL, NULL, 30, 0, 720,
   1, '等待第三方沙箱开通', 'S9t08', '已发邮件催办', NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 4, '2026-10-12 09:00:00', '2026-11-07 09:30:00'),
  ('S9t06', 'SXh01', '首页性能优化', '首屏资源压缩与懒加载', 'task', NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, 'P2', '李娜', 'S9u02', 'S9c01', 'backlog',
   NULL, '2026-10-23', 'S9p01', NULL, NULL, 0, 0, 480,
   0, NULL, NULL, '依赖首页切图完成', NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 5, '2026-10-01 09:00:00', '2026-10-01 09:00:00'),
  ('S9t07', 'SXh01', '登录后头像不显示', '登录成功后首页头像区域空白', 'bug', NULL, NULL, 'major', 'Chrome 126 / Win11',
   '1. 登录成功\n2. 进入首页\n3. 头像区域空白',
   'S9v01', 'pending', 'P2', '李娜', 'S9u02', 'S9c01', 'test',
   '2026-10-25', '2026-11-12', 'S9p01', NULL, NULL, 90, 0, 240,
   0, NULL, NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 6, '2026-10-25 10:00:00', '2026-11-08 10:00:00'),
  ('S9t08', 'SXh01', '统一鉴权中间件', '网关层统一鉴权与刷新', 'task', NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, 'P1', '王浩', 'S9u03', 'S9c02', 'doing',
   '2026-09-21', '2026-10-16', 'S9p01', NULL, NULL, 85, 0, 720,
   0, NULL, NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 7, '2026-09-21 09:00:00', '2026-11-07 15:00:00'),
  ('S9t09', 'SXh01', '权限矩阵配置', '项目级可见范围配置界面', 'story', 'S9t01', NULL, NULL, NULL, NULL,
   NULL, NULL, 'P2', '张伟', 'S9u01', 'S9c02', 'backlog',
   NULL, '2026-11-27', 'S9p01', NULL, NULL, 0, 0, 600,
   0, NULL, NULL, '与统一鉴权并行启动', NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 8, '2026-10-20 09:00:00', '2026-10-20 09:00:00'),
  ('S9t10', 'SXh01', '门户 API 网关接入', '门户域名接入统一网关', 'task', NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, 'P1', '王浩', 'S9u03', 'S9c02', 'done',
   '2026-09-28', '2026-10-12', 'S9p01', NULL, NULL, 100, 0, 480,
   0, NULL, NULL, NULL, '2026-10-12', '2026-10-20', 'record',
   'S9rel01', NULL, NULL, NULL, 'owner', 0, NULL, 9, '2026-09-28 09:00:00', '2026-10-12 17:30:00'),
  ('S9t11', 'SXh01', '门户静态资源 CDN 化', '静态资源切换 CDN', 'task', NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, 'P2', '李娜', 'S9u02', 'S9c01', 'done',
   '2026-10-08', '2026-10-15', 'S9p01', NULL, NULL, 100, 0, 240,
   0, NULL, NULL, NULL, '2026-10-15', '2026-10-20', 'record',
   'S9rel01', NULL, NULL, NULL, 'owner', 0, NULL, 10, '2026-10-08 09:00:00', '2026-10-15 16:00:00'),
  ('S9t12', 'SXh01', '首页骨架屏', '首屏加载骨架屏', 'task', NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, 'P2', '王浩', 'S9u03', 'S9c01', 'done',
   '2026-10-13', '2026-10-17', 'S9p01', NULL, NULL, 100, 0, 240,
   0, NULL, NULL, NULL, '2026-10-17', '2026-10-20', 'record',
   'S9rel01', NULL, NULL, NULL, 'owner', 0, NULL, 11, '2026-10-13 09:00:00', '2026-10-17 18:00:00'),
  ('S9t13', 'SXh01', '用户反馈入口', '门户右侧悬浮反馈按钮', 'task', NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, 'P3', '张伟', 'S9u01', 'S9c01', 'done',
   '2026-10-05', '2026-10-08', 'S9p01', NULL, NULL, 100, 0, 120,
   0, NULL, NULL, NULL, '2026-10-08', NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 12, '2026-10-05 09:00:00', '2026-10-08 17:00:00'),
  ('S9t14', 'SXh01', '站内消息中心', '消息列表与详情页', 'story', 'S9t01', NULL, NULL, NULL, NULL,
   NULL, NULL, 'P1', '王浩', 'S9u03', 'S9c02', 'done',
   '2026-10-12', '2026-10-25', 'S9p01', 'S9o02', NULL, 100, 0, 960,
   0, NULL, NULL, NULL, '2026-10-25', NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 13, '2026-10-12 09:00:00', '2026-10-25 18:00:00'),
  ('S9t15', 'SXh01', '消息红点逻辑', '未读红点计数与已读清理', 'task', NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, 'P2', '王浩', 'S9u03', 'S9c02', 'done',
   '2026-10-19', '2026-10-26', 'S9p01', NULL, NULL, 100, 0, 240,
   0, NULL, NULL, NULL, '2026-10-26', NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 14, '2026-10-19 09:00:00', '2026-10-26 18:00:00'),
  ('S9t16', 'SXh01', '导出报表偶发 500', '大数据量导出偶发网关超时', 'bug', NULL, NULL, 'critical', 'Chrome 126 / Win11',
   '1. 进入报表页\n2. 选择近一年数据\n3. 点击导出，多次复现 500',
   'S9v01', 'pending', 'P1', '刘洋', 'S9u04', 'S9c02', 'doing',
   '2026-11-02', '2026-11-14', 'S9p01', NULL, 'S9b03', 40, 0, 480,
   0, NULL, NULL, '已定位到网关超时配置', NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 15, '2026-11-02 10:00:00', '2026-11-08 11:00:00'),
  ('S9t17', 'SXh01', '移动端布局错位', '窄屏下首页卡片错位', 'bug', NULL, NULL, 'minor', 'iOS Safari 17',
   '1. 手机打开门户\n2. 进入首页\n3. 横竖屏切换后卡片错位',
   'S9v01', 'pending', 'P3', '张伟', 'S9u01', 'S9c01', 'backlog',
   NULL, '2026-11-28', 'S9p01', NULL, NULL, 0, 0, 120,
   0, NULL, NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 16, '2026-11-03 09:00:00', '2026-11-03 09:00:00'),
  ('S9t18', 'SXh01', '账号注销流程开发', '注销确认与冷静期实现', 'task', NULL, 'S9d04', NULL, NULL, NULL,
   NULL, NULL, 'P1', '李娜', 'S9u02', 'S9c03', 'test',
   '2026-11-10', '2026-11-25', 'S9p01', 'S9o03', NULL, 50, 0, 600,
   0, NULL, NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 17, '2026-11-10 09:00:00', '2026-11-10 09:00:00'),
  ('S9t19', 'SXh01', '操作日志脱敏', '日志中的敏感字段脱敏', 'task', NULL, NULL, NULL, NULL, NULL,
   NULL, 'passed', 'P2', '王浩', 'S9u03', 'S9c02', 'done',
   '2026-10-28', '2026-11-03', 'S9p01', NULL, NULL, 100, 0, 240,
   0, NULL, NULL, NULL, '2026-11-03', NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 18, '2026-10-28 09:00:00', '2026-11-03 17:00:00'),
  ('S9t20', 'SXh01', 'v1.1 发布评审', 'v1.1 版本发布前评审会', 'task', NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, 'P1', '管理员', 'Uadmin01', '', 'doing',
   NULL, '2026-11-20', 'S9p01', NULL, NULL, 0, 1, NULL,
   0, NULL, NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 19, '2026-11-05 09:00:00', '2026-11-05 09:00:00'),
  ('S9t21', 'SXh01', '门户数据埋点', '接入三档埋点事件', 'task', NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, 'P2', '张伟', 'S9u01', 'S9c01', 'done',
   '2026-09-22', '2026-09-30', 'S9p01', 'S9o07', NULL, 100, 0, 360,
   0, NULL, NULL, NULL, '2026-09-30', NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 20, '2026-09-22 09:00:00', '2026-09-30 18:00:00'),
  ('S9t22', 'SXh01', '站内信已读回执', '已读状态同步与聚合', 'task', NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, 'P2', '王浩', 'S9u03', 'S9c02', 'doing',
   '2026-11-02', '2026-11-18', 'S9p01', NULL, NULL, 60, 0, 360,
   0, NULL, NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 21, '2026-11-02 09:00:00', '2026-11-08 17:00:00'),
  ('S9t23', 'SXh01', '每周数据周报整理', '汇总本周看板数据并群发', 'task', NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, 'P3', '赵磊', 'S9u06', '', 'done',
   '2026-11-02', '2026-11-06', 'S9p03', NULL, NULL, 100, 0, 60,
   0, NULL, NULL, NULL, '2026-11-06', NULL, NULL,
   NULL, 'weekly', 'S9t24', NULL, 'owner', 0, NULL, 22, '2026-11-02 09:00:00', '2026-11-06 16:00:00'),
  ('S9t24', 'SXh01', '数据周报整理（下周）', '循环生成的下周周报任务', 'task', NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, 'P3', '赵磊', 'S9u06', '', 'backlog',
   NULL, '2026-11-13', 'S9p03', NULL, NULL, 0, 0, 60,
   0, NULL, NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 23, '2026-11-06 16:00:00', '2026-11-06 16:00:00'),
  ('S9t25', 'SXh01', '门户页脚更新', '更新备案与版权信息', 'task', NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, 'P3', '张伟', 'S9u01', 'S9c01', 'backlog',
   NULL, '2026-11-13', 'S9p01', NULL, NULL, 0, 0, 60,
   0, NULL, NULL, '与法务确认新备案号后再恢复', NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, '2026-11-05 15:00:00', 24, '2026-10-20 09:00:00', '2026-11-05 15:00:00'),
  ('S9t26', 'SXh01', 'App 2.0 主框架', '移动端二版史诗：框架与核心页面', 'epic', NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, 'P1', '王浩', 'S9u03', '', 'backlog',
   '2026-11-01', '2027-01-15', 'S9p02', 'S9o04', NULL, 10, 0, NULL,
   0, NULL, NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 0, '2026-10-25 09:30:00', '2026-11-01 10:00:00'),
  ('S9t27', 'SXh01', '全新首页开发', '卡片式信息流首页', 'story', 'S9t26', 'S9d05', NULL, NULL, NULL,
   NULL, NULL, 'P0', '王浩', 'S9u03', 'S9c04', 'doing',
   '2026-10-26', '2026-11-20', 'S9p02', 'S9o04', 'S9b02', 45, 0, 960,
   0, NULL, NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 1, '2026-10-26 09:00:00', '2026-11-07 18:00:00'),
  ('S9t28', 'SXh01', '推送通道接入', '厂商推送通道整合', 'task', NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, 'P1', '赵磊', 'S9u06', 'S9c05', 'doing',
   '2026-11-02', '2026-11-21', 'S9p02', NULL, NULL, 20, 0, 480,
   1, '等待推送证书', 'S9t29', '证书申请已提交', NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 2, '2026-11-02 09:30:00', '2026-11-07 10:00:00'),
  ('S9t29', 'SXh01', '推送证书申请', '向厂商申请推送证书', 'task', NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, 'P1', '赵磊', 'S9u06', 'S9c05', 'backlog',
   NULL, '2026-11-12', 'S9p02', NULL, NULL, 0, 0, 60,
   0, NULL, NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 3, '2026-11-02 09:35:00', '2026-11-02 09:35:00'),
  ('S9t30', 'SXh01', '消息会话列表', '会话聚合列表页', 'story', 'S9t26', NULL, NULL, NULL, NULL,
   NULL, NULL, 'P2', '王浩', 'S9u03', 'S9c05', 'backlog',
   NULL, '2026-12-05', 'S9p02', NULL, NULL, 0, 0, 600,
   0, NULL, NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 4, '2026-11-01 10:00:00', '2026-11-01 10:00:00'),
  ('S9t31', 'SXh01', '启动页白屏', '部分安卓机启动页白屏', 'bug', NULL, NULL, 'blocker', 'Android 14 / Pixel 8',
   '1. 安装 v2.0-beta\n2. 冷启动\n3. 启动页停留后白屏',
   NULL, 'pending', 'P0', '王浩', 'S9u03', 'S9c04', 'testing',
   '2026-11-05', '2026-11-11', 'S9p02', NULL, NULL, 80, 0, 240,
   0, NULL, NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 5, '2026-11-05 11:00:00', '2026-11-09 16:00:00'),
  ('S9t32', 'SXh01', '手势返回适配', '全面屏手势返回适配', 'task', NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, 'P2', '赵磊', 'S9u06', 'S9c04', 'done',
   '2026-10-28', '2026-11-04', 'S9p02', NULL, NULL, 100, 0, 240,
   0, NULL, NULL, NULL, '2026-11-04', NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 6, '2026-10-28 09:00:00', '2026-11-04 18:00:00'),
  ('S9t33', 'SXh01', '看板图表组件库', '折线/柱状/环形组件封装', 'task', NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, 'P1', '陈静', 'S9u05', 'S9c06', 'done',
   '2026-09-15', '2026-10-10', 'S9p03', 'S9o06', 'S9b04', 100, 0, 960,
   0, NULL, NULL, NULL, '2026-10-10', NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 0, '2026-09-15 09:00:00', '2026-10-10 17:00:00'),
  ('S9t34', 'SXh01', '导出 Excel 精度丢失', '长数字导出后精度丢失', 'bug', NULL, NULL, 'major', 'Chrome 125 / macOS',
   '1. 打开明细导出\n2. 选择订单编号列\n3. 导出后末三位变 0',
   'S9v04', 'passed', 'P1', '刘洋', 'S9u04', 'S9c06', 'done',
   '2026-10-20', '2026-10-28', 'S9p03', NULL, NULL, 100, 0, 240,
   0, NULL, NULL, NULL, '2026-10-28', NULL, NULL,
   NULL, NULL, NULL, NULL, 'owner', 0, NULL, 1, '2026-10-20 10:00:00', '2026-10-28 16:00:00');

-- 测试窗口示例：S9t31 测试中（计时起点）；S9t02 / S9t13 已通过测试，窗口留痕
UPDATE task SET test_started_at = '2026-11-10' WHERE id = 'S9t31';
UPDATE task SET test_started_at = '2026-09-20', test_finished_at = '2026-09-24' WHERE id = 'S9t02';
UPDATE task SET test_started_at = '2026-10-05', test_finished_at = '2026-10-08' WHERE id = 'S9t13';

INSERT INTO task_dependency (id, workspace_id, from_task_id, to_task_id, dep_type, lag_days, created_at) VALUES
  ('S9td01', 'SXh01', 'S9t04', 'S9t06', 'FS', 0, '2026-10-01 09:00:00'),
  ('S9td02', 'SXh01', 'S9t08', 'S9t09', 'SS', 1, '2026-10-20 09:00:00'),
  ('S9td03', 'SXh01', 'S9t03', 'S9t14', 'FS', 0, '2026-10-12 09:00:00'),
  ('S9td04', 'SXh01', 'S9t12', 'S9t10', 'FF', -2, '2026-10-13 09:00:00');

INSERT INTO task_baseline (workspace_id, task_id, start_date, due_date, captured_at) VALUES
  ('SXh01', 'S9t03', '2026-09-14', '2026-10-09', '2026-09-12 10:00:00'),
  ('SXh01', 'S9t04', '2026-09-14', '2026-09-30', '2026-09-12 10:00:00'),
  ('SXh01', 'S9t06', '2026-10-01', '2026-10-23', '2026-09-12 10:00:00'),
  ('SXh01', 'S9t27', '2026-10-01', '2026-11-20', '2026-10-25 09:30:00');

INSERT INTO subtask (task_id, workspace_id, title, done, created_at, updated_at) VALUES
  ('S9t03', 'SXh01', '验证码通道联调', 1, '2026-09-14 10:00:00', '2026-09-20 10:00:00'),
  ('S9t03', 'SXh01', '密码找回流程', 1, '2026-09-14 10:05:00', '2026-09-28 10:00:00'),
  ('S9t03', 'SXh01', '第三方沙箱联调', 0, '2026-09-14 10:10:00', '2026-09-14 10:10:00'),
  ('S9t18', 'SXh01', '注销二次确认弹窗', 1, '2026-11-10 09:30:00', '2026-11-10 11:00:00'),
  ('S9t18', 'SXh01', '冷静期撤销接口', 0, '2026-11-10 09:35:00', '2026-11-10 09:35:00'),
  ('S9t27', 'SXh01', '首页卡片组件', 1, '2026-10-26 10:00:00', '2026-11-02 10:00:00'),
  ('S9t27', 'SXh01', '下拉刷新交互', 0, '2026-10-26 10:05:00', '2026-10-26 10:05:00');

INSERT INTO task_comment (task_id, workspace_id, author_id, author_name, content, created_at) VALUES
  ('S9t16', 'SXh01', 'S9u04', '刘洋', '复现步骤已补充，网关侧超时 30s，导出峰值超过 45s。', '2026-11-03 10:00:00'),
  ('S9t16', 'SXh01', 'Uadmin01', '管理员', '先出流式导出的临时方案，评审后再定长期方案。', '2026-11-03 11:00:00'),
  ('S9t03', 'SXh01', 'S9u01', '张伟', '沙箱开通后再联调第三方登录。', '2026-10-13 09:30:00'),
  ('S9t27', 'SXh01', 'S9u06', '赵磊', '卡片阴影建议跟随主题色。', '2026-11-05 15:00:00');

INSERT INTO task_watch (task_id, workspace_id, user_id, created_at) VALUES
  ('S9t16', 'SXh01', 'Uadmin01', '2026-11-03 11:00:00'),
  ('S9t16', 'SXh01', 'S9u02', '2026-11-03 09:00:00'),
  ('S9t03', 'SXh01', 'S9u01', '2026-09-15 09:00:00');

INSERT INTO tag (id, workspace_id, name, created_at) VALUES
  ('S9g01', 'SXh01', '用户体验', '2026-09-02 10:00:00'),
  ('S9g02', 'SXh01', '性能', '2026-09-02 10:00:00'),
  ('S9g03', 'SXh01', '安全', '2026-09-02 10:00:00');

INSERT INTO task_tag (task_id, tag_id, workspace_id) VALUES
  ('S9t02', 'S9g01', 'SXh01'),
  ('S9t04', 'S9g02', 'SXh01'),
  ('S9t08', 'S9g03', 'SXh01'),
  ('S9t06', 'S9g02', 'SXh01');

INSERT INTO version_task (task_id, workspace_id, version_id, created_at) VALUES
  ('S9t10', 'SXh01', 'S9v01', '2026-09-28 10:00:00'),
  ('S9t11', 'SXh01', 'S9v01', '2026-10-08 10:00:00'),
  ('S9t12', 'SXh01', 'S9v01', '2026-10-13 10:00:00'),
  ('S9t04', 'SXh01', 'S9v02', '2026-10-28 10:00:00'),
  ('S9t18', 'SXh01', 'S9v02', '2026-11-10 09:00:00'),
  ('S9t27', 'SXh01', 'S9v03', '2026-10-26 10:00:00'),
  ('S9t31', 'SXh01', 'S9v03', '2026-11-05 11:00:00');

-- ---------------------------------------------------------------------------
-- 工时（计时器 + 手工补记）
-- ---------------------------------------------------------------------------
INSERT INTO time_log (task_id, workspace_id, user_id, started_at, ended_at, minutes, origin, note) VALUES
  ('S9t03', 'SXh01', 'S9u02', '2026-09-14 09:30:00', '2026-09-14 11:30:00', 120, 'timer', NULL),
  ('S9t03', 'SXh01', 'S9u02', '2026-09-15 14:00:00', '2026-09-15 17:00:00', 180, 'timer', NULL),
  ('S9t03', 'SXh01', 'S9u02', '2026-11-06 10:00:00', '2026-11-06 12:00:00', 120, 'timer', NULL),
  ('S9t04', 'SXh01', 'S9u03', '2026-09-16 09:30:00', '2026-09-16 12:00:00', 150, 'timer', NULL),
  ('S9t04', 'SXh01', 'S9u03', '2026-11-07 14:00:00', '2026-11-07 16:00:00', 120, 'timer', NULL),
  ('S9t08', 'SXh01', 'S9u03', '2026-09-22 09:30:00', '2026-09-22 12:30:00', 180, 'timer', NULL),
  ('S9t08', 'SXh01', 'S9u03', '2026-09-23 14:00:00', '2026-09-23 17:30:00', 210, 'timer', NULL),
  ('S9t10', 'SXh01', 'S9u03', '2026-10-10 09:30:00', '2026-10-10 12:00:00', 150, 'timer', NULL),
  ('S9t10', 'SXh01', 'S9u03', '2026-10-12 15:00:00', '2026-10-12 16:30:00', 90, 'manual', '网关联调会后补记'),
  ('S9t12', 'SXh01', 'S9u03', '2026-10-15 09:30:00', '2026-10-15 12:00:00', 150, 'timer', NULL),
  ('S9t21', 'SXh01', 'S9u01', '2026-09-24 09:30:00', '2026-09-24 11:30:00', 120, 'timer', NULL),
  ('S9t21', 'SXh01', 'S9u01', '2026-09-29 14:00:00', '2026-09-29 15:00:00', 60, 'manual', '埋点文档整理补记'),
  ('S9t27', 'SXh01', 'S9u03', '2026-11-05 09:30:00', '2026-11-05 12:00:00', 150, 'timer', NULL),
  ('S9t27', 'SXh01', 'S9u03', '2026-11-06 14:00:00', '2026-11-06 17:00:00', 180, 'timer', NULL),
  ('S9t28', 'SXh01', 'S9u06', '2026-11-05 10:00:00', '2026-11-05 11:00:00', 60, 'timer', NULL),
  ('S9t33', 'SXh01', 'S9u05', '2026-09-18 09:30:00', '2026-09-18 12:00:00', 150, 'timer', NULL),
  ('S9t33', 'SXh01', 'S9u05', '2026-09-25 14:00:00', '2026-09-25 16:00:00', 120, 'manual', '组件评审会补记'),
  ('S9t34', 'SXh01', 'S9u04', '2026-10-22 09:30:00', '2026-10-22 11:30:00', 120, 'timer', NULL);

-- ---------------------------------------------------------------------------
-- 完成快照（与已完成任务对应）
-- ---------------------------------------------------------------------------
INSERT INTO task_completion_record (workspace_id, task_id, title, description, req_id, req_name, req_doc_id, req_doc_title,
                                   owner, owner_user_id, category, priority, start_date, completed_at,
                                   first_started_at, last_ended_at, total_minutes, created_at) VALUES
  ('SXh01', 'S9t02', '首页信息架构', '首页卡片分区与导航定稿', 'S9p01', '客户门户重构', 'S9o01', '客户门户重构总体方案',
   '张伟', 'S9u01', '前端', 'P1', '2026-09-08', '2026-09-25', '2026-09-08 09:30:00', '2026-09-25 17:00:00', 480, '2026-09-25 17:05:00'),
  ('SXh01', 'S9t10', '门户 API 网关接入', '门户域名接入统一网关', 'S9p01', '客户门户重构', NULL, NULL,
   '王浩', 'S9u03', '后端', 'P1', '2026-09-28', '2026-10-12', '2026-10-10 09:30:00', '2026-10-12 17:30:00', 240, '2026-10-12 17:35:00'),
  ('SXh01', 'S9t11', '门户静态资源 CDN 化', '静态资源切换 CDN', 'S9p01', '客户门户重构', NULL, NULL,
   '李娜', 'S9u02', '前端', 'P2', '2026-10-08', '2026-10-15', '2026-10-08 09:30:00', '2026-10-15 16:00:00', 240, '2026-10-15 16:05:00'),
  ('SXh01', 'S9t12', '首页骨架屏', '首屏加载骨架屏', 'S9p01', '客户门户重构', NULL, NULL,
   '王浩', 'S9u03', '前端', 'P2', '2026-10-13', '2026-10-17', '2026-10-15 09:30:00', '2026-10-17 18:00:00', 150, '2026-10-17 18:05:00'),
  ('SXh01', 'S9t13', '用户反馈入口', '门户右侧悬浮反馈按钮', 'S9p01', '客户门户重构', NULL, NULL,
   '张伟', 'S9u01', '前端', 'P3', '2026-10-05', '2026-10-08', '2026-10-05 09:30:00', '2026-10-08 17:00:00', 120, '2026-10-08 17:05:00'),
  ('SXh01', 'S9t14', '站内消息中心', '消息列表与详情页', 'S9p01', '客户门户重构', 'S9o02', '消息中心技术设计',
   '王浩', 'S9u03', '后端', 'P1', '2026-10-12', '2026-10-25', '2026-10-12 09:30:00', '2026-10-25 18:00:00', 960, '2026-10-25 18:05:00'),
  ('SXh01', 'S9t15', '消息红点逻辑', '未读红点计数与已读清理', 'S9p01', '客户门户重构', NULL, NULL,
   '王浩', 'S9u03', '后端', 'P2', '2026-10-19', '2026-10-26', '2026-10-19 09:30:00', '2026-10-26 18:00:00', 240, '2026-10-26 18:05:00'),
  ('SXh01', 'S9t19', '操作日志脱敏', '日志中的敏感字段脱敏', 'S9p01', '客户门户重构', NULL, NULL,
   '王浩', 'S9u03', '后端', 'P2', '2026-10-28', '2026-11-03', '2026-10-28 09:30:00', '2026-11-03 17:00:00', 240, '2026-11-03 17:05:00'),
  ('SXh01', 'S9t21', '门户数据埋点', '接入三档埋点事件', 'S9p01', '客户门户重构', 'S9o07', '门户埋点方案',
   '张伟', 'S9u01', '前端', 'P2', '2026-09-22', '2026-09-30', '2026-09-24 09:30:00', '2026-09-30 18:00:00', 180, '2026-09-30 18:05:00'),
  ('SXh01', 'S9t23', '每周数据周报整理', '汇总本周看板数据并群发', 'S9p03', '数据看板', NULL, NULL,
   '赵磊', 'S9u06', '', 'P3', '2026-11-02', '2026-11-06', '2026-11-06 15:00:00', '2026-11-06 16:00:00', 60, '2026-11-06 16:05:00'),
  ('SXh01', 'S9t32', '手势返回适配', '全面屏手势返回适配', 'S9p02', '移动端 App 2.0', NULL, NULL,
   '赵磊', 'S9u06', 'App框架', 'P2', '2026-10-28', '2026-11-04', '2026-10-28 09:30:00', '2026-11-04 18:00:00', 240, '2026-11-04 18:05:00'),
  ('SXh01', 'S9t33', '看板图表组件库', '折线/柱状/环形组件封装', 'S9p03', '数据看板', 'S9o06', '图表组件清单',
   '陈静', 'S9u05', '图表', 'P1', '2026-09-15', '2026-10-10', '2026-09-18 09:30:00', '2026-10-10 17:00:00', 270, '2026-10-10 17:05:00'),
  ('SXh01', 'S9t34', '导出 Excel 精度丢失', '长数字导出后精度丢失', 'S9p03', '数据看板', NULL, NULL,
   '刘洋', 'S9u04', '图表', 'P1', '2026-10-20', '2026-10-28', '2026-10-22 09:30:00', '2026-10-28 16:00:00', 120, '2026-10-28 16:05:00');

INSERT INTO task_log (task_id, workspace_id, actor_id, action, detail, change_data, from_column, to_column, created_at) VALUES
  ('S9t03', 'SXh01', 'S9u01', 'create', '创建任务', NULL, NULL, NULL, '2026-09-14 09:00:00'),
  ('S9t03', 'SXh01', 'S9u01', 'move', '开始处理', NULL, 'backlog', 'doing', '2026-09-14 09:30:00'),
  ('S9t16', 'SXh01', 'S9u04', 'create', '提测转缺陷', NULL, NULL, NULL, '2026-11-02 10:00:00'),
  ('S9t16', 'SXh01', 'S9u04', 'move', '开始修复', NULL, 'test', 'doing', '2026-11-02 14:00:00'),
  ('S9t25', 'SXh01', 'S9u01', 'delete', '移入回收站：等待新备案号', NULL, NULL, NULL, '2026-11-05 15:00:00'),
  ('S9t23', 'SXh01', 'S9u06', 'move', '本周周报完成', NULL, 'doing', 'done', '2026-11-06 16:00:00'),
  ('S9t02', 'SXh01', 'S9u01', 'move', '信息架构定稿', NULL, 'doing', 'done', '2026-09-25 17:00:00');

-- ---------------------------------------------------------------------------
-- 分支池与时间线
-- ---------------------------------------------------------------------------
INSERT INTO dev_branch (id, workspace_id, req_id, name, status, owner, owner_user_id, target_branch, note,
                        dev_at, test_at, merge_at, released_at, sort_order, created_at, updated_at) VALUES
  ('S9b01', 'SXh01', 'S9p01', 'feature/login', 'dev', '张伟', 'S9u01', 'main', '登录注册流程', 
   '2026-09-14 09:00:00', NULL, NULL, NULL, 0, '2026-09-14 09:00:00', '2026-11-06 18:00:00'),
  ('S9b02', 'SXh01', 'S9p02', 'feature/app-home', 'dev', '王浩', 'S9u03', 'develop', 'App 2.0 首页',
   '2026-10-26 09:00:00', NULL, NULL, NULL, 1, '2026-10-26 09:00:00', '2026-11-07 18:00:00'),
  ('S9b03', 'SXh01', 'S9p01', 'fix/export-timeout', 'testing', '刘洋', 'S9u04', 'main', '导出超时修复',
   '2026-11-02 10:00:00', '2026-11-08 09:00:00', NULL, NULL, 2, '2026-11-02 10:00:00', '2026-11-08 09:00:00'),
  ('S9b04', 'SXh01', 'S9p03', 'feature/dashboard-v2', 'merging', '陈静', 'S9u05', 'main', '看板组件库',
   '2026-09-15 09:00:00', '2026-10-10 10:00:00', '2026-10-13 09:00:00', NULL, 3, '2026-09-15 09:00:00', '2026-10-13 09:00:00'),
  ('S9b05', 'SXh01', NULL, 'release/1.0', 'released', '管理员', 'Uadmin01', 'main', 'v1.0 发布分支',
   '2026-10-01 09:00:00', '2026-10-12 09:00:00', '2026-10-18 09:00:00', '2026-10-20 14:00:00', 4, '2026-10-01 09:00:00', '2026-10-20 14:00:00'),
  ('S9b06', 'SXh01', 'S9p03', 'hotfix/export-precision', 'dev', '刘洋', 'S9u04', 'main', '导出精度丢失修复',
   '2026-10-20 10:00:00', NULL, NULL, NULL, 5, '2026-10-20 10:00:00', '2026-10-28 16:00:00');

INSERT INTO dev_branch_log (id, workspace_id, branch_id, action, from_status, to_status, detail, actor_name, actor_user_id, created_at) VALUES
  ('S9bl01', 'SXh01', 'S9b01', 'create', NULL, 'dev', '创建分支', '张伟', 'S9u01', '2026-09-14 09:00:00'),
  ('S9bl02', 'SXh01', 'S9b02', 'create', NULL, 'dev', '创建分支', '王浩', 'S9u03', '2026-10-26 09:00:00'),
  ('S9bl03', 'SXh01', 'S9b03', 'create', NULL, 'dev', '创建修复分支', '刘洋', 'S9u04', '2026-11-02 10:00:00'),
  ('S9bl04', 'SXh01', 'S9b03', 'status', 'dev', 'testing', '提交测试', '刘洋', 'S9u04', '2026-11-08 09:00:00'),
  ('S9bl05', 'SXh01', 'S9b04', 'create', NULL, 'dev', '创建分支', '陈静', 'S9u05', '2026-09-15 09:00:00'),
  ('S9bl06', 'SXh01', 'S9b04', 'status', 'dev', 'testing', '提交测试', '陈静', 'S9u05', '2026-10-10 10:00:00'),
  ('S9bl07', 'SXh01', 'S9b04', 'status', 'testing', 'merging', '测试通过，待合并', '陈静', 'S9u05', '2026-10-13 09:00:00'),
  ('S9bl08', 'SXh01', 'S9b05', 'status', 'merging', 'released', 'v1.0 发布完成', '管理员', 'Uadmin01', '2026-10-20 14:00:00'),
  ('S9bl09', 'SXh01', 'S9b06', 'create', NULL, 'dev', '创建热修分支', '刘洋', 'S9u04', '2026-10-20 10:00:00');

-- ---------------------------------------------------------------------------
-- 测试模块 / 用例 / 执行流水 / 计划
-- ---------------------------------------------------------------------------
INSERT INTO test_module (id, workspace_id, req_id, name, sort_order, created_at) VALUES
  ('S9m01', 'SXh01', 'S9p01', '登录模块', 0, '2026-09-10 10:00:00'),
  ('S9m02', 'SXh01', 'S9p01', '门户首页', 1, '2026-09-10 10:00:00'),
  ('S9m03', 'SXh01', 'S9p02', '消息', 0, '2026-10-25 10:00:00'),
  ('S9m04', 'SXh01', 'S9p03', '图表', 0, '2026-09-12 10:00:00');

INSERT INTO test_case (id, workspace_id, req_id, demand_id, title, precondition, module, priority, steps,
                       latest_status, latest_note, latest_by, latest_by_user_id, latest_at, latest_bug_task_id,
                       created_at, updated_at) VALUES
  ('S9tc01', 'SXh01', 'S9p01', 'S9d02', '密码错误提示', '已注册账号', '登录模块', 'P1',
   '[{"action":"输入错误密码登录","expected":"提示密码错误且不泄露账号是否存在"}]',
   'passed', NULL, '李娜', 'S9u02', '2026-10-05 10:00:00', NULL, '2026-09-10 10:00:00', '2026-10-05 10:00:00'),
  ('S9tc02', 'SXh01', 'S9p01', NULL, '登录会话保持', '已登录', '登录模块', 'P0',
   '[{"action":"登录后关闭浏览器再打开","expected":"会话保持有效"}]',
   'passed', NULL, '李娜', 'S9u02', '2026-10-06 10:00:00', NULL, '2026-09-10 10:05:00', '2026-10-06 10:00:00'),
  ('S9tc03', 'SXh01', 'S9p01', NULL, '首页骨架屏展示', '弱网环境', '门户首页', 'P2',
   '[{"action":"弱网打开首页","expected":"先展示骨架屏再渲染内容"}]',
   'passed', NULL, '李娜', 'S9u02', '2026-11-06 10:00:00', NULL, '2026-10-13 10:00:00', '2026-11-06 10:00:00'),
  ('S9tc04', 'SXh01', 'S9p01', NULL, '导出报表大数据量', '近一年数据', '门户首页', 'P1',
   '[{"action":"选择近一年并导出","expected":"导出成功且网关不超时"}]',
   'failed', '网关 30s 超时，导出峰值 45s', '李娜', 'S9u02', '2026-11-06 11:00:00', 'S9t16', '2026-10-14 10:00:00', '2026-11-06 11:00:00'),
  ('S9tc05', 'SXh01', 'S9p02', NULL, '消息红点计数', '收到未读消息', '消息', 'P2',
   '[{"action":"接收新消息","expected":"红点计数加一"}]',
   'blocked', '推送证书未到位', '王浩', 'S9u03', '2026-11-07 10:00:00', NULL, '2026-10-26 10:00:00', '2026-11-07 10:00:00'),
  ('S9tc06', 'SXh01', 'S9p03', NULL, '图表缩放', '打开看板', '图表', 'P1',
   '[{"action":"框选放大趋势图","expected":"时间轴同步缩放"}]',
   'passed', NULL, '陈静', 'S9u05', '2026-10-14 10:00:00', NULL, '2026-09-12 10:00:00', '2026-10-14 10:00:00'),
  ('S9tc07', 'SXh01', 'S9p01', 'S9d04', '注销冷静期', '已登录账号', '登录模块', 'P1',
   '[{"action":"提交注销并二次确认","expected":"进入冷静期且可撤销"}]',
   NULL, NULL, NULL, NULL, NULL, NULL, '2026-10-28 10:30:00', '2026-10-28 10:30:00'),
  ('S9tc08', 'SXh01', 'S9p03', NULL, '周报数据核对', '看板已发布', '图表', 'P3',
   '[{"action":"对照明细核对周报数字","expected":"汇总与明细一致"}]',
   'passed', NULL, '陈静', 'S9u05', '2026-10-16 10:00:00', NULL, '2026-09-12 10:10:00', '2026-10-16 10:00:00');

INSERT INTO test_case_run (id, case_id, workspace_id, status, note, bug_task_id, plan_id, executed_by, executed_by_user_id, created_at) VALUES
  ('S9tr01', 'S9tc01', 'SXh01', 'passed', NULL, NULL, NULL, '李娜', 'S9u02', '2026-10-05 10:00:00'),
  ('S9tr02', 'S9tc02', 'SXh01', 'passed', NULL, NULL, NULL, '李娜', 'S9u02', '2026-10-06 10:00:00'),
  ('S9tr03', 'S9tc03', 'SXh01', 'passed', NULL, NULL, 'S9pn01', '李娜', 'S9u02', '2026-11-06 10:00:00'),
  ('S9tr04', 'S9tc04', 'SXh01', 'failed', '网关 30s 超时', 'S9t16', 'S9pn01', '李娜', 'S9u02', '2026-11-06 11:00:00'),
  ('S9tr05', 'S9tc05', 'SXh01', 'blocked', '推送证书未到位', NULL, NULL, '王浩', 'S9u03', '2026-11-07 10:00:00'),
  ('S9tr06', 'S9tc06', 'SXh01', 'passed', NULL, NULL, 'S9pn02', '陈静', 'S9u05', '2026-10-14 10:00:00'),
  ('S9tr07', 'S9tc08', 'SXh01', 'passed', NULL, NULL, 'S9pn02', '陈静', 'S9u05', '2026-10-16 10:00:00'),
  ('S9tr08', 'S9tc04', 'SXh01', 'passed', '首轮小数据量通过', NULL, NULL, '李娜', 'S9u02', '2026-10-20 10:00:00');

INSERT INTO test_plan (id, workspace_id, req_id, name, version_id, planned_start, planned_end, status, note,
                       created_by, created_by_user_id, created_at, updated_at) VALUES
  ('S9pn01', 'SXh01', 'S9p01', 'v1.1 发布回归', 'S9v02', '2026-11-05', '2026-11-20', 'running', '覆盖权限矩阵、注销与首页优化',
   '管理员', 'Uadmin01', '2026-11-04 09:00:00', '2026-11-08 12:00:00'),
  ('S9pn02', 'SXh01', 'S9p03', 'v1.0 验收测试', 'S9v04', '2026-10-12', '2026-10-18', 'done', '首版验收',
   '陈静', 'S9u05', '2026-10-11 09:00:00', '2026-10-18 17:00:00');

INSERT INTO test_plan_case (id, plan_id, case_id, result, note, executed_by, executed_by_user_id, executed_at, created_at) VALUES
  ('S9pc01', 'S9pn01', 'S9tc03', 'passed', NULL, '李娜', 'S9u02', '2026-11-06 10:00:00', '2026-11-04 09:30:00'),
  ('S9pc02', 'S9pn01', 'S9tc04', 'failed', '网关超时', '李娜', 'S9u02', '2026-11-06 11:00:00', '2026-11-04 09:30:00'),
  ('S9pc03', 'S9pn01', 'S9tc07', NULL, '待注销功能提测', NULL, NULL, NULL, '2026-11-04 09:30:00'),
  ('S9pc04', 'S9pn02', 'S9tc06', 'passed', NULL, '陈静', 'S9u05', '2026-10-14 10:00:00', '2026-10-11 09:30:00'),
  ('S9pc05', 'S9pn02', 'S9tc08', 'passed', NULL, '陈静', 'S9u05', '2026-10-16 10:00:00', '2026-10-11 09:30:00');

-- ---------------------------------------------------------------------------
-- 发布闭环（计划 / 计划任务范围 / 发布记录 / 条目 / 版本日志）
-- ---------------------------------------------------------------------------
INSERT INTO version_release_plan (id, workspace_id, version_id, planned_at, owner_user_id, notes, risks, status,
                                  revision, scope_token, environment, target_keys, coverage, created_at, updated_at) VALUES
  ('S9rp01', 'SXh01', 'S9v02', '2026-11-18 10:00:00', 'Uadmin01', 'v1.1 首次发布计划：首页切图与注销流程', '注销涉及账号数据清除，需演练回滚',
   'draft', 0, NULL, 'staging', '["S9t04", "S9t18"]', 'partial', '2026-11-09 09:00:00', '2026-11-09 09:00:00');

INSERT INTO version_release_plan_task (workspace_id, plan_id, task_id) VALUES
  ('SXh01', 'S9rp01', 'S9t04'),
  ('SXh01', 'S9rp01', 'S9t18');

-- 计划包含的版本（多版本/跨项目）：v1.1 为主版本，移动端 v2.0-beta 同批关联
INSERT INTO version_release_plan_version (workspace_id, plan_id, version_id, req_id) VALUES
  ('SXh01', 'S9rp01', 'S9v02', 'S9p01'),
  ('SXh01', 'S9rp01', 'S9v03', 'S9p02');

INSERT INTO version_release (id, workspace_id, req_id, version_id, plan_id, plan_revision, occurred_at, environment,
                             target_keys, coverage, artifact_ref, artifact_digest, operation, related_release_id,
                             executor_user_id, executor_name, deviation_reason, result, published_on, recorded_at,
                             released_by, released_by_name, version_name, project_name, notes, failure_reason,
                             published_count, excluded_count, idempotency_key, request_hash, plan_snapshot) VALUES
  ('S9rel01', 'SXh01', 'S9p01', 'S9v01', NULL, NULL, '2026-10-20 14:00:00.000000', 'production',
   '["S9t10", "S9t11", "S9t12", "S9t13"]', 'partial', 'https://example.com/artifacts/hourglass-1.0.0.zip',
   '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'deploy', NULL,
   'Uadmin01', '管理员', NULL, 'success', '2026-10-20', '2026-10-20 14:05:00.000000',
   'Uadmin01', '管理员', 'v1.0', '客户门户重构', '门户首个正式版本', NULL,
   3, 1, 'seed-rel-20261020-0001', 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210', '{}'),
  ('S9rel02', 'SXh01', 'S9p01', 'S9v01', NULL, NULL, '2026-10-22 09:00:00.000000', 'production',
   '["S9t10", "S9t11", "S9t12", "S9t13"]', 'partial', 'https://example.com/artifacts/hourglass-1.0.0.zip',
   '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'rollback', 'S9rel01',
   'Uadmin01', '管理员', NULL, 'success', '2026-10-22', '2026-10-22 09:10:00.000000',
   'Uadmin01', '管理员', 'v1.0', '客户门户重构', '回滚演练', NULL,
   0, 0, 'seed-rel-20261022-0002', 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543211', '{}');

INSERT INTO version_release_item (workspace_id, release_id, task_id, title, item_type, owner_user_id, owner_name,
                                  demand_id, demand_title, target_version_id, target_version_name, board_column,
                                  completed_at, disposition, reason, content_summary, work_minutes, estimate_minutes) VALUES
  ('SXh01', 'S9rel01', 'S9t10', '门户 API 网关接入', 'task', 'S9u03', '王浩', NULL, NULL, 'S9v01', 'v1.0', 'done',
   '2026-10-12', 'published', NULL, '门户域名接入统一网关', 240, 480),
  ('SXh01', 'S9rel01', 'S9t11', '门户静态资源 CDN 化', 'task', 'S9u02', '李娜', NULL, NULL, 'S9v01', 'v1.0', 'done',
   '2026-10-15', 'published', NULL, '静态资源切换 CDN', 240, 240),
  ('SXh01', 'S9rel01', 'S9t12', '首页骨架屏', 'task', 'S9u03', '王浩', NULL, NULL, 'S9v01', 'v1.0', 'done',
   '2026-10-17', 'published', NULL, '首屏加载骨架屏', 150, 240),
  ('SXh01', 'S9rel01', 'S9t13', '用户反馈入口', 'task', 'S9u01', '张伟', NULL, NULL, 'S9v01', 'v1.0', 'done',
   '2026-10-08', 'excluded', '反馈入口依赖埋点，随 v1.1 发布', '门户右侧悬浮反馈按钮', 120, 120),
  ('SXh01', 'S9rel02', 'S9t10', '门户 API 网关接入', 'task', 'S9u03', '王浩', NULL, NULL, 'S9v01', 'v1.0', 'done',
   '2026-10-12', 'rolled_back', NULL, '门户域名接入统一网关', 240, 480),
  ('SXh01', 'S9rel02', 'S9t11', '门户静态资源 CDN 化', 'task', 'S9u02', '李娜', NULL, NULL, 'S9v01', 'v1.0', 'done',
   '2026-10-15', 'rolled_back', NULL, '静态资源切换 CDN', 240, 240),
  ('SXh01', 'S9rel02', 'S9t12', '首页骨架屏', 'task', 'S9u03', '王浩', NULL, NULL, 'S9v01', 'v1.0', 'done',
   '2026-10-17', 'rolled_back', NULL, '首屏加载骨架屏', 150, 240),
  ('SXh01', 'S9rel02', 'S9t13', '用户反馈入口', 'task', 'S9u01', '张伟', NULL, NULL, 'S9v01', 'v1.0', 'done',
   '2026-10-08', 'rolled_back', NULL, '门户右侧悬浮反馈按钮', 120, 120);

INSERT INTO version_log (workspace_id, version_id, action, actor_id, reason, change_data, created_at) VALUES
  ('SXh01', 'S9v01', 'create', 'Uadmin01', NULL, NULL, '2026-09-01 10:00:00'),
  ('SXh01', 'S9v01', 'release_success', 'Uadmin01', NULL, '{"releaseId":"S9rel01"}', '2026-10-20 14:05:00'),
  ('SXh01', 'S9v01', 'release_rollback', 'Uadmin01', '回滚演练', '{"releaseId":"S9rel02"}', '2026-10-22 09:10:00'),
  ('SXh01', 'S9v02', 'create', 'Uadmin01', NULL, NULL, '2026-10-21 09:00:00'),
  ('SXh01', 'S9v03', 'create', 'Uadmin01', NULL, NULL, '2026-10-25 09:00:00'),
  ('SXh01', 'S9v04', 'release_success', 'Uadmin01', NULL, NULL, '2026-10-15 16:00:00');

-- ---------------------------------------------------------------------------
-- 通知 / 邀请 / 分享 / 偏好 / 审计 / 活动 / 附件
-- ---------------------------------------------------------------------------
INSERT INTO app_notification (user_id, workspace_id, type, title, body, ref_task_id, ref_kind, ref_id, read_at, created_at) VALUES
  ('S9u02', 'SXh01', 'task_assigned', '新任务：登录注册流程开发', '张伟 将你设为负责人', 'S9t03', NULL, NULL, '2026-09-14 10:00:00', '2026-09-14 09:05:00'),
  ('S9u03', 'SXh01', 'task_assigned', '新任务：门户首页切图', '你被指定为负责人', 'S9t04', NULL, NULL, NULL, '2026-09-14 09:15:00'),
  ('S9u06', 'SXh01', 'task_assigned', '新任务：推送通道接入', '你被指定为负责人', 'S9t28', NULL, NULL, NULL, '2026-11-02 09:35:00'),
  ('S9u04', 'SXh01', 'task_comment', '评论：导出报表偶发 500', '管理员：先出流式导出的临时方案', 'S9t16', NULL, NULL, NULL, '2026-11-03 11:00:00'),
  ('S9u06', 'SXh01', 'task_remind', '提醒：每周数据周报整理', '任务今日到期', 'S9t23', NULL, NULL, '2026-11-06 09:00:00', '2026-11-06 08:00:00'),
  ('Uadmin01', 'SXh01', 'task_due', '临近截止：v1.1 发布评审', '2026-11-20 截止', 'S9t20', NULL, NULL, NULL, '2026-11-09 09:00:00'),
  ('S9u01', 'SXh01', 'task_assigned', '新任务：门户数据埋点', '你被指定为负责人', 'S9t21', NULL, NULL, '2026-09-22 10:00:00', '2026-09-22 09:05:00');

INSERT INTO invite (id, workspace_id, created_by, expires_at, used_count, created_at) VALUES
  ('AB3KZ9QM7X', 'SXh01', 'Uadmin01', '2026-12-31 23:59:59', 3, '2026-09-01 11:00:00');

-- 邀请链接预分配的项目权限（加入时一次性落库为成员的可见范围）
INSERT INTO invite_project_grant (invite_id, workspace_id, project_id, access, created_at) VALUES
  ('AB3KZ9QM7X', 'SXh01', 'S9p01', 'write', '2026-09-01 11:00:00'),
  ('AB3KZ9QM7X', 'SXh01', 'S9p02', 'read',  '2026-09-01 11:00:00');

INSERT INTO gantt_share (workspace_id, token, created_at, expires_at) VALUES
  ('SXh01', 'gshare0000000000000000000abcdef1', '2026-10-15 10:00:00', NULL);

INSERT INTO saved_view (id, user_id, workspace_id, name, params, created_at) VALUES
  ('S9sv01', 'S9u01', 'SXh01', '我的进行中', '{"boardColumn":["doing"],"ownerUserId":["S9u01"]}', '2026-10-20 10:00:00'),
  ('S9sv02', 'Uadmin01', 'SXh01', 'P0 全部', '{"priority":["P0"]}', '2026-11-01 10:00:00');

INSERT INTO user_list_preference (user_id, workspace_id, view_key, view_mode, columns_json, updated_at) VALUES
  ('Uadmin01', 'SXh01', 'task-list', 'table', '["title","owner","priority","dueDate"]', '2026-11-01 10:00:00'),
  ('S9u01', 'SXh01', 'task-list', 'card', '["title","priority","dueDate"]', '2026-10-20 10:00:00');

INSERT INTO user_notification_preference (user_id, event_type, in_app_enabled, email_enabled) VALUES
  ('Uadmin01', 'task_assigned', 1, 0),
  ('S9u01', 'task_assigned', 1, 1),
  ('S9u01', 'task_comment', 1, 0);

INSERT INTO audit_log (workspace_id, actor_id, actor_name, action, target_type, target_id, target_name, result, detail, ip, created_at) VALUES
  (NULL, 'Uadmin01', '管理员', 'login', 'auth', 'Uadmin01', '管理员', 'success', '登录成功', '127.0.0.1', '2026-11-09 08:30:00'),
  (NULL, NULL, 'root', 'login_fail', 'auth', NULL, 'root', 'fail', '密码错误', '192.168.1.20', '2026-11-09 08:35:00'),
  ('SXh01', 'Uadmin01', '管理员', 'member_add', 'workspace', 'SXh01', '演示空间', 'success', '加入成员 周涛（viewer）', '127.0.0.1', '2026-09-01 10:00:00'),
  ('SXh01', 'Uadmin01', '管理员', 'export', 'data', 'SXh01', '任务导出', 'success', '导出全部任务 xlsx', '127.0.0.1', '2026-11-08 17:00:00');

INSERT INTO work_activity (workspace_id, entity_type, entity_id, actor_id, actor_name, action, detail, created_at) VALUES
  ('SXh01', 'project', 'S9p01', 'S9u01', '张伟', 'create', '创建项目 客户门户重构', '2026-09-01 10:00:00'),
  ('SXh01', 'project', 'S9p01', 'S9u01', '张伟', 'update', '更新项目目标与里程碑', '2026-09-20 10:00:00'),
  ('SXh01', 'project', 'S9p01', 'Uadmin01', '管理员', 'first_release', '首版发布 v1.0', '2026-10-20 14:00:00'),
  ('SXh01', 'project', 'S9p02', 'S9u03', '王浩', 'create', '创建项目 移动端 App 2.0', '2026-09-15 10:00:00'),
  ('SXh01', 'requirement_doc', 'S9o01', 'S9u01', '张伟', 'create', '创建文档 客户门户重构总体方案', '2026-09-02 10:00:00'),
  ('SXh01', 'requirement_doc', 'S9o01', 'S9u01', '张伟', 'update', '更新文档并发布', '2026-09-10 10:00:00');

INSERT INTO attachment (id, target_id, target_kind, workspace_id, filename, content_type, size, stored_name, created_at) VALUES
  ('S9at01', 'S9t03', 'task', 'SXh01', '登录流程草图.png', 'image/png', 204800, 'att0000000000000000000000000001', '2026-09-15 10:00:00'),
  ('S9at02', 'S9t16', 'task', 'SXh01', '导出超时日志.txt', 'text/plain', 15360, 'att0000000000000000000000000002', '2026-11-03 10:30:00');

-- ---------------------------------------------------------------------------
-- 看板列流转矩阵示例（已完成列重开需原因，显式落库；测试中退回默认也需原因，未落库）
-- ---------------------------------------------------------------------------
INSERT INTO column_transition (workspace_id, from_column, to_column, rule, updated_at) VALUES
  ('SXh01', 'done', 'backlog', 'reason', '2026-11-01 09:00:00'),
  ('SXh01', 'done', 'doing', 'reason', '2026-11-01 09:00:00');

SET FOREIGN_KEY_CHECKS = 1;
COMMIT;

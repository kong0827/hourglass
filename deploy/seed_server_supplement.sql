-- ============================================================================
-- deploy/seed_server_supplement.sql · 演示数据补充（在 seed_server_demo_public.sql 之后执行）
--
-- 补齐公开演示数据未覆盖的领域：
--   新增 5 篇文档（验收/技术类，markdown）、47 篇既有文档的 doc_type 分类、
--   12 篇文档的历史版本快照、24 条文档评论、21 个测试用例 + 31 条执行流水、
--   14 条任务关注、15 个附件（服务器需配合创建对应物理文件）、甘特/文档只读分享、
--   3 个空间邀请链接、保存的筛选视图、SXm01 优先级显示配置、工作动态。
-- 幂等：先按前缀清理本文件产生的数据再重灌。
-- ============================================================================

USE hourglass;
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @admin := 'Umw5tt2nqz9s9b8sq';

START TRANSACTION;

-- ---------------------------------------------------------------------------
-- 清理旧补充数据（幂等）
-- ---------------------------------------------------------------------------
DELETE FROM requirement_doc_history WHERE id LIKE 'XmDH%';
DELETE FROM req_doc_comment         WHERE id LIKE 'XmDC%';
DELETE FROM test_case_run           WHERE id LIKE 'XmTR%';
DELETE FROM test_case               WHERE id LIKE 'XmTC%';
DELETE FROM task_watch              WHERE workspace_id LIKE 'SXm%';
DELETE FROM attachment              WHERE id LIKE 'XmAT%';
DELETE FROM gantt_share             WHERE workspace_id LIKE 'SXm%';
DELETE FROM req_doc_share           WHERE workspace_id LIKE 'SXm%';
DELETE FROM invite                  WHERE id LIKE 'XMSHARE%';
DELETE FROM workspace_priority      WHERE id LIKE 'XmPR%';
DELETE FROM saved_view              WHERE id LIKE 'XmSV%';
DELETE FROM work_activity           WHERE entity_id LIKE 'XmTC%' OR entity_id IN ('XmD0115','XmD0125','XmD0215','XmD0314','XmD0315');
DELETE FROM demand_doc_link          WHERE doc_id IN ('XmD0115','XmD0125','XmD0215','XmD0314','XmD0315');
DELETE FROM req_doc_comment         WHERE doc_id IN ('XmD0115','XmD0125','XmD0215','XmD0314','XmD0315');
DELETE FROM requirement_doc_history WHERE doc_id IN ('XmD0115','XmD0125','XmD0215','XmD0314','XmD0315');
DELETE FROM requirement_doc         WHERE id IN ('XmD0115','XmD0125','XmD0215','XmD0314','XmD0315');

-- ---------------------------------------------------------------------------
-- 既有 47 篇文档的 doc_type 分类
-- ---------------------------------------------------------------------------
UPDATE requirement_doc
   SET doc_type = 'requirement'
 WHERE workspace_id LIKE 'SXm%'
   AND (title LIKE '%需求说明%' OR title LIKE '%产品需求总览%');

UPDATE requirement_doc
   SET doc_type = 'technical'
 WHERE workspace_id LIKE 'SXm%'
   AND title LIKE '%接口设计%';

-- ---------------------------------------------------------------------------
-- 新增文档（5 篇：3 篇验收 + 2 篇技术，均为 markdown）
-- ---------------------------------------------------------------------------
INSERT INTO requirement_doc (id, workspace_id, req_id, parent_id, title, doc_type, content, format,
                             content_brief, status, published_at, sort_order, owner, owner_user_id,
                             created_at, updated_at) VALUES
  ('XmD0115', 'SXm01', 'XmR011', 'XmD0110', 'V1.2 测试验收标准', 'acceptance',
   '# V1.2 测试验收标准

## 验收范围

智能渠道路由、渠道限流与熔断、路由规则配置页。

## 验收用例

| 用例 | 预期 |
| --- | --- |
| 按费率与成功率动态路由 | 交易按权重分流，各渠道占比与配置误差不超过 5% |
| 单渠道失败率超阈值 | 10 秒内自动熔断并切换备用渠道，恢复后自动纳流 |
| 路由规则配置页 | 保存后 30 秒内全集群生效，历史版本可一键回滚 |
| 渠道维护窗口 | 维护中的渠道不出现在路由候选内 |

## 通过标准

- 核心场景用例 100% 通过，遗留缺陷全部关闭
- 路由决策 P99 延迟不高于 50ms
- 全链路压测 3000 QPS 下整体错误率不超过 0.1%
', 'markdown', 'V1.2 智能渠道路由与限流熔断的验收范围、用例与通过标准', 'active',
   '2026-11-05 10:00:00', 50, '黄丽', 'Xmu07', '2026-11-04 09:00:00', '2026-11-05 10:00:00'),
  ('XmD0125', 'SXm01', 'XmR012', 'XmD0120', '对账数据字典', 'technical',
   '# 对账数据字典

## channel_bill（渠道对账单）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| bill_date | DATE | 账期日期 |
| channel | VARCHAR(16) | 渠道：wxpay / alipay / unionpay |
| order_no | VARCHAR(64) | 渠道订单号 |
| amount | BIGINT | 交易金额（分） |
| status | VARCHAR(16) | 渠道侧交易状态 |

## recon_diff（勾兑差异）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| diff_type | VARCHAR(16) | 长款 / 短款 / 状态不一致 |
| local_amount | BIGINT | 我方账务金额（分） |
| channel_amount | BIGINT | 渠道账单金额（分） |
| handled | TINYINT | 是否已生成差错工单 |

> 金额一律以「分」为整数存储，展示层再换算为元，避免精度丢失。
', 'markdown', '对账核心表结构、字段口径与金额精度约定', 'active',
   '2026-07-28 10:00:00', 98, '刘洋', 'Xmu05', '2026-07-20 09:00:00', '2026-07-28 10:00:00'),
  ('XmD0215', 'SXm02', 'XmR021', 'XmD0210', 'V2.1 测试验收标准', 'acceptance',
   '# V2.1 测试验收标准

## 验收范围

付费会员卡、自动续费签约、会员卡购买页。

## 验收用例

| 用例 | 预期 |
| --- | --- |
| 月卡/季卡/年卡购买 | 支付成功后立即生效，权益实时到账 |
| 自动续费代扣 | 到期前 3 天扣款，失败自动重试一次并推送提醒 |
| 续费管理 | 可随时关闭自动续费，关闭立即生效且不影响当期 |
| 卡种对比页 | 三种卡种的权益差异与价格展示正确 |

## 通过标准

- 支付与续费主链路用例 100% 通过
- 代扣失败场景有明确提示且不产生脏数据
- 会员页 iOS / Android 双端走查无阻断问题
', 'markdown', 'V2.1 会员卡与自动续费的验收范围、用例与通过标准', 'active',
   '2026-11-06 10:00:00', 50, '周敏', 'Xmu09', '2026-11-03 09:00:00', '2026-11-06 10:00:00'),
  ('XmD0314', 'SXm03', 'XmR031', 'XmD0310', 'SSO 安全测试报告', 'acceptance',
   '# SSO 安全测试报告（V1.1 安全加固）

## 测试范围

多因素认证（MFA）、登录审计日志、OAuth2 授权流程。

## 结论

| 项目 | 结果 |
| --- | --- |
| 令牌刷新并发失效 | 通过（修复后回归） |
| 弱口令撞库 | 通过（触发频控锁定） |
| 会话固定 | 通过（登录后强制换发 Session） |
| 外部渗透测试 | 通过（2 个中危已整改复测） |

## 遗留事项

- 异地登录 MFA 提醒文案待产品确认（低危）
- 审计日志保留期默认 180 天，归档策略待定
', 'markdown', 'V1.1 安全加固的渗透与回归测试结论、遗留事项', 'done',
   '2026-07-31 10:00:00', 50, '王浩', 'Xmu03', '2026-07-20 09:00:00', '2026-07-31 10:00:00'),
  ('XmD0315', 'SXm03', 'XmR032', 'XmD0320', '监控告警平台 部署手册', 'technical',
   '# 监控告警平台 部署手册

## 环境要求

- Kubernetes 1.28+，至少 3 worker 节点
- Prometheus 2.45+ 集群模式（2 副本 + Thanos）
- Kafka 3.x 用于指标与告警事件流

## 部署步骤

1. `helm repo add monitor ./charts/monitor`
2. `helm install mp monitor/monitor -n monitor-system --create-namespace`
3. 导入基础告警规则集：`kubectl apply -f rules/base.yaml`
4. 配置值班通知渠道（企微机器人 / 电话）

## 验证

- 大盘地址 `https://monitor.example.com`，默认账号只读
- 注入测试告警 `mp-test alert --rule=smoke`，值班群 1 分钟内收到通知
', 'markdown', '监控告警平台的环境要求、Helm 部署步骤与冒烟验证方法', 'active',
   '2026-10-20 10:00:00', 98, '吴俊', 'Xmu10', '2026-10-15 09:00:00', '2026-10-20 10:00:00');

-- ---------------------------------------------------------------------------
-- 文档历史版本快照（手写早期草稿 + 末版由当前正文复制）
-- ---------------------------------------------------------------------------
INSERT INTO requirement_doc_history (id, doc_id, workspace_id, version_no, title, content, format,
                                     saved_by, saved_by_user_id, created_at) VALUES
  -- XmD0110 聚合支付网关 产品需求总览
  ('XmDH0111', 'XmD0110', 'SXm01', 1, '聚合支付网关 产品需求总览',
   '<h2>项目定位</h2><p>统一接入微信、支付宝渠道的收单网关。</p><h2>版本规划</h2><ul><li>V1.0（2026-06-30）：首版收单</li></ul>',
   'html', '张伟', 'Xmu01', '2026-04-11 10:30:00'),
  ('XmDH0112', 'XmD0110', 'SXm01', 2, '聚合支付网关 产品需求总览',
   '<h2>项目定位</h2><p>统一接入微信、支付宝渠道的收单网关。</p><h2>版本规划</h2><ul><li>V1.0（2026-06-30）：微信/支付宝收单、统一下单与回调</li><li>V1.1（2026-09-15）：银联云闪付与退款链路</li></ul>',
   'html', '张伟', 'Xmu01', '2026-04-11 14:00:00'),
  -- XmD0111 V1.0 需求说明
  ('XmDH0121', 'XmD0111', 'SXm01', 1, 'V1.0 需求说明',
   '<h2>背景与目标</h2><p>首版：微信/支付宝收单、统一下单与回调。</p><h2>需求范围</h2><ul><li><strong>统一下单接口</strong>：屏蔽渠道差异的统一下单 API</li><li><strong>微信支付渠道接入</strong>：JSAPI 模式</li></ul>',
   'html', '张伟', 'Xmu01', '2026-04-12 15:30:00'),
  -- XmD0112 V1.1 需求说明
  ('XmDH0131', 'XmD0112', 'SXm01', 1, 'V1.1 需求说明',
   '<h2>背景与目标</h2><p>迭代：银联云闪付与退款链路。</p><h2>需求范围</h2><ul><li><strong>银联云闪付接入</strong>：银联全渠道 API</li></ul>',
   'html', '张伟', 'Xmu01', '2026-06-25 15:30:00'),
  ('XmDH0132', 'XmD0112', 'SXm01', 2, 'V1.1 需求说明',
   '<h2>背景与目标</h2><p>迭代：银联云闪付与退款链路。</p><h2>需求范围</h2><ul><li><strong>银联云闪付接入</strong>：银联全渠道 API 与证书管理</li><li><strong>退款与部分退款</strong>：原路退款与退款查询</li></ul><h2>验收标准</h2><ol><li>银联云闪付接入功能完整可用</li><li>退款与部分退款功能完整可用</li></ol>',
   'html', '张伟', 'Xmu01', '2026-06-26 10:00:00'),
  -- XmD0119 聚合支付网关 接口设计说明（markdown）
  ('XmDH0141', 'XmD0119', 'SXm01', 1, '聚合支付网关 接口设计说明',
   '# 接口设计说明

## 通用约定

- 统一返回 `{ code, message, data }`
- 时间统一使用 `yyyy-MM-dd HH:mm:ss`',
   'markdown', '王浩', 'Xmu03', '2026-04-17 16:30:00'),
  ('XmDH0142', 'XmD0119', 'SXm01', 2, '聚合支付网关 接口设计说明',
   '# 接口设计说明

## 通用约定

- 统一返回 `{ code, message, data }`
- 时间统一使用 `yyyy-MM-dd HH:mm:ss`
- 幂等接口需携带 `Idempotency-Key`

## 错误码

| 错误码 | 含义 |
| --- | --- |
| 0 | 成功 |
| 40001 | 参数错误 |',
   'markdown', '王浩', 'Xmu03', '2026-04-25 11:00:00'),
  -- XmD0129 商户对账平台 接口设计说明（markdown）
  ('XmDH0151', 'XmD0129', 'SXm01', 1, '商户对账平台 接口设计说明',
   '# 接口设计说明

## 通用约定

- 统一返回 `{ code, message, data }`
- 时间统一使用 `yyyy-MM-dd HH:mm:ss`',
   'markdown', '刘洋', 'Xmu05', '2026-07-03 16:30:00'),
  -- XmD0210 会员中心 产品需求总览
  ('XmDH0211', 'XmD0210', 'SXm02', 1, '会员中心 产品需求总览',
   '<h2>项目定位</h2><p>会员注册、等级、积分与权益体系。</p><h2>版本规划</h2><ul><li>V1.0（2026-05-15）：首版：注册登录与会员资料</li></ul>',
   'html', '李婷', 'Xmu02', '2026-02-28 10:30:00'),
  -- XmD0213 V2.1 需求说明
  ('XmDH0221', 'XmD0213', 'SXm02', 1, 'V2.1 需求说明',
   '<h2>背景与目标</h2><p>付费会员：会员卡与自动续费。</p><h2>需求范围</h2><ul><li><strong>付费会员卡</strong>：月卡、季卡、年卡购买与生效</li></ul>',
   'html', '李婷', 'Xmu02', '2026-08-23 15:30:00'),
  ('XmDH0222', 'XmD0213', 'SXm02', 2, 'V2.1 需求说明',
   '<h2>背景与目标</h2><p>付费会员：会员卡与自动续费。</p><h2>需求范围</h2><ul><li><strong>付费会员卡</strong>：月卡、季卡、年卡购买与生效</li><li><strong>自动续费签约</strong>：微信/支付宝代扣签约与续费</li></ul><h2>验收标准</h2><ol><li>付费会员卡功能完整可用</li><li>自动续费签约功能完整可用</li></ol>',
   'html', '李婷', 'Xmu02', '2026-08-25 10:00:00'),
  -- XmD0310 统一认证 SSO 产品需求总览
  ('XmDH0311', 'XmD0310', 'SXm03', 1, '统一认证 SSO 产品需求总览',
   '<h2>项目定位</h2><p>集团统一身份认证与单点登录。</p><h2>版本规划</h2><ul><li>V1.0（2026-04-30）：首版：OAuth2 单点登录</li></ul>',
   'html', '张伟', 'Xmu01', '2026-02-14 10:30:00'),
  -- XmD0319 统一认证 SSO 接口设计说明（markdown）
  ('XmDH0321', 'XmD0319', 'SXm03', 1, '统一认证 SSO 接口设计说明',
   '# 接口设计说明

## 通用约定

- 统一返回 `{ code, message, data }`
- 时间统一使用 `yyyy-MM-dd HH:mm:ss`',
   'markdown', '王浩', 'Xmu03', '2026-02-20 16:30:00'),
  ('XmDH0322', 'XmD0319', 'SXm03', 2, '统一认证 SSO 接口设计说明',
   '# 接口设计说明

## 通用约定

- 统一返回 `{ code, message, data }`
- 时间统一使用 `yyyy-MM-dd HH:mm:ss`
- 幂等接口需携带 `Idempotency-Key`

## 错误码

| 错误码 | 含义 |
| --- | --- |
| 0 | 成功 |
| 40001 | 参数错误 |',
   'markdown', '王浩', 'Xmu03', '2026-03-01 11:00:00'),
  -- XmD0410 掌上营业厅 App 4.0 产品需求总览
  ('XmDH0411', 'XmD0410', 'SXm04', 1, '掌上营业厅 App 4.0 产品需求总览',
   '<h2>项目定位</h2><p>iOS / Android 双端全新改版。</p><h2>版本规划</h2><ul><li>V4.0（2026-08-15）：全新首页与账户中心</li></ul>',
   'html', '李婷', 'Xmu02', '2026-05-30 10:30:00'),
  -- XmD0419 掌上营业厅 App 4.0 接口设计说明（markdown）
  ('XmDH0421', 'XmD0419', 'SXm04', 1, '掌上营业厅 App 4.0 接口设计说明',
   '# 接口设计说明

## 通用约定

- 统一返回 `{ code, message, data }`
- 时间统一使用 `yyyy-MM-dd HH:mm:ss`',
   'markdown', '孙鹏', 'Xmu12', '2026-06-05 16:30:00'),
  -- XmD0115 V1.2 测试验收标准（markdown）
  ('XmDH0511', 'XmD0115', 'SXm01', 1, 'V1.2 测试验收标准',
   '# V1.2 测试验收标准

## 验收范围

智能渠道路由、渠道限流与熔断。

## 通过标准

- 核心场景用例 100% 通过，遗留缺陷全部关闭',
   'markdown', '黄丽', 'Xmu07', '2026-11-04 16:00:00'),
  -- XmD0215 V2.1 测试验收标准（markdown）
  ('XmDH0521', 'XmD0215', 'SXm02', 1, 'V2.1 测试验收标准',
   '# V2.1 测试验收标准

## 验收范围

付费会员卡、自动续费签约。

## 通过标准

- 支付与续费主链路用例 100% 通过',
   'markdown', '周敏', 'Xmu09', '2026-11-03 16:00:00');

-- 末版快照 = 当前正文（保证每篇多版本文档的版本链以最新内容收尾）
INSERT INTO requirement_doc_history (id, doc_id, workspace_id, version_no, title, content, format,
                                     saved_by, saved_by_user_id, created_at)
SELECT 'XmDH0113', id, workspace_id, 3, title, content, format, owner, owner_user_id, '2026-04-11 16:00:00' FROM requirement_doc WHERE id = 'XmD0110'
UNION ALL SELECT 'XmDH0122', id, workspace_id, 2, title, content, format, owner, owner_user_id, '2026-04-13 10:00:00' FROM requirement_doc WHERE id = 'XmD0111'
UNION ALL SELECT 'XmDH0133', id, workspace_id, 3, title, content, format, owner, owner_user_id, '2026-06-26 15:00:00' FROM requirement_doc WHERE id = 'XmD0112'
UNION ALL SELECT 'XmDH0143', id, workspace_id, 3, title, content, format, owner, owner_user_id, '2026-05-10 11:00:00' FROM requirement_doc WHERE id = 'XmD0119'
UNION ALL SELECT 'XmDH0152', id, workspace_id, 2, title, content, format, owner, owner_user_id, '2026-07-26 11:00:00' FROM requirement_doc WHERE id = 'XmD0129'
UNION ALL SELECT 'XmDH0212', id, workspace_id, 2, title, content, format, owner, owner_user_id, '2026-03-01 10:00:00' FROM requirement_doc WHERE id = 'XmD0210'
UNION ALL SELECT 'XmDH0223', id, workspace_id, 3, title, content, format, owner, owner_user_id, '2026-08-25 15:00:00' FROM requirement_doc WHERE id = 'XmD0213'
UNION ALL SELECT 'XmDH0312', id, workspace_id, 2, title, content, format, owner, owner_user_id, '2026-02-15 10:00:00' FROM requirement_doc WHERE id = 'XmD0310'
UNION ALL SELECT 'XmDH0323', id, workspace_id, 3, title, content, format, owner, owner_user_id, '2026-03-15 11:00:00' FROM requirement_doc WHERE id = 'XmD0319'
UNION ALL SELECT 'XmDH0412', id, workspace_id, 2, title, content, format, owner, owner_user_id, '2026-05-31 10:00:00' FROM requirement_doc WHERE id = 'XmD0410'
UNION ALL SELECT 'XmDH0422', id, workspace_id, 2, title, content, format, owner, owner_user_id, '2026-06-28 11:00:00' FROM requirement_doc WHERE id = 'XmD0419'
UNION ALL SELECT 'XmDH0512', id, workspace_id, 2, title, content, format, owner, owner_user_id, '2026-11-05 10:00:00' FROM requirement_doc WHERE id = 'XmD0115'
UNION ALL SELECT 'XmDH0522', id, workspace_id, 2, title, content, format, owner, owner_user_id, '2026-11-06 10:00:00' FROM requirement_doc WHERE id = 'XmD0215';

-- 文档 updated_at 对齐最后一次快照时间
UPDATE requirement_doc SET updated_at = '2026-04-11 16:00:00' WHERE id = 'XmD0110';
UPDATE requirement_doc SET updated_at = '2026-04-13 10:00:00' WHERE id = 'XmD0111';
UPDATE requirement_doc SET updated_at = '2026-06-26 15:00:00' WHERE id = 'XmD0112';
UPDATE requirement_doc SET updated_at = '2026-03-01 10:00:00' WHERE id = 'XmD0210';
UPDATE requirement_doc SET updated_at = '2026-08-25 15:00:00' WHERE id = 'XmD0213';
UPDATE requirement_doc SET updated_at = '2026-02-15 10:00:00' WHERE id = 'XmD0310';
UPDATE requirement_doc SET updated_at = '2026-05-31 10:00:00' WHERE id = 'XmD0410';

-- ---------------------------------------------------------------------------
-- 需求 ↔ 新文档关联
-- ---------------------------------------------------------------------------
INSERT INTO demand_doc_link (workspace_id, demand_id, doc_id, created_by, created_at) VALUES
  ('SXm01', 'XmQ0113', 'XmD0115', 'Xmu01', '2026-11-05 10:30:00'),
  ('SXm02', 'XmQ0214', 'XmD0215', 'Xmu09', '2026-11-04 10:00:00'),
  ('SXm03', 'XmQ0311', 'XmD0319', 'Xmu03', '2026-05-20 10:00:00');

-- ---------------------------------------------------------------------------
-- 文档评论（24 条）
-- ---------------------------------------------------------------------------
INSERT INTO req_doc_comment (id, workspace_id, doc_id, user_id, content, quote_text, created_at) VALUES
  ('XmDC0101', 'SXm01', 'XmD0110', 'Xmu03', '版本规划里建议补一条 V2.0 的依赖前提：外汇牌照落地后再启动。', NULL, '2026-04-11 17:20:00'),
  ('XmDC0102', 'SXm01', 'XmD0110', 'Xmu04', '干系人部分建议把渠道商务也加进来，联调时要提前约渠道方。', NULL, '2026-04-12 09:40:00'),
  ('XmDC0103', 'SXm01', 'XmD0111', 'Xmu05', '统一下单接口的幂等单号建议直接用商户号+流水号拼接，避免渠道间冲突。', '支持幂等单号', '2026-04-13 10:30:00'),
  ('XmDC0104', 'SXm01', 'XmD0111', 'Xmu07', '验收标准里 P99 延迟 300ms 偏紧，微信侧网络抖动时可能压不住，建议按渠道分档。', NULL, '2026-04-14 11:00:00'),
  ('XmDC0105', 'SXm01', 'XmD0113', 'Xmu10', '熔断切换的 10 秒窗口建议做成可配置，不同渠道容忍度差别很大。', NULL, '2026-09-11 10:00:00'),
  ('XmDC0106', 'SXm01', 'XmD0113', 'Xmu03', '路由权重的灰度方案我们出评审稿，先按 95:5 切流观察一天。', '按费率、成功率、维护窗口动态选择渠道', '2026-09-12 15:20:00'),
  ('XmDC0107', 'SXm01', 'XmD0119', 'Xmu01', '错误码表建议把渠道侧原始码也带上下，排查联调问题会快很多。', NULL, '2026-05-11 09:30:00'),
  ('XmDC0108', 'SXm01', 'XmD0115', 'Xmu01', '验收用例覆盖得比较全，补充一条「熔断恢复后自动纳流」的回归场景即可发布。', NULL, '2026-11-05 14:00:00'),
  ('XmDC0109', 'SXm01', 'XmD0115', 'Xmu03', '通过标准里的压测 QPS 建议与容量规划文档对齐，3000 是峰值还是日常？', NULL, '2026-11-05 15:10:00'),
  ('XmDC0110', 'SXm01', 'XmD0121', 'Xmu05', '账单下载失败重试建议加退避，渠道侧对高频拉取有限流。', NULL, '2026-06-29 10:00:00'),
  ('XmDC0111', 'SXm01', 'XmD0130', 'Xmu10', '规则引擎的内存水位建议加到监控项里，规则热更新时容易抖动。', NULL, '2026-09-12 16:30:00'),
  ('XmDC0112', 'SXm01', 'XmD0125', 'Xmu03', '金额按分存储的约定很好，recon_diff 表建议再加一个差异生成时间索引。', '金额一律以「分」为整数存储', '2026-07-28 11:00:00'),
  ('XmDC0201', 'SXm02', 'XmD0210', 'Xmu08', 'V2.1 的自动续费涉及代扣资质，法务评审要提前两周约。', NULL, '2026-03-02 10:00:00'),
  ('XmDC0202', 'SXm02', 'XmD0210', 'Xmu06', '会员权益页建议加成长值进度条，升级引导转化会更好。', NULL, '2026-03-03 14:00:00'),
  ('XmDC0203', 'SXm02', 'XmD0213', 'Xmu04', '会员卡购买页的三卡对比建议默认选中季卡，客单与续费率比较平衡。', '卡种对比、购买与续费管理', '2026-08-24 10:30:00'),
  ('XmDC0204', 'SXm02', 'XmD0213', 'Xmu09', '代扣失败的提醒文案要区分「余额不足」和「签约过期」，用户诉求完全不同。', NULL, '2026-08-25 11:00:00'),
  ('XmDC0205', 'SXm02', 'XmD0215', 'Xmu02', '验收标准确认，续费重试的那次失败也要发券安抚，方案我来跟进。', NULL, '2026-11-06 11:00:00'),
  ('XmDC0206', 'SXm02', 'XmD0231', 'Xmu06', '秒杀的库存扣减建议用 Redis 预扣 + 异步落库，大促主链路不要走数据库行锁。', NULL, '2026-09-01 10:00:00'),
  ('XmDC0301', 'SXm03', 'XmD0310', 'Xmu03', 'V1.2 组织同步的范围建议先只同步在职人员，离职清理走夜间批处理。', NULL, '2026-02-15 11:00:00'),
  ('XmDC0302', 'SXm03', 'XmD0310', 'Xmu10', 'MFA 的短信通道要双供应商备份，主通道故障时自动切换。', '多因素认证', '2026-02-16 09:30:00'),
  ('XmDC0303', 'SXm03', 'XmD0319', 'Xmu08', '令牌刷新接口的并发竞态已修复，建议把修复说明补进错误码 50001 的备注。', NULL, '2026-03-16 10:00:00'),
  ('XmDC0304', 'SXm03', 'XmD0314', 'Xmu10', '渗透的两个中危整改我复测过，可以关闭。遗留的低危跟踪到 V1.2。', NULL, '2026-07-31 14:00:00'),
  ('XmDC0401', 'SXm04', 'XmD0410', 'Xmu12', 'V4.1 深色模式的色板要和系统级深色联动，注意 Android 12 的动态取色。', NULL, '2026-06-02 10:00:00'),
  ('XmDC0402', 'SXm04', 'XmD0410', 'Xmu13', '无障碍适配建议把 V4.2 的范围先限定在首页和账户中心，全量灰度再扩。', NULL, '2026-06-03 15:00:00');

-- ---------------------------------------------------------------------------
-- 测试用例（21 个，11 个项目全覆盖）+ 执行流水
-- ---------------------------------------------------------------------------
INSERT INTO test_case (id, workspace_id, req_id, title, precondition, steps, latest_status,
                       latest_note, latest_by, latest_by_user_id, latest_at, latest_bug_task_id,
                       created_at, updated_at) VALUES
  ('XmTC0001', 'SXm01', 'XmR011', '统一下单-幂等单号重复提交', '商户号已开通，测试环境可用',
   '[{"action":"用同一幂等单号连续提交两笔统一下单","expected":"第二笔返回成功且复用首笔结果，不产生新订单"}]',
   'passed', NULL, '黄丽', 'Xmu07', '2026-06-12 15:00:00', NULL, '2026-05-10 09:00:00', '2026-06-12 15:00:00'),
  ('XmTC0002', 'SXm01', 'XmR011', '微信 JSAPI-签名验签', '微信渠道证书已配置',
   '[{"action":"篡改签名后发起 JSAPI 下单","expected":"网关拒绝并返回 40001 参数错误"}]',
   'passed', NULL, '黄丽', 'Xmu07', '2026-06-15 16:00:00', NULL, '2026-05-10 09:10:00', '2026-06-15 16:00:00'),
  ('XmTC0003', 'SXm01', 'XmR011', '回调重复通知-幂等处理', '存在一笔已支付成功的订单',
   '[{"action":"模拟渠道对同一订单重发两次支付成功回调","expected":"订单状态只更新一次，账务只入账一次"}]',
   'failed', '重复回调仍产生两次入账，已转缺陷 XmK0011 跟进', '黄丽', 'Xmu07', '2026-11-05 16:40:00', 'XmK0011', '2026-06-10 09:20:00', '2026-11-05 16:40:00'),
  ('XmTC0004', 'SXm01', 'XmR012', '渠道账单-自动下载与补数', '已配置微信/支付宝账单拉取任务',
   '[{"action":"触发日终账单下载任务","expected":"两渠道日账单均落库，缺失文件自动重试补数"}]',
   'passed', NULL, '黄丽', 'Xmu07', '2026-09-12 10:00:00', NULL, '2026-07-05 09:00:00', '2026-09-12 10:00:00'),
  ('XmTC0005', 'SXm01', 'XmR012', '跨日交易-勾兑口径', '存在 23:50 下单、00:05 支付的跨日交易',
   '[{"action":"执行日终勾兑并核对两天的勾兑结果","expected":"跨日交易按支付日入账，两天勾兑均无差异"}]',
   'failed', '跨日交易被计入两个账期，勾兑均出差异，缺陷在 XmK0039 修复中', '黄丽', 'Xmu07', '2026-11-04 15:30:00', 'XmK0039', '2026-07-05 09:10:00', '2026-11-04 15:30:00'),
  ('XmTC0006', 'SXm01', 'XmR012', '调账审批-双人复核', '存在一笔待审批的调账单',
   '[{"action":"第一个复核人通过后尝试直接记账","expected":"系统拦截并提示需第二复核人确认"}]',
   'passed', NULL, '黄丽', 'Xmu07', '2026-10-20 14:00:00', NULL, '2026-09-15 09:00:00', '2026-10-20 14:00:00'),
  ('XmTC0007', 'SXm01', 'XmR013', '规则命中-决策延迟基线', '规则集已加载 200 条规则',
   '[{"action":"构造 500 笔交易流经规则引擎","expected":"单笔决策 P99 延迟不高于 50ms"}]',
   'passed', '热点规则缓存优化后达标', '黄丽', 'Xmu07', '2026-10-12 11:00:00', NULL, '2026-09-20 09:00:00', '2026-10-12 11:00:00'),
  ('XmTC0008', 'SXm01', 'XmR013', '黑白名单-即时生效', '规则配置后台可用',
   '[{"action":"将测试设备号加入黑名单后立即发起交易","expected":"交易被拦截且命中名单规则可追溯"}]',
   'passed', NULL, '黄丽', 'Xmu07', '2026-10-15 15:00:00', NULL, '2026-09-20 09:10:00', '2026-10-15 15:00:00'),
  ('XmTC0009', 'SXm02', 'XmR021', '手机号注册-验证码频控', '短信通道测试环境可用',
   '[{"action":"同一手机号 1 分钟内连续请求 5 次验证码","expected":"第 4 次起被频控拦截并提示稍后再试"}]',
   'passed', NULL, '周敏', 'Xmu09', '2026-04-20 15:00:00', NULL, '2026-03-15 09:00:00', '2026-04-20 15:00:00'),
  ('XmTC0010', 'SXm02', 'XmR021', '积分过期-自动清零', '存在一批 11-01 到期的积分',
   '[{"action":"执行过期积分清零定时任务并核对明细","expected":"过期积分清零、流水留痕，且到期前 30 天有提醒"}]',
   'failed', '过期任务未按期执行且无提醒记录，已转缺陷 XmK0071', '周敏', 'Xmu09', '2026-11-03 16:00:00', 'XmK0071', '2026-08-01 09:00:00', '2026-11-03 16:00:00'),
  ('XmTC0011', 'SXm02', 'XmR021', '会员卡-自动续费代扣', '已签约自动续费的测试会员',
   '[{"action":"将会员到期日推进至次日用例并触发代扣","expected":"到期前 3 天扣款成功，权益无间断"}]',
   'passed', NULL, '周敏', 'Xmu09', '2026-11-05 14:00:00', NULL, '2026-09-10 09:00:00', '2026-11-05 14:00:00'),
  ('XmTC0012', 'SXm02', 'XmR022', '订单拆单-多仓调度', '商品分属两个仓库',
   '[{"action":"下单后触发拆单","expected":"按仓库拆为两个子单，分别出库，主单状态聚合正确"}]',
   'passed', NULL, '周敏', 'Xmu09', '2026-07-15 10:00:00', NULL, '2026-05-20 09:00:00', '2026-07-15 10:00:00'),
  ('XmTC0013', 'SXm02', 'XmR022', '售后退款-原路退回', '存在一笔已支付订单',
   '[{"action":"发起整单退款并跟踪渠道回执","expected":"退款按原支付渠道退回，订单状态与账务一致"}]',
   'passed', NULL, '周敏', 'Xmu09', '2026-10-28 15:00:00', NULL, '2026-07-25 09:00:00', '2026-10-28 15:00:00'),
  ('XmTC0014', 'SXm02', 'XmR023', '秒杀-库存超卖', '秒杀活动配置 100 件库存',
   '[{"action":"压测并发 2000 次秒杀下单","expected":"成交不超过 100 件，无超卖"}]',
   'blocked', '等待大促压测环境（XmK0106 完成后补测）', '周敏', 'Xmu09', '2026-10-10 10:00:00', NULL, '2026-09-05 09:00:00', '2026-10-10 10:00:00'),
  ('XmTC0015', 'SXm02', 'XmR023', '优惠券-叠加规则', '存在满减券与品类券各一张',
   '[{"action":"下单同时使用满减券与品类券","expected":"按「先品类后满减」顺序计算，优惠金额与规则引擎一致"}]',
   'passed', '金额为负的缺陷修复后回归通过', '周敏', 'Xmu09', '2026-10-18 16:00:00', NULL, '2026-09-05 09:10:00', '2026-10-18 16:00:00'),
  ('XmTC0016', 'SXm03', 'XmR031', 'SSO-跨系统单点登录', '两个接入方系统已注册',
   '[{"action":"系统 A 登录后跳转系统 B","expected":"免登录直达，令牌在两系统间有效"}]',
   'passed', NULL, '王浩', 'Xmu03', '2026-04-22 15:00:00', NULL, '2026-03-01 09:00:00', '2026-04-22 15:00:00'),
  ('XmTC0017', 'SXm03', 'XmR031', 'MFA-异地登录二次验证', '测试账号已开启 MFA',
   '[{"action":"模拟异地 IP 登录","expected":"触发短信二次验证，验证通过后才可进入"}]',
   'passed', '审计漏记录问题修复后回归通过', '王浩', 'Xmu03', '2026-07-28 14:00:00', NULL, '2026-05-06 09:00:00', '2026-07-28 14:00:00'),
  ('XmTC0018', 'SXm03', 'XmR032', '告警收敛-重复告警合并', '配置同指标的重复告警规则',
   '[{"action":"连续触发 10 条同源告警","expected":"收敛为 1 条事件并计数，值班只收到一次通知"}]',
   'passed', NULL, '黄丽', 'Xmu07', '2026-11-04 10:00:00', NULL, '2026-10-10 09:00:00', '2026-11-04 10:00:00'),
  ('XmTC0019', 'SXm03', 'XmR033', '双写一致性-校验', '迁移验证方案已评审',
   '[{"action":"开启 MySQL/达梦双写后比对 1 小时增量","expected":"两侧数据一致，校验工具无差异报告"}]',
   'blocked', '等待信创环境（XmK0136）就绪', '黄丽', 'Xmu07', '2026-10-30 11:00:00', NULL, '2026-09-15 09:00:00', '2026-10-30 11:00:00'),
  ('XmTC0020', 'SXm04', 'XmR041', '深色模式-全页面走查', '双端深色模式可用',
   '[{"action":"遍历 App 全部页面并截图对比色板","expected":"无对比度不足、无反色异常、无残留浅色资源"}]',
   'passed', NULL, '周敏', 'Xmu09', '2026-11-04 16:00:00', NULL, '2026-09-20 09:00:00', '2026-11-04 16:00:00'),
  ('XmTC0021', 'SXm04', 'XmR042', '小程序-首屏白屏率埋点', '灰度 20% 流量已开启',
   '[{"action":"对比灰度前后白屏率埋点数据","expected":"白屏率下降 50% 以上，低端机无劣化"}]',
   'passed', NULL, '周敏', 'Xmu09', '2026-11-06 10:00:00', NULL, '2026-10-12 09:00:00', '2026-11-06 10:00:00');

INSERT INTO test_case_run (id, case_id, workspace_id, status, note, bug_task_id,
                           executed_by, executed_by_user_id, created_at) VALUES
  ('XmTR0001', 'XmTC0001', 'SXm01', 'passed', NULL, NULL, '黄丽', 'Xmu07', '2026-06-12 15:00:00'),
  ('XmTR0002', 'XmTC0002', 'SXm01', 'failed', '签名时间戳容差配置过严', NULL, '黄丽', 'Xmu07', '2026-06-13 10:00:00'),
  ('XmTR0003', 'XmTC0002', 'SXm01', 'passed', '容差调整为 5 分钟后回归通过', NULL, '黄丽', 'Xmu07', '2026-06-15 16:00:00'),
  ('XmTR0004', 'XmTC0003', 'SXm01', 'passed', '首次回归通过', NULL, '黄丽', 'Xmu07', '2026-06-18 11:00:00'),
  ('XmTR0005', 'XmTC0003', 'SXm01', 'failed', 'V1.2 渠道扩容后重复回调再次复现，转缺陷 XmK0011', 'XmK0011', '黄丽', 'Xmu07', '2026-11-05 16:40:00'),
  ('XmTR0006', 'XmTC0004', 'SXm01', 'passed', NULL, NULL, '黄丽', 'Xmu07', '2026-09-12 10:00:00'),
  ('XmTR0007', 'XmTC0005', 'SXm01', 'failed', '跨日交易两个账期均出差异', 'XmK0039', '黄丽', 'Xmu07', '2026-11-04 15:30:00'),
  ('XmTR0008', 'XmTC0006', 'SXm01', 'passed', NULL, NULL, '黄丽', 'Xmu07', '2026-10-20 14:00:00'),
  ('XmTR0009', 'XmTC0007', 'SXm01', 'failed', '200 条规则下 P99 达 120ms，未达标', NULL, '黄丽', 'Xmu07', '2026-09-28 10:00:00'),
  ('XmTR0010', 'XmTC0007', 'SXm01', 'passed', '热点规则缓存优化后 P99 38ms', NULL, '黄丽', 'Xmu07', '2026-10-12 11:00:00'),
  ('XmTR0011', 'XmTC0008', 'SXm01', 'passed', NULL, NULL, '黄丽', 'Xmu07', '2026-10-15 15:00:00'),
  ('XmTR0012', 'XmTC0009', 'SXm02', 'passed', NULL, NULL, '周敏', 'Xmu09', '2026-04-20 15:00:00'),
  ('XmTR0013', 'XmTC0010', 'SXm02', 'failed', '过期任务未执行，积分未清零', 'XmK0071', '周敏', 'Xmu09', '2026-11-03 16:00:00'),
  ('XmTR0014', 'XmTC0011', 'SXm02', 'failed', '代扣成功但权益延迟 2 小时生效', NULL, '周敏', 'Xmu09', '2026-10-28 14:00:00'),
  ('XmTR0015', 'XmTC0011', 'SXm02', 'passed', '权益生效改为实时回调后回归通过', NULL, '周敏', 'Xmu09', '2026-11-05 14:00:00'),
  ('XmTR0016', 'XmTC0012', 'SXm02', 'passed', NULL, NULL, '周敏', 'Xmu09', '2026-07-15 10:00:00'),
  ('XmTR0017', 'XmTC0013', 'SXm02', 'passed', NULL, NULL, '周敏', 'Xmu09', '2026-10-28 15:00:00'),
  ('XmTR0018', 'XmTC0014', 'SXm02', 'blocked', '压测环境未就绪', NULL, '周敏', 'Xmu09', '2026-10-10 10:00:00'),
  ('XmTR0019', 'XmTC0015', 'SXm02', 'failed', '叠加计算金额为负', 'XmK0105', '周敏', 'Xmu09', '2026-10-15 16:00:00'),
  ('XmTR0020', 'XmTC0015', 'SXm02', 'passed', '修复后回归通过', NULL, '周敏', 'Xmu09', '2026-10-18 16:00:00'),
  ('XmTR0021', 'XmTC0016', 'SXm03', 'passed', NULL, NULL, '王浩', 'Xmu03', '2026-04-22 15:00:00'),
  ('XmTR0022', 'XmTC0017', 'SXm03', 'failed', '二次验证通过但审计日志无记录', NULL, '王浩', 'Xmu03', '2026-07-10 14:00:00'),
  ('XmTR0023', 'XmTC0017', 'SXm03', 'passed', '审计补录修复后回归通过', NULL, '王浩', 'Xmu03', '2026-07-28 14:00:00'),
  ('XmTR0024', 'XmTC0018', 'SXm03', 'passed', NULL, NULL, '黄丽', 'Xmu07', '2026-11-04 10:00:00'),
  ('XmTR0025', 'XmTC0019', 'SXm03', 'blocked', '信创环境未就绪', NULL, '黄丽', 'Xmu07', '2026-10-30 11:00:00'),
  ('XmTR0026', 'XmTC0020', 'SXm04', 'failed', '3 个页面残留浅色资源', NULL, '周敏', 'Xmu09', '2026-11-01 15:00:00'),
  ('XmTR0027', 'XmTC0020', 'SXm04', 'passed', '资源替换后回归通过', NULL, '周敏', 'Xmu09', '2026-11-04 16:00:00'),
  ('XmTR0028', 'XmTC0021', 'SXm04', 'passed', NULL, NULL, '周敏', 'Xmu09', '2026-11-06 10:00:00');

-- ---------------------------------------------------------------------------
-- 任务关注
-- ---------------------------------------------------------------------------
INSERT INTO task_watch (task_id, workspace_id, user_id, created_at) VALUES
  ('XmK0016', 'SXm01', 'Xmu01', '2026-09-14 10:00:00'),
  ('XmK0016', 'SXm01', 'Xmu07', '2026-09-15 09:00:00'),
  ('XmK0017', 'SXm01', 'Xmu03', '2026-09-16 10:00:00'),
  ('XmK0017', 'SXm01', 'Xmu01', '2026-09-16 11:00:00'),
  ('XmK0011', 'SXm01', 'Xmu07', '2026-11-05 17:00:00'),
  ('XmK0036', 'SXm01', 'Xmu04', '2026-10-08 10:00:00'),
  ('XmK0044', 'SXm01', 'Xmu01', '2026-11-02 10:00:00'),
  ('XmK0076', 'SXm02', 'Xmu02', '2026-10-20 10:00:00'),
  ('XmK0076', 'SXm02', 'Xmu09', '2026-10-21 09:00:00'),
  ('XmK0100', 'SXm02', 'Xmu06', '2026-09-10 10:00:00'),
  ('XmK0100', 'SXm02', 'Xmu09', '2026-09-11 09:00:00'),
  ('XmK0091', 'SXm02', 'Xmu02', '2026-10-12 10:00:00'),
  ('XmK0124', 'SXm03', 'Xmu03', '2026-11-01 10:00:00'),
  ('XmK0124', 'SXm03', 'Xmu07', '2026-11-01 11:00:00'),
  ('XmK0128', 'SXm03', 'Xmu01', '2026-10-08 10:00:00'),
  ('XmK0131', 'SXm03', 'Xmu10', '2026-10-15 10:00:00'),
  ('XmK0160', 'SXm04', 'Xmu12', '2026-10-25 10:00:00'),
  ('XmK0160', 'SXm04', 'Xmu09', '2026-10-25 11:00:00'),
  ('XmK0148', 'SXm04', 'Xmu06', '2026-10-12 10:00:00');

-- ---------------------------------------------------------------------------
-- 附件（对应物理文件需在服务器 ATTACH_DIR 创建，见部署说明）
-- ---------------------------------------------------------------------------
INSERT INTO attachment (id, target_id, target_kind, workspace_id, filename, content_type, size,
                       stored_name, created_at) VALUES
  ('XmAT0001', 'XmK0004', 'task', 'SXm01', '收银台交互稿-v3.png', 'image/png', 384721, 'at_xm0001.png', '2026-05-12 16:00:00'),
  ('XmAT0002', 'XmK0016', 'task', 'SXm01', '渠道路由策略说明.md', 'text/markdown', 8213, 'at_xm0002.md', '2026-10-10 11:00:00'),
  ('XmAT0003', 'XmK0020', 'task', 'SXm01', '全链路压测报告.md', 'text/markdown', 15340, 'at_xm0003.md', '2026-10-28 18:00:00'),
  ('XmAT0004', 'XmK0032', 'task', 'SXm01', '对账看板指标口径.csv', 'text/csv', 2311, 'at_xm0004.csv', '2026-08-20 15:00:00'),
  ('XmAT0005', 'XmK0045', 'task', 'SXm01', '下载中心交互稿.png', 'image/png', 512400, 'at_xm0005.png', '2026-11-05 14:00:00'),
  ('XmAT0006', 'XmK0052', 'task', 'SXm01', '规则引擎性能基线.csv', 'text/csv', 4230, 'at_xm0006.csv', '2026-11-02 16:00:00'),
  ('XmAT0007', 'XmK0070', 'task', 'SXm02', '会员视觉改版稿.png', 'image/png', 688312, 'at_xm0007.png', '2026-07-22 17:00:00'),
  ('XmAT0008', 'XmK0103', 'task', 'SXm02', '大促主会场视觉稿.png', 'image/png', 734502, 'at_xm0008.png', '2026-09-15 16:00:00'),
  ('XmAT0009', 'XmK0106', 'task', 'SXm02', '大促压测预案.md', 'text/markdown', 9621, 'at_xm0009.md', '2026-10-08 10:00:00'),
  ('XmAT0010', 'XmK0118', 'task', 'SXm03', '渗透测试报告.md', 'text/markdown', 18720, 'at_xm0010.md', '2026-07-18 15:00:00'),
  ('XmAT0011', 'XmK0138', 'task', 'SXm03', '迁移验证方案.md', 'text/markdown', 11054, 'at_xm0011.md', '2026-09-25 14:00:00'),
  ('XmAT0012', 'XmK0143', 'task', 'SXm04', 'App4.0视觉规范.png', 'image/png', 912845, 'at_xm0012.png', '2026-06-20 17:00:00'),
  ('XmAT0013', 'XmK0144', 'task', 'SXm04', '双端兼容性清单.csv', 'text/csv', 5890, 'at_xm0013.csv', '2026-08-05 11:00:00'),
  ('XmAT0014', 'XmK0161', 'task', 'SXm04', '性能基线对比数据.csv', 'text/csv', 7622, 'at_xm0014.csv', '2026-11-03 15:00:00'),
  ('XmAT0015', 'XmQ0111', 'demand', 'SXm01', '数字人民币调研纪要.md', 'text/markdown', 6438, 'at_xm0015.md', '2026-05-06 10:00:00');

-- ---------------------------------------------------------------------------
-- 只读分享 / 邀请链接 / 优先级配置 / 保存视图
-- ---------------------------------------------------------------------------
INSERT INTO gantt_share (workspace_id, token, created_at, expires_at) VALUES
  ('SXm01', 'gsxm01readonly01', '2026-10-20 10:00:00', NULL),
  ('SXm03', 'gsxm03readonly03', '2026-11-01 09:00:00', '2026-12-31 23:59:59');

INSERT INTO req_doc_share (workspace_id, doc_id, token, created_at, expires_at) VALUES
  ('SXm01', 'XmD0110', 'docxm0110share', '2026-10-15 10:00:00', NULL),
  ('SXm02', 'XmD0210', 'docxm0210share', '2026-10-18 10:00:00', '2026-12-31 23:59:59'),
  ('SXm04', 'XmD0410', 'docxm0410share', '2026-11-01 10:00:00', NULL);

INSERT INTO invite (id, workspace_id, created_by, expires_at, used_count, created_at) VALUES
  ('XMSHARE01A', 'SXm01', 'Umw5tt2nqz9s9b8sq', '2026-12-31 23:59:59', 3, '2026-11-01 10:00:00'),
  ('XMSHARE02B', 'SXm02', 'Umw5tt2nqz9s9b8sq', '2026-12-31 23:59:59', 1, '2026-11-02 10:00:00'),
  ('XMSHARE03C', 'SXm03', 'Umw5tt2nqz9s9b8sq', '2026-11-30 23:59:59', 0, '2026-11-05 10:00:00');

INSERT INTO workspace_priority (id, workspace_id, code, name, color) VALUES
  ('XmPR0110', 'SXm01', 'P0', '紧急', '#D92D20'),
  ('XmPR0111', 'SXm01', 'P1', '高', '#F79009'),
  ('XmPR0112', 'SXm01', 'P2', '中', '#6690FF'),
  ('XmPR0113', 'SXm01', 'P3', '低', '#98A2B3');

INSERT INTO saved_view (id, user_id, workspace_id, name, params, created_at) VALUES
  ('XmSV0001', 'Xmu01', 'SXm01', '我的高优', '{"pris":["P0","P1"]}', '2026-10-12 10:00:00'),
  ('XmSV0002', 'Xmu01', 'SXm01', '进行中', '{"preset":"doing"}', '2026-10-13 10:00:00'),
  ('XmSV0003', 'Umw5tt2nqz9s9b8sq', 'SXm01', '按优先级', '{"group":"priority","sort":"priority"}', '2026-11-06 10:00:00'),
  ('XmSV0004', 'Xmu02', 'SXm02', '我的任务', '{"preset":"mine"}', '2026-09-10 10:00:00'),
  ('XmSV0005', 'Xmu02', 'SXm02', '已逾期', '{"preset":"over"}', '2026-09-12 10:00:00'),
  ('XmSV0006', 'Xmu03', 'SXm03', '缺陷跟踪', '{"types":["bug"]}', '2026-10-20 10:00:00'),
  ('XmSV0007', 'Xmu12', 'SXm04', '我的高优', '{"pris":["P0","P1"]}', '2026-11-01 10:00:00'),
  ('XmSV0008', 'Xmu05', 'SXm01', '按负责人', '{"group":"owner"}', '2026-08-15 10:00:00');

-- ---------------------------------------------------------------------------
-- 工作动态（新文档创建 + 用例执行）
-- ---------------------------------------------------------------------------
INSERT INTO work_activity (workspace_id, entity_type, entity_id, actor_id, actor_name, action, detail, created_at) VALUES
  ('SXm01', 'requirement_doc', 'XmD0115', 'Xmu07', '黄丽', 'create', '创建验收文档「V1.2 测试验收标准」', '2026-11-04 16:10:00'),
  ('SXm01', 'requirement_doc', 'XmD0125', 'Xmu05', '刘洋', 'create', '创建技术文档「对账数据字典」', '2026-07-20 09:10:00'),
  ('SXm02', 'requirement_doc', 'XmD0215', 'Xmu09', '周敏', 'create', '创建验收文档「V2.1 测试验收标准」', '2026-11-03 09:10:00'),
  ('SXm03', 'requirement_doc', 'XmD0314', 'Xmu03', '王浩', 'create', '创建验收文档「SSO 安全测试报告」', '2026-07-20 09:10:00'),
  ('SXm03', 'requirement_doc', 'XmD0315', 'Xmu10', '吴俊', 'create', '创建技术文档「监控告警平台 部署手册」', '2026-10-15 09:10:00'),
  ('SXm01', 'test_case', 'XmTC0003', 'Xmu07', '黄丽', 'update', '用例「回调重复通知-幂等处理」执行失败，已转缺陷跟进', '2026-11-05 16:40:00'),
  ('SXm01', 'test_case', 'XmTC0005', 'Xmu07', '黄丽', 'update', '用例「跨日交易-勾兑口径」执行失败，已转缺陷跟进', '2026-11-04 15:30:00'),
  ('SXm02', 'test_case', 'XmTC0010', 'Xmu09', '周敏', 'update', '用例「积分过期-自动清零」执行失败，已转缺陷跟进', '2026-11-03 16:00:00'),
  ('SXm04', 'test_case', 'XmTC0021', 'Xmu09', '周敏', 'update', '用例「小程序-首屏白屏率埋点」执行通过', '2026-11-06 10:00:00');

-- ---------------------------------------------------------------------------
-- admin 登录后直接进入「支付业务部」空间
-- ---------------------------------------------------------------------------
UPDATE app_user SET last_workspace_id = 'SXm01' WHERE id = 'Umw5tt2nqz9s9b8sq';

COMMIT;

-- ---------------------------------------------------------------------------
-- 自检
-- ---------------------------------------------------------------------------
SELECT '文档' AS 项, COUNT(*) AS 数 FROM requirement_doc WHERE workspace_id LIKE 'SXm%'
UNION ALL SELECT '文档(未分类other)', COUNT(*) FROM requirement_doc WHERE workspace_id LIKE 'SXm%' AND doc_type = 'other'
UNION ALL SELECT '文档历史快照', COUNT(*) FROM requirement_doc_history WHERE workspace_id LIKE 'SXm%'
UNION ALL SELECT '文档评论', COUNT(*) FROM req_doc_comment WHERE workspace_id LIKE 'SXm%'
UNION ALL SELECT '测试用例', COUNT(*) FROM test_case WHERE workspace_id LIKE 'SXm%'
UNION ALL SELECT '用例执行流水', COUNT(*) FROM test_case_run WHERE workspace_id LIKE 'SXm%'
UNION ALL SELECT '任务关注', COUNT(*) FROM task_watch WHERE workspace_id LIKE 'SXm%'
UNION ALL SELECT '附件', COUNT(*) FROM attachment WHERE workspace_id LIKE 'SXm%'
UNION ALL SELECT '甘特分享', COUNT(*) FROM gantt_share WHERE workspace_id LIKE 'SXm%'
UNION ALL SELECT '文档分享', COUNT(*) FROM req_doc_share WHERE workspace_id LIKE 'SXm%'
UNION ALL SELECT '邀请链接', COUNT(*) FROM invite WHERE id LIKE 'XMSHARE%'
UNION ALL SELECT '保存视图', COUNT(*) FROM saved_view WHERE id LIKE 'XmSV%'
UNION ALL SELECT '优先级配置', COUNT(*) FROM workspace_priority WHERE workspace_id LIKE 'SXm%';

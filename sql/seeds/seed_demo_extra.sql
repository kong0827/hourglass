-- ============================================================================
-- sql/seeds/seed_demo_extra.sql · 演示种子数据补充（2026-11-07）
--
-- 用途：在 seed_demo.sql（项目/任务/需求池）基础上，补全其余领域实体的演示数据：
--   标签、子任务、评论、任务依赖、任务关注、需求文档（含历史与需求关联）、
--   测试用例（含执行记录与失败转缺陷）、分支（含流转日志）、项目成员可见性、
--   任务操作时间线（task_log）。
-- 注意：仅演示环境手工执行；重复执行会追加重复数据。
-- 执行：mysql -u hourglass -p --default-character-set=utf8mb4 hourglass < 本文件
-- ============================================================================

USE hourglass;
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @ws := (SELECT id FROM workspace ORDER BY created_at LIMIT 1);

-- ---------------------------------------------------------------------------
-- 标签
-- ---------------------------------------------------------------------------
INSERT INTO tag (id, workspace_id, name) VALUES
  ('Gseed01', @ws, '前端'),
  ('Gseed02', @ws, '后端'),
  ('Gseed03', @ws, '高优'),
  ('Gseed04', @ws, '技术债'),
  ('Gseed05', @ws, '客户问题'),
  ('Gseed06', @ws, '联调');

INSERT INTO task_tag (task_id, tag_id, workspace_id) VALUES
  ('Tseed13', 'Gseed02', @ws), ('Tseed13', 'Gseed06', @ws),
  ('Tseed14', 'Gseed02', @ws),
  ('Tseed15', 'Gseed02', @ws), ('Tseed15', 'Gseed06', @ws),
  ('Tseed23', 'Gseed02', @ws), ('Tseed23', 'Gseed03', @ws),
  ('Tseed27', 'Gseed01', @ws), ('Tseed27', 'Gseed04', @ws),
  ('Tseed28', 'Gseed01', @ws),
  ('Tseed10', 'Gseed04', @ws),
  ('Tseed21', 'Gseed05', @ws);

-- ---------------------------------------------------------------------------
-- 子任务（检查清单）
-- ---------------------------------------------------------------------------
INSERT INTO subtask (task_id, workspace_id, title, done) VALUES
  ('Tseed13', @ws, '币种与汇率数据表设计', 1),
  ('Tseed13', @ws, '结算金额精度口径统一', 1),
  ('Tseed13', @ws, '多币种对账导出', 0),
  ('Tseed13', @ws, '财务侧回归验证', 0),
  ('Tseed14', @ws, '汇率源 API 选型', 1),
  ('Tseed14', @ws, '汇率缓存刷新任务', 0),
  ('Tseed23', @ws, '积分获取规则配置', 1),
  ('Tseed23', @ws, '积分兑换商城对接', 0),
  ('Tseed23', @ws, '会员等级权益联动', 0),
  ('Tseed27', @ws, '虚拟滚动组件选型', 1),
  ('Tseed27', @ws, '长列表性能基线测试', 0),
  ('Tseed27', @ws, '滚动位置恢复兼容', 0);

-- ---------------------------------------------------------------------------
-- 评论
-- ---------------------------------------------------------------------------
INSERT INTO task_comment (task_id, workspace_id, author_id, author_name, content, created_at) VALUES
  ('Tseed13', @ws, 'Useed01', '林岚', '汇率口径先按财务给的表对齐，别自己定义。', '2026-10-27 14:20:00'),
  ('Tseed13', @ws, 'Useed03', '陈宏昌', '汇率渠道接口这周能出联调环境，@林岚 到时候直接找我。', '2026-10-28 09:10:00'),
  ('Tseed13', @ws, 'Useed06', '孙倩', '美元精度的测试用例我已经写好，转测前知会我一声。', '2026-11-01 16:30:00'),
  ('Tseed15', @ws, 'Useed06', '孙倩', '被阻塞的原因记一下：等待汇率渠道接口联调，解除后我再跟进报表。', '2026-11-02 10:00:00'),
  ('Tseed23', @ws, 'Useed06', '孙倩', '积分兑换先上线第一批虚拟商品，实物兑换下个版本再说。', '2026-10-20 11:00:00'),
  ('Tseed23', @ws, 'Useed04', '王一舟', '兑换商城的页面我这边可以先行，接口按约定的 mock 联调。', '2026-10-21 15:40:00'),
  ('Tseed27', @ws, 'Useed02', '赵敏', '基线测试用 5000 张卡片压，滚动帧率不能低于 50fps。', '2026-10-20 09:30:00'),
  ('Tseed27', @ws, 'Useed05', '周雨', '组件库里的虚拟列表组件可以直接复用，省一半工作量。', '2026-10-22 17:10:00');

-- ---------------------------------------------------------------------------
-- 任务依赖（甘特图连线）
-- ---------------------------------------------------------------------------
INSERT INTO task_dependency (id, workspace_id, from_task_id, to_task_id, dep_type, lag_days) VALUES
  ('DEPseed01', @ws, 'Tseed14', 'Tseed13', 'FS', 0),  -- 汇率渠道接入完成后开始多币种结算
  ('DEPseed02', @ws, 'Tseed13', 'Tseed15', 'FS', 2),  -- 多币种结算完成 2 天后出差异报表
  ('DEPseed03', @ws, 'Tseed26', 'Tseed27', 'FS', 0),  -- 组件库梳理完成后开始看板重构
  ('DEPseed04', @ws, 'Tseed29', 'Tseed30', 'SS', 3);  -- 指标口径梳理晚 3 天并行启动

-- ---------------------------------------------------------------------------
-- 任务关注
-- ---------------------------------------------------------------------------
INSERT INTO task_watch (task_id, workspace_id, user_id) VALUES
  ('Tseed13', @ws, 'Useed02'),
  ('Tseed13', @ws, 'Useed05'),
  ('Tseed23', @ws, 'Useed03'),
  ('Tseed27', @ws, 'Useed05');

-- ---------------------------------------------------------------------------
-- 需求文档（树形结构 + 富文本正文）
-- ---------------------------------------------------------------------------
INSERT INTO requirement_doc (id, workspace_id, req_id, parent_id, title, doc_type, content, format,
                             content_brief, status, published_at, sort_order, owner, owner_user_id,
                             created_at, updated_at) VALUES
  ('DRseed01', @ws, 'Rseed01', NULL, '结算中台需求总览', 'requirement',
   '<h2>背景</h2><p>商户结算与对账核心系统，覆盖入网、结算、对账、风控四条主线。</p><h2>范围</h2><ul><li>商户入网与资质审核</li><li>T+1 清算与冲正</li><li>按账期对账与差异处理</li><li>额度与异常交易风控</li></ul><h2>里程碑</h2><p>V1.0 于 2026-08-31 上线，V1.2 多币种结算预计 2026-11-13 发布。</p>',
   'html', '结算中台总体需求：入网、结算、对账、风控四条主线与版本里程碑。', 'published',
   '2026-10-09 10:00:00', 10, '林岚', 'Useed01', '2026-10-08 09:00:00', '2026-10-09 10:00:00'),
  ('DRseed02', @ws, 'Rseed01', 'DRseed01', '商户入网需求', 'requirement',
   '<h2>入网流程</h2><ol><li>商户线上提交资料（营业执照、法人信息、结算账户）</li><li>运营初审，资料不全驳回并注明原因</li><li>风控复审，高风险商户转人工尽调</li><li>审核通过后开通商户号并通知对接人</li></ol><h2>验收标准</h2><p>资料齐全的商户 2 个工作日内完成审核；驳回必须留痕并通知提交人。</p>',
   'html', '商户资料提交、两级审核与商户号开通流程及验收标准。', 'published',
   '2026-06-15 10:00:00', 20, '林岚', 'Useed01', '2026-06-01 09:00:00', '2026-06-15 10:00:00'),
  ('DRseed03', @ws, 'Rseed01', 'DRseed01', '多币种结算技术方案', 'technical',
   '<h2>目标</h2><p>支持美元、欧元、港币结算，统一金额精度与汇率口径。</p><h2>方案要点</h2><ul><li>金额统一保留 2 位小数，中间计算不四舍五入</li><li>汇率取值：渠道价缓存 10 分钟，落库时记录汇率快照</li><li>对账差异按币种维度分别出报表</li></ul><h2>风险</h2><p>汇率渠道超时降级策略需与财务确认兜底口径。</p>',
   'html', '多币种结算：金额精度、汇率快照与按币种对账的技术方案。', 'published',
   '2026-11-01 10:00:00', 30, '陈宏昌', 'Useed03', '2026-10-26 09:00:00', '2026-11-01 10:00:00'),
  ('DRseed04', @ws, 'Rseed01', 'DRseed01', 'V1.2 测试验收标准', 'acceptance',
   '<h2>范围</h2><p>V1.2 多币种结算 + 汇率渠道接入。</p><h2>验收项</h2><ul><li>三种币种的结算、对账、导出全链路通过</li><li>金额精度符合财务口径（抽查 50 笔）</li><li>汇率渠道超时走降级且留痕</li></ul>',
   'html', 'V1.2 验收范围与验收项清单。', 'draft',
   NULL, 40, '孙倩', 'Useed06', '2026-11-02 09:00:00', '2026-11-03 14:00:00'),
  ('DRseed05', @ws, 'Rseed02', NULL, '会员积分体系方案', 'requirement',
   '<h2>目标</h2><p>按消费与活跃度发放积分，积分可在兑换商城消费。</p><h2>规则</h2><ul><li>消费 1 元 = 1 积分，下单支付完成后入账</li><li>积分有效期 12 个月，过期自动清零并提前 30 天提醒</li><li>退款订单对应积分自动扣回</li></ul>',
   'html', '积分获取、有效期与退款扣回规则。', 'published',
   '2026-09-20 10:00:00', 10, '孙倩', 'Useed06', '2026-09-10 09:00:00', '2026-09-20 10:00:00'),
  ('DRseed06', @ws, 'Rseed03', NULL, '工作台 V2 信息架构', 'technical',
   '<h2>信息架构</h2><p>新工作台按「工作 / 洞察 / 管理」三组重排导航，高频操作一跳可达。</p><h2>设计令牌</h2><ul><li>主色 #2563EB，语义色沿用现有令牌</li><li>间距按 4px 栅格</li></ul><h2>性能目标</h2><p>首屏 1.5s 内，看板 5000 卡片滚动帧率 ≥ 50fps。</p>',
   'html', 'V2 信息架构分组、设计令牌与性能目标。', 'draft',
   NULL, 10, '陈宏昌', 'Useed03', '2026-10-09 09:00:00', '2026-10-16 18:00:00');

-- 文档历史快照
INSERT INTO requirement_doc_history (id, doc_id, workspace_id, version_no, title, content, format,
                                     saved_by, saved_by_user_id, created_at) VALUES
  ('DRHseed01', 'DRseed01', @ws, 1, '结算中台需求总览',
   '<h2>背景</h2><p>商户结算与对账核心系统。</p><h2>范围</h2><ul><li>商户入网</li><li>T+1 清算</li><li>按账期对账</li></ul>',
   'html', '林岚', 'Useed01', '2026-10-08 09:30:00'),
  ('DRHseed02', 'DRseed01', @ws, 2, '结算中台需求总览',
   '<h2>背景</h2><p>商户结算与对账核心系统，覆盖入网、结算、对账、风控四条主线。</p><h2>范围</h2><ul><li>商户入网与资质审核</li><li>T+1 清算与冲正</li><li>按账期对账与差异处理</li><li>额度与异常交易风控</li></ul>',
   'html', '林岚', 'Useed01', '2026-10-09 10:00:00'),
  ('DRHseed03', 'DRseed03', @ws, 1, '多币种结算技术方案',
   '<h2>目标</h2><p>支持美元、欧元、港币结算，统一金额精度与汇率口径。</p><h2>方案要点</h2><ul><li>金额统一保留 2 位小数</li><li>汇率取值：渠道价缓存 10 分钟</li></ul>',
   'html', '陈宏昌', 'Useed03', '2026-10-26 11:00:00');

-- 需求 ↔ 文档关联
INSERT INTO demand_doc_link (workspace_id, demand_id, doc_id, created_by, created_at) VALUES
  (@ws, 'Dseed01', 'DRseed03', 'Useed01', '2026-10-28 10:00:00'),
  (@ws, 'Dseed06', 'DRseed03', 'Useed03', '2026-10-27 09:00:00'),
  (@ws, 'Dseed09', 'DRseed05', 'Useed06', '2026-09-15 14:00:00');

-- ---------------------------------------------------------------------------
-- 测试用例 + 执行记录（含失败转缺陷）
-- ---------------------------------------------------------------------------
INSERT INTO task (id, workspace_id, title, description, item_type, priority, owner, owner_user_id,
                  category, board_column, start_date, due_date, req_id, progress, estimate_minutes,
                  completed_at, is_blocked, blocked_reason, created_at, sort_order) VALUES
  ('TBseed01', @ws, '对账差异自动标记-金额单位错误', '自动标记把分当元，差异金额放大 100 倍', 'bug', 'P1',
   '吴桐', 'Useed07', '功能开发', 'backlog', '2026-11-06', '2026-11-10', 'Rseed01', 0, 240,
   NULL, 0, NULL, '2026-11-05 17:00:00', 0);

INSERT INTO test_case (id, workspace_id, req_id, title, precondition, steps, latest_status,
                       latest_note, latest_by, latest_by_user_id, latest_at, latest_bug_task_id,
                       created_at) VALUES
  ('TCseed01', @ws, 'Rseed01', '商户入网-资料提交校验',
   '商户账号已注册，未提交入网资料',
   '1. 进入入网页\n2. 不填必填项直接提交\n3. 补全资料后提交',
   'passed', NULL, '孙倩', 'Useed06', '2026-06-18 15:00:00', NULL, '2026-06-10 09:00:00'),
  ('TCseed02', @ws, 'Rseed01', '商户入网-审核驳回流程',
   '存在一条待审核入网申请',
   '1. 运营打开待审核列表\n2. 填写驳回原因并驳回\n3. 商户侧查看驳回通知',
   'passed', NULL, '孙倩', 'Useed06', '2026-06-22 16:00:00', NULL, '2026-06-10 09:10:00'),
  ('TCseed03', @ws, 'Rseed01', '对账单导出-按账期筛选',
   '存在多账期对账数据',
   '1. 打开对账单页\n2. 选择 10 月账期导出\n3. 校验文件内容与账期一致',
   'passed', NULL, '吴桐', 'Useed07', '2026-10-25 10:00:00', NULL, '2026-10-11 09:00:00'),
  ('TCseed04', @ws, 'Rseed01', '对账差异-自动标记',
   '存在渠道与系统金额不一致的流水',
   '1. 触发日终对账\n2. 打开差异列表\n3. 校验差异金额与标记规则',
   'failed', '差异金额单位错误：分/元未换算，放大 100 倍', '吴桐', 'Useed07', '2026-11-05 16:40:00', 'TBseed01', '2026-10-11 09:20:00'),
  ('TCseed05', @ws, 'Rseed01', '多币种结算-美元汇率精度',
   '汇率渠道已配置美元报价',
   '1. 构造美元结算单\n2. 校验结算金额与汇率快照\n3. 抽查 50 笔与财务口径比对',
   'blocked', '等待汇率渠道联调环境（Tseed14）', '孙倩', 'Useed06', '2026-11-02 11:00:00', NULL, '2026-10-29 09:00:00'),
  ('TCseed06', @ws, 'Rseed02', '优惠券-满减叠加计算',
   '存在满 100 减 20 券与商品凑单场景',
   '1. 加购 120 元商品\n2. 使用满减券结算\n3. 校验应付金额为 100 元',
   'passed', NULL, '吴桐', 'Useed07', '2026-06-18 14:00:00', NULL, '2026-06-05 09:00:00'),
  ('TCseed07', @ws, 'Rseed02', 'iOS 支付回调-重复通知幂等',
   '构造同一笔订单的两次支付成功回调',
   '1. 发送第一次回调\n2. 立即重发同一回调\n3. 校验订单只更新一次且无重复入账',
   'passed', '回归通过，修复后重复回调 1000 次无重复入账', '吴桐', 'Useed07', '2026-07-10 17:00:00', NULL, '2026-07-08 09:00:00'),
  ('TCseed08', @ws, 'Rseed02', '会员积分-消费累计',
   '测试会员账号已登录',
   '1. 下单支付 50 元\n2. 查看积分明细\n3. 申请整单退款后核对积分扣回',
   'failed', '退款后积分未扣回，产生 50 积分漏洞', '孙倩', 'Useed06', '2026-11-04 15:30:00', NULL, '2026-10-15 09:00:00');

INSERT INTO test_case_run (id, case_id, workspace_id, status, note, bug_task_id,
                           executed_by, executed_by_user_id, created_at) VALUES
  ('TCRseed01', 'TCseed01', @ws, 'passed', NULL, NULL, '孙倩', 'Useed06', '2026-06-18 15:00:00'),
  ('TCRseed02', 'TCseed02', @ws, 'failed', '驳回后商户侧收不到通知', NULL, '孙倩', 'Useed06', '2026-06-20 14:00:00'),
  ('TCRseed03', 'TCseed02', @ws, 'passed', '通知修复后回归通过', NULL, '孙倩', 'Useed06', '2026-06-22 16:00:00'),
  ('TCRseed04', 'TCseed03', @ws, 'passed', NULL, NULL, '吴桐', 'Useed07', '2026-10-25 10:00:00'),
  ('TCRseed05', 'TCseed04', @ws, 'failed', '差异金额单位错误：分/元未换算', 'TBseed01', '吴桐', 'Useed07', '2026-11-05 16:40:00'),
  ('TCRseed06', 'TCseed05', @ws, 'blocked', '等待汇率渠道联调环境', NULL, '孙倩', 'Useed06', '2026-11-02 11:00:00'),
  ('TCRseed07', 'TCseed06', @ws, 'passed', NULL, NULL, '吴桐', 'Useed07', '2026-06-18 14:00:00'),
  ('TCRseed08', 'TCseed07', @ws, 'failed', '重复回调产生两次入账', NULL, '吴桐', 'Useed07', '2026-07-09 10:00:00'),
  ('TCRseed09', 'TCseed07', @ws, 'passed', '修复后回归通过', NULL, '吴桐', 'Useed07', '2026-07-10 17:00:00'),
  ('TCRseed10', 'TCseed08', @ws, 'failed', '退款后积分未扣回', NULL, '孙倩', 'Useed06', '2026-11-04 15:30:00');

-- ---------------------------------------------------------------------------
-- 分支（开发 → 测试 → 合并 → 发布）与流转日志
-- ---------------------------------------------------------------------------
INSERT INTO dev_branch (id, workspace_id, req_id, name, status, owner, owner_user_id,
                        target_branch, note, dev_at, test_at, merge_at, released_at,
                        sort_order, created_at) VALUES
  ('Bseed01', @ws, 'Rseed01', 'feature/multi-currency-settle', 'testing', '陈宏昌', 'Useed03',
   'release/1.2', '多币种结算主分支，已提测', '2026-10-27 09:30:00', '2026-11-04 10:00:00',
   NULL, NULL, 10, '2026-10-27 09:30:00'),
  ('Bseed02', @ws, 'Rseed01', 'feature/exchange-rate-channel', 'dev', '林岚', 'Useed01',
   'feature/multi-currency-settle', '汇率渠道接入，开发中', '2026-10-29 10:00:00',
   NULL, NULL, NULL, 20, '2026-10-29 10:00:00'),
  ('Bseed03', @ws, 'Rseed02', 'feature/points-system', 'merging', '孙倩', 'Useed06',
   'release/1.2-mall', '会员积分体系，待合并', '2026-09-16 09:00:00', '2026-10-28 14:00:00',
   '2026-11-03 11:00:00', NULL, 30, '2026-09-16 09:00:00'),
  ('Bseed04', @ws, 'Rseed03', 'feature/board-virtual-scroll', 'dev', '赵敏', 'Useed02',
   'develop', '看板虚拟滚动重构，开发中', '2026-10-20 10:00:00', NULL, NULL, NULL,
   40, '2026-10-20 10:00:00'),
  ('Bseed05', @ws, 'Rseed01', 'hotfix/decimal-precision', 'released', '陈宏昌', 'Useed03',
   'master', '金额精度丢失线上修复，已随 V1.1 发布', '2026-09-28 14:00:00',
   '2026-09-29 10:00:00', '2026-09-29 16:00:00', '2026-09-30 20:00:00', 50, '2026-09-28 14:00:00');

INSERT INTO dev_branch_log (id, workspace_id, branch_id, action, from_status, to_status, detail,
                            actor_name, actor_user_id, created_at) VALUES
  ('BLseed01', @ws, 'Bseed01', 'create', NULL, 'dev', '创建分支', '陈宏昌', 'Useed03', '2026-10-27 09:30:00'),
  ('BLseed02', @ws, 'Bseed01', 'update', 'dev', 'testing', '开发完成，提交测试', '陈宏昌', 'Useed03', '2026-11-04 10:00:00'),
  ('BLseed03', @ws, 'Bseed02', 'create', NULL, 'dev', '创建分支', '林岚', 'Useed01', '2026-10-29 10:00:00'),
  ('BLseed04', @ws, 'Bseed03', 'create', NULL, 'dev', '创建分支', '孙倩', 'Useed06', '2026-09-16 09:00:00'),
  ('BLseed05', @ws, 'Bseed03', 'update', 'dev', 'testing', '提测', '孙倩', 'Useed06', '2026-10-28 14:00:00'),
  ('BLseed06', @ws, 'Bseed03', 'update', 'testing', 'merging', '测试通过，进入合并', '孙倩', 'Useed06', '2026-11-03 11:00:00'),
  ('BLseed07', @ws, 'Bseed04', 'create', NULL, 'dev', '创建分支', '赵敏', 'Useed02', '2026-10-20 10:00:00'),
  ('BLseed08', @ws, 'Bseed05', 'create', NULL, 'dev', '线上问题热修复分支', '陈宏昌', 'Useed03', '2026-09-28 14:00:00'),
  ('BLseed09', @ws, 'Bseed05', 'update', 'dev', 'testing', '当日提测', '陈宏昌', 'Useed03', '2026-09-29 10:00:00'),
  ('BLseed10', @ws, 'Bseed05', 'update', 'testing', 'merging', '测试通过', '陈宏昌', 'Useed03', '2026-09-29 16:00:00'),
  ('BLseed11', @ws, 'Bseed05', 'update', 'merging', 'released', '随 V1.1 发布上线', '陈宏昌', 'Useed03', '2026-09-30 20:00:00');

-- ---------------------------------------------------------------------------
-- 项目成员可见性（access：none 隐藏 / read 只读 / pm / dev / qa）
-- ---------------------------------------------------------------------------
INSERT INTO project_member (workspace_id, project_id, user_id, access) VALUES
  (@ws, 'Rseed01', 'Useed01', 'pm'),
  (@ws, 'Rseed01', 'Useed03', 'dev'),
  (@ws, 'Rseed01', 'Useed06', 'qa'),
  (@ws, 'Rseed04', 'Useed05', 'dev'),
  (@ws, 'Rseed04', 'Useed07', 'read'),
  (@ws, 'Rseed05', 'Useed02', 'dev'),
  (@ws, 'Rseed05', 'Useed06', 'qa');

-- ---------------------------------------------------------------------------
-- 任务操作时间线（task_log：create / update / move）
-- ---------------------------------------------------------------------------
INSERT INTO task_log (task_id, workspace_id, actor_id, action, detail, from_column, to_column, created_at) VALUES
  ('Tseed01', @ws, 'Useed01', 'create', NULL, NULL, 'backlog', '2026-05-30 10:00:00'),
  ('Tseed01', @ws, 'Useed01', 'move', NULL, 'backlog', 'doing', '2026-06-01 09:00:00'),
  ('Tseed01', @ws, 'Useed01', 'move', NULL, 'doing', 'done', '2026-06-20 18:00:00'),
  ('Tseed10', @ws, 'Useed03', 'create', NULL, NULL, 'backlog', '2026-09-28 10:00:00'),
  ('Tseed10', @ws, 'Useed03', 'move', NULL, 'backlog', 'doing', '2026-09-28 11:00:00'),
  ('Tseed10', @ws, 'Useed03', 'update', '修复 Decimal 精度截断', 'doing', 'doing', '2026-09-29 15:00:00'),
  ('Tseed10', @ws, 'Useed03', 'move', NULL, 'doing', 'done', '2026-09-30 18:00:00'),
  ('Tseed13', @ws, 'Useed01', 'create', NULL, NULL, 'backlog', '2026-10-25 10:00:00'),
  ('Tseed13', @ws, 'Useed01', 'move', NULL, 'backlog', 'doing', '2026-10-26 09:00:00'),
  ('Tseed14', @ws, 'Useed03', 'create', NULL, NULL, 'backlog', '2026-10-27 10:00:00'),
  ('Tseed14', @ws, 'Useed03', 'move', NULL, 'backlog', 'doing', '2026-10-28 09:00:00'),
  ('Tseed15', @ws, 'Useed06', 'create', NULL, NULL, 'backlog', '2026-11-01 10:00:00'),
  ('Tseed15', @ws, 'Useed06', 'update', '标记为被阻塞（等待汇率渠道接口联调）', 'backlog', 'backlog', '2026-11-02 10:00:00'),
  ('Tseed23', @ws, 'Useed06', 'create', NULL, NULL, 'backlog', '2026-09-14 10:00:00'),
  ('Tseed23', @ws, 'Useed06', 'move', NULL, 'backlog', 'doing', '2026-09-15 09:00:00'),
  ('Tseed27', @ws, 'Useed02', 'create', NULL, NULL, 'backlog', '2026-10-18 10:00:00'),
  ('Tseed27', @ws, 'Useed02', 'move', NULL, 'backlog', 'doing', '2026-10-19 09:00:00'),
  ('TBseed01', @ws, 'Useed07', 'create', '测试用例 TCseed04 执行失败转缺陷', NULL, 'backlog', '2026-11-05 17:00:00');

-- ---------------------------------------------------------------------------
-- 自检
-- ---------------------------------------------------------------------------
SELECT '标签' AS 项, COUNT(*) AS 数 FROM tag
UNION ALL SELECT '任务标签', COUNT(*) FROM task_tag
UNION ALL SELECT '子任务', COUNT(*) FROM subtask
UNION ALL SELECT '评论', COUNT(*) FROM task_comment
UNION ALL SELECT '任务依赖', COUNT(*) FROM task_dependency
UNION ALL SELECT '任务关注', COUNT(*) FROM task_watch
UNION ALL SELECT '需求文档', COUNT(*) FROM requirement_doc
UNION ALL SELECT '文档历史', COUNT(*) FROM requirement_doc_history
UNION ALL SELECT '需求文档关联', COUNT(*) FROM demand_doc_link
UNION ALL SELECT '测试用例', COUNT(*) FROM test_case
UNION ALL SELECT '测试执行记录', COUNT(*) FROM test_case_run
UNION ALL SELECT '缺陷任务(新增)', COUNT(*) FROM task WHERE id LIKE 'TBseed%'
UNION ALL SELECT '分支', COUNT(*) FROM dev_branch
UNION ALL SELECT '分支日志', COUNT(*) FROM dev_branch_log
UNION ALL SELECT '项目成员', COUNT(*) FROM project_member
UNION ALL SELECT '任务时间线', COUNT(*) FROM task_log;

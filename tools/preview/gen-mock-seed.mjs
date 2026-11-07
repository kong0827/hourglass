// 生成 sql/seeds/seed_mock.sql：多空间 × 多项目的模拟数据（确定性随机，重复生成结果一致）
// 用法：node tools/preview/gen-mock-seed.mjs  → 再执行 mysql ... hourglass < sql/seeds/seed_mock.sql
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const TODAY = '2026-11-03';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'sql', 'seeds', 'seed_mock.sql');

/* ---------------- 工具 ---------------- */
let seed = 20261103;
function rnd() {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const pad = (n, w = 2) => String(n).padStart(w, '0');

const toD = (s) => new Date(s + 'T00:00:00Z');
const fmt = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = toD(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
const isWeekend = (s) => { const w = toD(s).getUTCDay(); return w === 0 || w === 6; };
const workday = (s) => { while (isWeekend(s)) s = addDays(s, 1); return s; };
const prevWorkday = (s) => { while (isWeekend(s)) s = addDays(s, -1); return s; };
function addWorkdays(s, n) {
  s = workday(s);
  const step = n >= 0 ? 1 : -1;
  for (let i = 0; i < Math.abs(n); i++) { s = addDays(s, step); while (isWeekend(s)) s = addDays(s, step); }
  return s;
}
function workdaysBetween(a, b) {
  const out = [];
  for (let s = a; s <= b; s = addDays(s, 1)) if (!isWeekend(s)) out.push(s);
  return out;
}
const minD = (a, b) => (a < b ? a : b);
const maxD = (a, b) => (a > b ? a : b);
const YESTERDAY = prevWorkday(addDays(TODAY, -1));

const q = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (v === '@pw' || v === '@admin' || v === '@admin_name') return v;
  return "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
};
const rows = {};
function add(table, obj) { (rows[table] ||= []).push(obj); }
function hm(min) { return pad(Math.floor(min / 60)) + ':' + pad(min % 60) + ':00'; }

/* ---------------- 人员 ---------------- */
// skill：pm 产品 / be 后端 / fe 前端 / qa 测试 / ops 运维 / ui 设计 / mob 移动端
const USERS = [
  ['Xmu01', 'zhangwei', '张伟', 'pm'],
  ['Xmu02', 'liting', '李婷', 'pm'],
  ['Xmu03', 'wanghao', '王浩', 'be'],
  ['Xmu04', 'chenjing', '陈静', 'fe'],
  ['Xmu05', 'liuyang', '刘洋', 'be'],
  ['Xmu06', 'yangfan', '杨帆', 'fe'],
  ['Xmu07', 'huangli', '黄丽', 'qa'],
  ['Xmu08', 'zhaolei', '赵磊', 'be'],
  ['Xmu09', 'zhoumin', '周敏', 'qa'],
  ['Xmu10', 'wujun', '吴俊', 'ops'],
  ['Xmu11', 'xuqian', '徐倩', 'ui'],
  ['Xmu12', 'sunpeng', '孙鹏', 'mob'],
  ['Xmu13', 'hemei', '何梅', 'mob'],
  ['Xmu14', 'gaoyuan', '高远', 'pm'],
];
const U = Object.fromEntries(USERS.map(([id, username, name, skill]) => [id, { id, username, name, skill }]));

const CATEGORIES = [
  ['功能开发', '#2563EB'], ['缺陷修复', '#cf1322'], ['测试验证', '#d48806'], ['交互设计', '#7a5c86'], ['运维部署', '#389e0d'],
];
const CAT_BY = { be: '功能开发', fe: '功能开发', mob: '功能开发', pm: '功能开发', qa: '测试验证', ui: '交互设计', ops: '运维部署' };
const TAGS = ['后端', '前端', '移动端', '接口', '性能', '安全', '技术债', '线上问题', '客户反馈'];
const TAG_BY = { be: ['后端', '接口'], fe: ['前端'], mob: ['移动端'], ops: ['性能'], qa: [], ui: [], pm: ['客户反馈'] };

/* ---------------- 空间与项目 ---------------- */
// 版本：[名称, 说明, 状态, 计划/实际发布日]；任务：[类型, 技能, 标题, 描述]
const WORKSPACES = [
  {
    id: 'SXm01', name: '支付业务部', pm: 'Xmu01',
    members: [['Xmu01', 'admin'], ['Xmu03', 'member'], ['Xmu04', 'member'], ['Xmu05', 'member'], ['Xmu07', 'member'], ['Xmu10', 'member'], ['Xmu11', 'member'], ['Xmu14', 'viewer']],
    projects: [
      {
        slug: 'paygw', name: '聚合支付网关', desc: '统一接入微信、支付宝、银联等渠道的收单网关', status: 'active', start: '2026-04-20',
        versions: [
          ['V1.0', '首版：微信/支付宝收单、统一下单与回调', 'released', '2026-06-30', [
            ['story', 'be', '统一下单接口', '屏蔽渠道差异的统一下单 API，支持幂等单号'],
            ['story', 'be', '微信支付渠道接入', 'JSAPI / Native 两种模式与签名验签'],
            ['story', 'be', '支付宝渠道接入', '当面付与手机网站支付'],
            ['story', 'fe', '收银台 H5 页面', '多渠道选择、倒计时与结果页'],
            ['task', 'ops', '网关集群部署与灰度', '双机房部署、SLB 健康检查与灰度开关'],
            ['task', 'qa', '首版联调与回归测试', '渠道沙箱全量用例回归'],
          ]],
          ['V1.1', '迭代：银联云闪付与退款链路', 'released', '2026-09-15', [
            ['story', 'be', '银联云闪付接入', '银联全渠道 API 与证书管理'],
            ['story', 'be', '退款与部分退款', '原路退款、部分退款与退款查询'],
            ['bug', 'be', '回调重复通知导致重复入账', '渠道重复回调未做幂等，个别订单重复记账'],
            ['story', 'fe', '商户后台交易查询', '按渠道、状态、时间区间检索交易'],
            ['task', 'qa', '退款场景专项测试', '部分退款、超时退款等异常场景'],
          ]],
          ['V1.2', '路由与稳定性：智能渠道路由、限流熔断', 'active', '2026-11-20', [
            ['story', 'be', '智能渠道路由', '按费率、成功率、维护窗口动态选择渠道'],
            ['story', 'be', '渠道限流与熔断', '单渠道失败率超阈值自动熔断并切换'],
            ['story', 'fe', '路由规则配置页', '可视化配置路由优先级与权重'],
            ['bug', 'be', '高并发下订单号冲突', '雪花算法时钟回拨导致单号重复'],
            ['task', 'ops', '全链路压测', '大促峰值 3000 TPS 目标压测'],
            ['task', 'qa', 'V1.2 回归测试', '路由与熔断场景回归'],
          ]],
          ['V2.0', '跨境支付：多币种收单与外汇结算', 'planned', '2027-01-15', [
            ['story', 'be', '多币种收单', '美元、港币、欧元收单与汇率锁定'],
            ['story', 'be', '外汇结算对接', '对接持牌机构完成购汇结汇'],
            ['story', 'fe', '多语言收银台', '中英繁三语收银台'],
            ['task', 'pm', '跨境合规材料梳理', '外管局报备与合规审查清单'],
          ]],
        ],
        demands: [
          ['支持数字人民币收单', '新功能', 'P1', 'review', '业务 · 钱总', null, '数币试点城市扩大，商户咨询量明显上升'],
          ['收银台支持分期付款', '新功能', 'P2', 'pass', '运营 · 孙', 3, '大额订单转化率低，分期可提升客单价'],
          ['渠道维护窗口自动规避', '体验优化', 'P1', 'plan', '运维 · 吴', 2, '渠道维护期间交易失败率高，需自动切换'],
          ['交易查询导出 Excel', '体验优化', 'P2', 'plan', '财务 · 刘', 1, '财务月底对账需要导出明细'],
          ['接入 PayPal', '新功能', 'P3', 'rej', '海外 · Amy', null, '海外业务暂缓，暂不接入'],
        ],
      },
      {
        slug: 'recon', name: '商户对账平台', desc: '渠道账单下载、自动勾兑与差错处理', status: 'active', start: '2026-07-06',
        versions: [
          ['V1.0', '首版：渠道账单下载与自动勾兑', 'released', '2026-09-10', [
            ['story', 'be', '渠道对账单自动下载', '定时拉取微信、支付宝日账单并落库'],
            ['story', 'be', '交易流水自动勾兑', '按订单号与金额双向勾兑，输出差异'],
            ['story', 'fe', '对账结果看板', '每日勾兑率、差异笔数与金额展示'],
            ['task', 'qa', '对账准确性验证', '构造长短款样本验证勾兑结果'],
          ]],
          ['V1.1', '差错处理：长短款工单与调账审批', 'active', '2026-11-28', [
            ['story', 'be', '差错工单自动生成', '勾兑差异自动生成工单并指派'],
            ['story', 'be', '调账审批流程', '调账需双人复核，留存审计轨迹'],
            ['story', 'fe', '差错处理工作台', '工单列表、详情与批量处理'],
            ['bug', 'be', '跨日交易勾兑失败', '23:59 跨日交易被划入错误账期'],
            ['task', 'qa', '差错流程测试', '工单生成、流转、调账全流程'],
          ]],
          ['V1.2', '商户自助：对账单订阅与下载中心', 'planned', '2027-01-08', [
            ['story', 'be', '对账单邮件订阅', '商户按日/月订阅对账单'],
            ['story', 'fe', '商户下载中心', '历史对账单在线查询与下载'],
            ['task', 'ui', '下载中心交互稿', '商户端下载中心交互与视觉'],
          ]],
        ],
        demands: [
          ['对账差异自动赔付', '新功能', 'P0', 'review', '运营 · 高', null, '确认的差错订单需人工登记赔付，效率低'],
          ['调账审批支持移动端', '体验优化', 'P2', 'pass', '财务 · 刘', 2, '审批人经常出差，需手机审批'],
          ['差错工单超时提醒', '体验优化', 'P1', 'plan', '运营 · 高', 1, '工单超过 48 小时未处理需升级提醒'],
          ['支持银行流水导入', '新功能', 'P2', 'review', '财务 · 刘', null, '部分线下收款需与银行流水勾兑'],
        ],
      },
      {
        slug: 'risk', name: '风控引擎', desc: '实时交易风控：规则引擎、名单管理与风险处置', status: 'active', start: '2026-09-21',
        versions: [
          ['V0.9', '内测版：规则引擎与黑白名单', 'active', '2026-12-10', [
            ['story', 'be', '实时规则引擎', '基于 Drools 的规则编排与毫秒级决策'],
            ['story', 'be', '黑白名单管理', '设备、IP、卡号名单的增删与生效'],
            ['story', 'fe', '规则配置后台', '规则可视化编辑、版本与灰度'],
            ['story', 'ui', '风控后台交互设计', '规则编辑器与名单页交互'],
            ['task', 'ops', '规则引擎性能基线', '单机 5000 QPS 下 P99 延迟基线'],
            ['task', 'qa', '规则命中准确性测试', '覆盖 120 条典型风险样本'],
          ]],
          ['V1.0', '正式版：风险处置与案件管理', 'planned', '2027-01-20', [
            ['story', 'be', '风险案件管理', '命中高风险交易自动生成案件'],
            ['story', 'be', '处置动作编排', '拦截、延迟结算、人工审核等动作'],
            ['story', 'fe', '案件处理工作台', '案件分派、处理与结案'],
          ]],
        ],
        demands: [
          ['接入设备指纹', '新功能', 'P1', 'pass', '安全 · 林', 1, '团伙作案多设备切换，需设备指纹识别'],
          ['规则命中率报表', '体验优化', 'P2', 'plan', '风控 · 马', 0, '需要评估规则有效性'],
          ['引入机器学习评分', '新功能', 'P2', 'review', '风控 · 马', null, '规则难覆盖新型欺诈模式'],
        ],
      },
    ],
  },
  {
    id: 'SXm02', name: '电商事业部', pm: 'Xmu02',
    members: [['Xmu02', 'admin'], ['Xmu04', 'member'], ['Xmu06', 'member'], ['Xmu08', 'member'], ['Xmu09', 'member'], ['Xmu11', 'member'], ['Xmu14', 'viewer']],
    projects: [
      {
        slug: 'member', name: '会员中心', desc: '会员注册、等级、积分与权益体系', status: 'active', start: '2026-03-09',
        versions: [
          ['V1.0', '首版：注册登录与会员资料', 'released', '2026-05-15', [
            ['story', 'be', '手机号注册与登录', '短信验证码登录、防刷限流'],
            ['story', 'be', '第三方账号绑定', '微信、支付宝账号绑定与解绑'],
            ['story', 'fe', '会员资料页', '头像、昵称、收货地址管理'],
            ['task', 'qa', '首版功能测试', '注册登录全流程与异常场景'],
          ]],
          ['V2.0', '等级与积分体系', 'released', '2026-08-28', [
            ['story', 'be', '会员等级规则', '按成长值自动升降级'],
            ['story', 'be', '积分获取与消耗', '下单、签到获取积分，抵扣消耗'],
            ['story', 'fe', '会员权益页', '等级权益展示与升级引导'],
            ['story', 'ui', '会员体系视觉改版', '等级勋章与权益卡视觉'],
            ['bug', 'be', '积分过期任务漏跑', '月末定时任务未执行导致积分未过期'],
            ['task', 'qa', '积分账务一致性测试', '积分流水与余额对账'],
          ]],
          ['V2.1', '付费会员：会员卡与自动续费', 'active', '2026-11-14', [
            ['story', 'be', '付费会员卡', '月卡、季卡、年卡购买与生效'],
            ['story', 'be', '自动续费签约', '微信/支付宝代扣签约与续费'],
            ['story', 'fe', '会员卡购买页', '卡种对比、购买与续费管理'],
            ['bug', 'fe', '会员页 iOS 底部遮挡', 'iPhone 安全区导致按钮被遮挡'],
            ['task', 'qa', '付费会员回归测试', '购买、续费、退订全流程'],
          ]],
        ],
        demands: [
          ['会员生日礼包', '新功能', 'P2', 'review', '运营 · 钟', null, '生日月提升复购'],
          ['积分商城', '新功能', 'P1', 'pass', '运营 · 钟', null, '积分消耗场景单一，沉淀积分过多'],
          ['付费会员专属价', '新功能', 'P1', 'plan', '商品 · 唐', 2, '付费会员需要价格权益'],
          ['会员等级降级提醒', '体验优化', 'P3', 'rej', '客服 · 叶', null, '降级提醒易引发投诉，暂不做'],
        ],
      },
      {
        slug: 'order', name: '订单履约系统', desc: '订单拆单、仓配调度与物流跟踪', status: 'active', start: '2026-05-18',
        versions: [
          ['V1.0', '首版：订单拆单与发货', 'released', '2026-07-20', [
            ['story', 'be', '订单拆单规则', '按仓库、商家、品类自动拆单'],
            ['story', 'be', '仓库发货接口', '对接 WMS 推送出库单'],
            ['story', 'fe', '订单详情物流轨迹', '展示包裹物流节点'],
            ['task', 'qa', '拆单场景测试', '多仓多商家组合场景'],
          ]],
          ['V1.1', '售后：退换货与仓配调度优化', 'active', '2026-11-25', [
            ['story', 'be', '退换货工单', '退货、换货申请与审核'],
            ['story', 'be', '就近仓调度', '按收货地址就近仓发货'],
            ['story', 'fe', '售后申请页', '退换货申请、进度查询'],
            ['bug', 'be', '物流轨迹偶发不更新', '快递 100 回调签名校验失败'],
            ['task', 'ops', '订单库分库分表', '订单表按用户 ID 分 16 库'],
            ['task', 'qa', '售后流程测试', '退换货全流程'],
          ]],
          ['V1.2', '时效：预约配送与时效承诺', 'planned', '2027-01-12', [
            ['story', 'be', '预约配送', '用户选择配送时段'],
            ['story', 'fe', '时效承诺展示', '商品页展示预计送达时间'],
          ]],
        ],
        demands: [
          ['支持门店自提', '新功能', 'P1', 'pass', '门店 · 罗', 2, '门店引流，减少配送成本'],
          ['售后极速退款', '体验优化', 'P1', 'plan', '客服 · 叶', 1, '信用好的用户退货即退款'],
          ['物流异常主动通知', '体验优化', 'P2', 'review', '客服 · 叶', null, '用户频繁咨询物流停滞'],
        ],
      },
      {
        slug: 'promo', name: '双十一营销活动', desc: '双十一大促会场、优惠券与秒杀活动', status: 'done', start: '2026-08-31',
        versions: [
          ['V1.0', '大促会场与秒杀', 'released', '2026-10-25', [
            ['story', 'be', '秒杀库存扣减', 'Redis 预扣库存与超卖防护'],
            ['story', 'be', '满减与跨店优惠券', '券模板、发放与叠加规则'],
            ['story', 'fe', '大促主会场', '会场楼层配置与倒计时'],
            ['story', 'ui', '大促视觉设计', '主会场与分会场视觉'],
            ['task', 'ops', '大促扩容与预案', '容量评估、扩容与降级预案'],
            ['bug', 'be', '优惠券叠加金额为负', '跨店券与满减叠加后实付为负'],
            ['task', 'qa', '大促全链路压测', '秒杀 5 万 QPS 压测'],
          ]],
        ],
        demands: [
          ['预售定金膨胀', '新功能', 'P1', 'plan', '运营 · 钟', 0, '提前锁定大促订单'],
          ['直播间专属券', '新功能', 'P2', 'rej', '直播 · 白', null, '直播业务未就绪'],
        ],
      },
    ],
  },
  {
    id: 'SXm03', name: '平台技术部', pm: 'Xmu01',
    members: [['Xmu01', 'admin'], ['Xmu03', 'member'], ['Xmu05', 'member'], ['Xmu08', 'member'], ['Xmu10', 'member'], ['Xmu07', 'member'], ['Xmu14', 'viewer']],
    projects: [
      {
        slug: 'sso', name: '统一认证 SSO', desc: '集团统一身份认证、单点登录与权限中心', status: 'active', start: '2026-02-23',
        versions: [
          ['V1.0', '首版：OAuth2 单点登录', 'released', '2026-04-30', [
            ['story', 'be', 'OAuth2 授权服务', '授权码模式与令牌签发'],
            ['story', 'be', '统一登录页', '账号密码登录与验证码'],
            ['task', 'ops', '认证服务高可用部署', '三节点集群与会话共享'],
            ['task', 'qa', '接入方联调测试', '首批 5 个系统接入验证'],
          ]],
          ['V1.1', '安全加固：MFA 与登录审计', 'released', '2026-07-31', [
            ['story', 'be', '多因素认证', '短信、TOTP 二次验证'],
            ['story', 'be', '登录审计日志', '登录行为记录与异常告警'],
            ['bug', 'be', '令牌刷新并发失效', '并发刷新时旧令牌提前失效'],
            ['task', 'qa', '安全渗透测试', '第三方渗透测试问题整改验证'],
          ]],
          ['V1.2', '权限中心：RBAC 与组织同步', 'active', '2026-11-30', [
            ['story', 'be', 'RBAC 权限模型', '角色、权限点与数据权限'],
            ['story', 'be', '组织架构同步', '对接 HR 系统增量同步'],
            ['story', 'be', '权限管理后台', '角色授权与权限查询'],
            ['bug', 'be', 'LDAP 同步中文乱码', '部门名称同步后乱码'],
            ['task', 'qa', '权限回归测试', '典型角色权限矩阵验证'],
          ]],
        ],
        demands: [
          ['支持企业微信扫码登录', '新功能', 'P1', 'plan', '行政 · 唐', 2, '员工习惯企业微信'],
          ['登录页品牌化配置', '体验优化', 'P3', 'review', '品牌 · 苏', null, '子公司需要独立登录页'],
          ['接入 FIDO 无密码登录', '新功能', 'P2', 'pass', '安全 · 林', null, '降低密码泄露风险'],
        ],
      },
      {
        slug: 'monitor', name: '监控告警平台', desc: '指标采集、告警规则与值班通知一体化', status: 'active', start: '2026-10-12',
        versions: [
          ['V1.0', '首版：指标采集与告警通知', 'active', '2026-12-15', [
            ['task', 'ops', 'Prometheus 集群搭建', '联邦集群与长期存储'],
            ['story', 'be', '告警规则管理', '阈值、同比环比规则配置'],
            ['story', 'be', '告警通知分派', '按值班表分派电话、短信、企业微信'],
            ['story', 'be', '监控大盘', '核心业务指标大盘'],
            ['task', 'qa', '告警准确性验证', '误报漏报样本验证'],
          ]],
        ],
        demands: [
          ['告警收敛与降噪', '新功能', 'P1', 'pass', '运维 · 吴', 0, '一次故障产生上百条告警'],
          ['值班表自动排班', '体验优化', 'P2', 'review', '运维 · 吴', null, '人工排班易遗漏'],
        ],
      },
      {
        slug: 'dmdb', name: '数据库国产化迁移', desc: '核心业务库从 MySQL 迁移至达梦', status: 'hold', start: '2026-08-17',
        versions: [
          ['V1.0', '迁移首批：账户与认证库', 'planned', '2027-03-31', [
            ['task', 'be', '达梦兼容性评估', 'SQL 方言、函数与驱动兼容性评估'],
            ['task', 'ops', '信创环境准备', '服务器与操作系统采购部署'],
            ['task', 'be', '数据迁移工具选型', 'DTS 与自研工具对比'],
            ['task', 'qa', '迁移验证方案', '数据一致性与性能对比方案'],
          ]],
        ],
        demands: [
          ['迁移期间双写方案', '新功能', 'P1', 'review', 'DBA · 郑', null, '保证迁移期间可回切'],
        ],
      },
    ],
  },
  {
    id: 'SXm04', name: '移动端团队', pm: 'Xmu02',
    members: [['Xmu02', 'admin'], ['Xmu12', 'member'], ['Xmu13', 'member'], ['Xmu09', 'member'], ['Xmu11', 'member'], ['Xmu06', 'member']],
    projects: [
      {
        slug: 'app4', name: '掌上营业厅 App 4.0', desc: 'iOS / Android 双端全新改版', status: 'active', start: '2026-06-08',
        versions: [
          ['V4.0', '全新首页与账户中心', 'released', '2026-08-15', [
            ['story', 'mob', '新版首页框架', '组件化首页与楼层动态配置'],
            ['story', 'mob', '账户中心', '余额、账单与套餐展示'],
            ['story', 'ui', '4.0 视觉规范', '新版设计语言与组件库'],
            ['task', 'qa', '双端兼容性测试', '主流 30 款机型兼容测试'],
          ]],
          ['V4.1', '消息中心与深色模式', 'active', '2026-11-18', [
            ['story', 'mob', '消息中心', '系统通知、活动消息与已读管理'],
            ['story', 'mob', '深色模式适配', '全页面深色模式'],
            ['bug', 'mob', 'Android 12 推送不到达', '厂商通道配置缺失'],
            ['story', 'ui', '深色模式色板', '深色模式色彩与对比度规范'],
            ['task', 'qa', '4.1 回归测试', '消息与深色模式回归'],
          ]],
          ['V4.2', '智能客服与无障碍', 'planned', '2027-01-10', [
            ['story', 'mob', '智能客服入口', '接入 AI 客服对话'],
            ['story', 'mob', '无障碍适配', '读屏与大字体适配'],
          ]],
        ],
        demands: [
          ['首页支持个性化推荐', '新功能', 'P1', 'pass', '运营 · 钟', 2, '提升首页点击率'],
          ['App 启动速度优化', '体验优化', 'P0', 'plan', '用户反馈', 1, '冷启动超过 3 秒，差评集中'],
          ['支持 HarmonyOS NEXT', '新功能', 'P1', 'review', '技术委员会', null, '鸿蒙用户占比上升'],
        ],
      },
      {
        slug: 'mpperf', name: '小程序性能治理', desc: '小程序包体积、首屏与白屏率专项治理', status: 'active', start: '2026-10-08',
        versions: [
          ['V1.0', '首屏与包体积治理', 'active', '2026-11-30', [
            ['task', 'fe', '分包与按需加载', '主包体积降到 1.5MB 以下'],
            ['task', 'fe', '首屏骨架屏', '核心页面骨架屏与预加载'],
            ['bug', 'fe', '低端机白屏', '低端安卓机首屏白屏率 3%'],
            ['task', 'qa', '性能基线对比', '治理前后性能数据对比'],
          ]],
        ],
        demands: [
          ['接入性能监控 SDK', '新功能', 'P1', 'plan', '前端 · 杨', 0, '缺少线上性能数据'],
        ],
      },
    ],
  },
];

/* ---------------- 文案池 ---------------- */
const BLOCK_REASONS = ['等待渠道方提供测试环境', '依赖接口尚未提测', '等待安全评审结论', '等待设计稿定稿', '测试环境数据库故障', '等待第三方签约完成'];
const COMMENTS = [
  '方案已和后端对齐，按评审结论实现。', '接口文档已更新，请前端同步联调。', '这个场景需要补一条异常用例。',
  '今天联调发现超时问题，已定位到连接池配置。', '已提测，测试环境地址见群公告。', '代码已合并到 release 分支。',
  '验收通过，可以关闭。', '预计明天完成自测。', '需求有调整，以最新文档为准。', '性能数据已贴在附件里，比基线提升 30%。',
];
const SUBTASKS = {
  be: ['接口设计评审', '核心逻辑实现', '单元测试', '提测'],
  fe: ['交互走查', '页面开发', '接口联调', '提测'],
  mob: ['方案评审', '双端开发', '真机联调', '提测'],
  qa: ['编写测试用例', '执行测试', '缺陷跟踪', '输出测试报告'],
  ops: ['资源评估', '环境搭建', '演练验证'],
  ui: ['竞品调研', '交互稿', '视觉稿', '设计评审'],
  pm: ['资料收集', '方案编写', '评审确认'],
};

/* ---------------- 生成 ---------------- */
let taskSeq = 0, depSeq = 0, branchLogSeq = 0;
const tid = () => 'XmK' + pad(++taskSeq, 4);
const adminRefs = [];

for (const [id, username, name] of USERS) {
  add('app_user', { id, username, password_hash: '@pw', display_name: name, email: `${username}@example.com`, role: 'user', last_workspace_id: null, created_at: '2026-02-01 10:00:00' });
  add('workspace', { id: 'W' + id, name: '我的看板', type: 'personal', owner_id: id, created_at: '2026-02-01 10:00:00' });
  add('workspace_member', { workspace_id: 'W' + id, user_id: id, role: 'owner', created_at: '2026-02-01 10:00:00' });
  add('board_column', { id: 'backlog', workspace_id: 'W' + id, name: '待处理', color: '#c08a3e', sort_order: 0 });
  add('board_column', { id: 'doing', workspace_id: 'W' + id, name: '进行中', color: '#5b83ad', sort_order: 1 });
  [['工作', '#5b83ad'], ['学习', '#5f7a4a'], ['生活', '#7a5c86'], ['其他', '#8a8578']].forEach(([n, c], i) =>
    add('category', { id: `XmGp${id.slice(3)}${i}`, workspace_id: 'W' + id, name: n, color: c, sort_order: i }));
}
const lastWs = {};

for (const ws of WORKSPACES) {
  const W = ws.id;
  const pmId = ws.pm;
  add('workspace', { id: W, name: ws.name, type: 'shared', owner_id: '@admin', created_at: '2026-02-10 10:00:00' });
  add('workspace_member', { workspace_id: W, user_id: '@admin', role: 'owner', created_at: '2026-02-10 10:00:00' });
  for (const [uid, role] of ws.members) {
    add('workspace_member', { workspace_id: W, user_id: uid, role, created_at: '2026-02-12 10:00:00' });
    lastWs[uid] ||= W;
  }
  add('board_column', { id: 'backlog', workspace_id: W, name: '待处理', color: '#c08a3e', sort_order: 0 });
  add('board_column', { id: 'doing', workspace_id: W, name: '进行中', color: '#5b83ad', sort_order: 1 });
  add('board_column', { id: 'Cxmtest', workspace_id: W, name: '待测试', color: '#d48806', sort_order: 2 });
  CATEGORIES.forEach(([n, c], i) => add('category', { id: `XmG${W.slice(3)}${i}`, workspace_id: W, name: n, color: c, sort_order: (i + 1) * 10 }));
  const tagId = {};
  TAGS.forEach((n, i) => { tagId[n] = `XmT${W.slice(3)}${pad(i)}`; add('tag', { id: tagId[n], workspace_id: W, name: n }); });

  const editors = ws.members.filter(([, r]) => r !== 'viewer').map(([u]) => u);
  const rot = {};
  const ownerFor = (skill) => {
    let pool = editors.filter((u) => U[u].skill === skill);
    if (!pool.length) pool = editors.filter((u) => U[u].skill !== 'pm');
    rot[skill] = ((rot[skill] ?? -1) + 1) % pool.length;
    return pool[rot[skill]];
  };
  const qaPool = editors.filter((u) => U[u].skill === 'qa');
  let colOrder = { backlog: 0, doing: 0, Cxmtest: 0, done: 0 };
  let branchSort = 0;

  ws.projects.forEach((p, pi) => {
    const R = `XmR${W.slice(3)}${pi + 1}`;
    const projOwners = new Set();
    const pmName = U[pmId].name;
    const projCreated = addDays(p.start, -10) + ' 10:00:00';
    const firstRel = p.versions.find((v) => v[2] === 'released');
    add('requirement', { id: R, workspace_id: W, name: p.name, description: p.desc, status: p.status, first_released_at: firstRel ? firstRel[3] : null, created_at: projCreated, updated_at: projCreated });
    add('work_activity', { workspace_id: W, entity_type: 'project', entity_id: R, actor_id: pmId, actor_name: pmName, action: 'create', detail: `创建项目「${p.name}」`, created_at: projCreated });
    if (firstRel) add('work_activity', { workspace_id: W, entity_type: 'project', entity_id: R, actor_id: pmId, actor_name: pmName, action: 'first_release', detail: `标记首版上线 ${firstRel[3]}`, created_at: firstRel[3] + ' 20:30:00' });

    const rootDoc = `XmD${W.slice(3)}${pi + 1}0`;
    const versionIds = [];
    const versionDocs = [];
    const storiesByVersion = [];
    let vStart = p.start;

    p.versions.forEach(([vName, vDesc, vStatus, vDate, tasks], vi) => {
      const V = `XmV${W.slice(3)}${pi + 1}${vi + 1}`;
      versionIds.push(V);
      const vEnd = vDate;
      add('project_version', { id: V, workspace_id: W, req_id: R, name: vName, description: vDesc, status: vStatus, target_date: vDate, released_at: vStatus === 'released' ? vDate + ' 20:00:00' : null, created_at: addDays(vStart, -5) + ' 10:00:00' });
      const vDoc = `XmD${W.slice(3)}${pi + 1}${vi + 1}`;
      versionDocs.push(vDoc);

      const span = Math.max(workdaysBetween(vStart, vEnd).length - 2, 6);
      const work = tasks.map(([type, skill, title, desc], i) => {
        let start, end;
        if (skill === 'qa') {
          start = addWorkdays(vEnd, -Math.min(7, Math.floor(span / 3)));
          end = addWorkdays(vEnd, -1);
        } else {
          start = addWorkdays(vStart, Math.floor((i * span) / (tasks.length + 1)));
          end = minD(addWorkdays(start, ri(4, Math.max(5, Math.floor(span / 2)))), addWorkdays(vEnd, -2));
          if (end < start) end = start;
        }
        return { type, skill, title, desc, start, end };
      });

      const versionTaskIds = [];
      const created = [];
      const activeOverdue = vStatus === 'active'
        ? work.filter((w) => w.skill !== 'qa' && w.end < YESTERDAY).sort((a, b) => b.end.localeCompare(a.end))[0]
        : null;
      let blockedPicked = false;

      for (const w of work) {
        const K = tid();
        const owner = ownerFor(w.skill);
        projOwners.add(owner);
        const est = Math.max(1, workdaysBetween(w.start, w.end).length) * 480 * (ri(55, 95) / 100);
        const estimate = Math.round(est / 60) * 60;
        let col = 'backlog', progress = 0, completed = null, blocked = 0, reason = null, note = null;
        let start = w.start, due = w.end, baseline = null;

        if (vStatus === 'released' || p.status === 'done') {
          col = 'done'; progress = 100;
          completed = prevWorkday(minD(maxD(addDays(w.end, ri(-1, 2)), w.start), vEnd));
        } else if (vStatus === 'active') {
          if (w === activeOverdue) {
            col = 'doing'; progress = ri(70, 85); note = '联调问题较多，已延期';
          } else if (w.end < TODAY) {
            col = 'done'; progress = 100; completed = prevWorkday(minD(maxD(addDays(w.end, ri(-1, 1)), w.start), YESTERDAY));
          } else if (w.start <= TODAY) {
            const all = workdaysBetween(w.start, w.end).length || 1;
            const passed = workdaysBetween(w.start, YESTERDAY).length;
            progress = Math.min(90, Math.max(10, Math.round((passed / all) * 100 / 5) * 5));
            col = progress >= 80 && qaPool.length && w.skill !== 'qa' ? 'Cxmtest' : 'doing';
            if (!blockedPicked && col === 'doing' && rnd() < 0.5) { blocked = 1; reason = pick(BLOCK_REASONS); blockedPicked = true; }
          } else {
            if (!blockedPicked && w.type !== 'bug' && rnd() < 0.4) { blocked = 1; reason = pick(BLOCK_REASONS); blockedPicked = true; }
          }
          if (col !== 'done' && rnd() < 0.3) { baseline = { start, due }; due = addWorkdays(due, ri(2, 5)); if (w === activeOverdue) due = minD(due, YESTERDAY); }
          else baseline = { start, due };
        } else {
          if (p.status === 'hold' && w.start < TODAY && w.skill === 'be' && created.length === 0) {
            col = 'done'; progress = 100; completed = prevWorkday(minD(w.end, YESTERDAY));
          } else if (p.status === 'hold' && w.skill === 'ops') {
            blocked = 1; reason = '信创服务器采购审批中，项目暂停';
          }
          if (rnd() < 0.2 && col === 'backlog') { start = null; due = null; }
        }

        const priority = w.type === 'bug' ? pick(['P0', 'P1', 'P1']) : w.type === 'story' ? pick(['P1', 'P1', 'P2']) : pick(['P2', 'P2', 'P3']);
        const createdAt = minD(addDays(w.start, -ri(2, 6)), addDays(TODAY, -1)) + ' ' + hm(ri(9 * 60, 17 * 60));
        let updatedAt = createdAt;
        const logs = [];
        logs.push({ action: 'create', detail: `创建任务「${w.title}」（加入版本 ${vName}）`, at: createdAt, actor: pmId });

        // 工时
        let total = 0, firstAt = null, lastAt = null;
        if (col !== 'backlog') {
          const until = completed || YESTERDAY;
          let days = workdaysBetween(w.start, until);
          if (days.length > 15) days = days.filter((_, i) => i % Math.ceil(days.length / 15) === 0);
          const target = col === 'done' ? Math.round(estimate * (ri(80, 135) / 100)) : Math.round(estimate * progress / 100);
          const per = Math.max(60, Math.min(450, Math.round(target / Math.max(days.length, 1) / 10) * 10));
          for (const d of days) {
            const m = Math.max(30, Math.min(450, per + ri(-6, 6) * 10));
            const st = ri(0, 1) ? 9 * 60 + 30 : 13 * 60 + 30;
            const s = `${d} ${hm(st)}`, e = `${d} ${hm(Math.min(st + m, 23 * 60))}`;
            add('time_log', { task_id: K, workspace_id: W, user_id: owner, started_at: s, ended_at: e, minutes: m });
            total += m; firstAt ||= s; lastAt = e;
          }
          logs.push({ action: 'move', detail: '从「待处理」移动到「进行中」', from: 'backlog', to: 'doing', at: `${w.start} 09:20:00`, actor: owner });
          if (col === 'Cxmtest' || (col === 'done' && qaPool.length && w.skill !== 'qa' && completed > w.start)) {
            const tAt = col === 'done' ? prevWorkday(addDays(completed, -1)) : YESTERDAY;
            if (tAt >= w.start) logs.push({ action: 'move', detail: '从「进行中」移动到「待测试」', from: 'doing', to: 'Cxmtest', at: `${tAt} 17:40:00`, actor: owner });
          }
          if (col === 'done') {
            const prev = logs[logs.length - 1].to;
            logs.push({ action: 'move', detail: `从「${prev === 'Cxmtest' ? '待测试' : '进行中'}」移动到「已完成」`, from: prev, to: 'done', at: `${completed} 18:10:00`, actor: prev === 'Cxmtest' && qaPool.length ? pick(qaPool) : owner });
          }
          updatedAt = logs[logs.length - 1].at;
        }

        const rec = {
          id: K, workspace_id: W, title: w.title, description: w.desc, item_type: w.type, epic_id: null, demand_id: null,
          priority, owner: U[owner].name, owner_user_id: owner, category: w.type === 'bug' ? '缺陷修复' : CAT_BY[w.skill],
          board_column: col, start_date: start, due_date: due, req_id: R, req_doc_id: w.type === 'story' ? vDoc : null, branch_id: null,
          progress, is_milestone: 0, estimate_minutes: estimate, is_blocked: blocked, blocked_reason: reason, note,
          completed_at: completed, sort_order: colOrder[col]++, created_at: createdAt, updated_at: updatedAt,
        };
        add('task', rec);
        versionTaskIds.push(K);
        created.push({ rec, w, owner, logs, total, firstAt, lastAt, baseline });
      }

      // 史诗（版本主题）与里程碑
      const children = created.filter((c) => c.rec.item_type === 'story');
      const E = tid();
      const eDone = created.every((c) => c.rec.board_column === 'done');
      const eStarted = created.some((c) => c.rec.board_column !== 'backlog');
      const eStart = created.map((c) => c.w.start).sort()[0];
      const eEnd = created.map((c) => c.w.end).sort().at(-1);
      const eProg = Math.round(created.reduce((s, c) => s + c.rec.progress, 0) / created.length);
      const eCompleted = eDone ? created.map((c) => c.rec.completed_at).sort().at(-1) : null;
      // 史诗标题取版本主题的业务表述（冒号后部分），避免与版本号重名
      const eTheme = (vDesc.includes('：') ? vDesc.split('：').slice(1).join('：') : vDesc).slice(0, 60);
      add('task', {
        id: E, workspace_id: W, title: eTheme, description: vDesc.slice(0, 200), item_type: 'epic', epic_id: null, demand_id: null,
        priority: 'P1', owner: pmName, owner_user_id: pmId, category: '功能开发', board_column: eDone ? 'done' : eStarted ? 'doing' : 'backlog',
        start_date: eStart, due_date: eEnd, req_id: R, req_doc_id: vDoc, branch_id: null, progress: eProg, is_milestone: 0, estimate_minutes: null,
        is_blocked: 0, blocked_reason: null, note: null, completed_at: eCompleted, sort_order: 0,
        created_at: addDays(vStart, -7) + ' 10:00:00', updated_at: (eCompleted || addDays(vStart, -7)) + ' 18:30:00',
      });
      children.forEach((c) => { c.rec.epic_id = E; });
      add('task_log', { task_id: E, workspace_id: W, actor_id: pmId, action: 'create', detail: `创建史诗「${eTheme}」`, created_at: addDays(vStart, -7) + ' 10:00:00' });

      const M = tid();
      const released = vStatus === 'released' || p.status === 'done';
      add('task', {
        id: M, workspace_id: W, title: `${p.name} ${vName} 发布`.slice(0, 60), description: `${vName} 版本发布节点`, item_type: 'task', epic_id: null, demand_id: null,
        priority: 'P1', owner: pmName, owner_user_id: pmId, category: '运维部署', board_column: released ? 'done' : 'backlog',
        start_date: vDate, due_date: vDate, req_id: R, req_doc_id: null, branch_id: null, progress: released ? 100 : 0, is_milestone: 1, estimate_minutes: null,
        is_blocked: 0, blocked_reason: null, note: null, completed_at: released ? vDate : null, sort_order: 0,
        created_at: addDays(vStart, -7) + ' 10:05:00', updated_at: (released ? vDate : addDays(vStart, -7)) + ' 20:00:00',
      });
      versionTaskIds.push(E, M);
      for (const x of versionTaskIds) add('version_task', { task_id: x, workspace_id: W, version_id: V, created_at: addDays(vStart, -5) + ' 10:00:00' });
      if (released) {
        for (const x of [E, M]) {
          const t = rows.task.find((r) => r.id === x);
          add('task_completion_record', { workspace_id: W, task_id: x, title: t.title, description: t.description, req_id: R, req_name: p.name, req_doc_id: t.req_doc_id, req_doc_title: t.req_doc_id ? `${vName} 需求说明` : null, owner: pmName, owner_user_id: pmId, category: t.category, priority: 'P1', start_date: t.start_date, completed_at: t.completed_at, first_started_at: null, last_ended_at: null, total_minutes: 0, created_at: t.completed_at + ' 20:00:00' });
        }
      }

      // 明细：子任务 / 标签 / 评论 / 日志 / 完成快照 / 基线
      for (const c of created) {
        const { rec, w, owner } = c;
        const subs = SUBTASKS[w.skill] || SUBTASKS.be;
        if (rec.item_type !== 'bug') {
          const doneCnt = rec.board_column === 'done' ? subs.length : rec.board_column === 'backlog' ? 0 : Math.round(subs.length * rec.progress / 100);
          subs.forEach((s, i) => add('subtask', { task_id: rec.id, workspace_id: W, title: s, done: i < doneCnt ? 1 : 0, created_at: rec.created_at }));
        }
        const tags = [...(TAG_BY[w.skill] || [])];
        if (rec.item_type === 'bug') tags.push('线上问题');
        if (/性能|压测|首屏|速度|延迟/.test(w.title + w.desc)) tags.push('性能');
        if (/安全|渗透|风控|MFA|认证|验签/.test(w.title + w.desc)) tags.push('安全');
        [...new Set(tags)].slice(0, 3).forEach((t) => add('task_tag', { task_id: rec.id, tag_id: tagId[t], workspace_id: W }));

        if (rec.board_column !== 'backlog') {
          const n = ri(1, 3);
          for (let i = 0; i < n; i++) {
            const author = i === 0 ? owner : pick([pmId, owner, ...(qaPool.length ? [pick(qaPool)] : [])]);
            const day = c.logs[Math.min(i + 1, c.logs.length - 1)].at.slice(0, 10);
            add('task_comment', { task_id: rec.id, workspace_id: W, author_id: author, author_name: U[author].name, content: pick(COMMENTS), created_at: `${day} ${hm(ri(10 * 60, 17 * 60))}` });
          }
        }
        if (rec.is_blocked) add('task_comment', { task_id: rec.id, workspace_id: W, author_id: owner, author_name: U[owner].name, content: `卡点：${rec.blocked_reason}，已在群里同步，请 PM 协调。`, created_at: `${minD(TODAY, maxD(rec.created_at.slice(0, 10), addDays(TODAY, -2)))} 11:20:00` });
        for (const l of c.logs) add('task_log', { task_id: rec.id, workspace_id: W, actor_id: l.actor, action: l.action, detail: l.detail, from_column: l.from || null, to_column: l.to || null, created_at: l.at });
        if (rec.board_column === 'done') {
          add('task_completion_record', { workspace_id: W, task_id: rec.id, title: rec.title, description: rec.description, req_id: R, req_name: p.name, req_doc_id: rec.req_doc_id, req_doc_title: rec.req_doc_id ? `${vName} 需求说明` : null, owner: rec.owner, owner_user_id: owner, category: rec.category, priority: rec.priority, start_date: rec.start_date, completed_at: rec.completed_at, first_started_at: c.firstAt, last_ended_at: c.lastAt, total_minutes: c.total, created_at: rec.completed_at + ' 18:10:00' });
        }
        if (c.baseline && c.baseline.start) add('task_baseline', { workspace_id: W, task_id: rec.id, start_date: c.baseline.start, due_date: c.baseline.due, captured_at: addDays(vStart, -1) + ' 18:00:00' });
        if (rec.board_column === 'doing' || rec.board_column === 'Cxmtest') {
          add('app_notification', { user_id: owner, workspace_id: W, type: 'task_assigned', title: `你被指派了任务：${rec.title}`, body: `${pmName} 将任务指派给你，截止 ${rec.due_date}`, ref_task_id: rec.id, read_at: rnd() < 0.5 ? rec.created_at : null, created_at: rec.created_at });
          if (rec.due_date && rec.due_date < TODAY) add('app_notification', { user_id: owner, workspace_id: W, type: 'task_due', title: `任务已逾期：${rec.title}`, body: `截止日 ${rec.due_date}，请更新进度或调整计划`, ref_task_id: rec.id, read_at: null, created_at: `${TODAY} 09:00:00` });
        }
      }

      // 依赖：前三个开发任务串行 FS，最后一个测试任务 → 里程碑
      const dev = created.filter((c) => c.w.skill !== 'qa' && c.rec.start_date);
      for (let i = 0; i + 1 < Math.min(dev.length, 3); i++) {
        if (dev[i].w.end <= dev[i + 1].w.start) add('task_dependency', { id: 'XmP' + pad(++depSeq, 4), workspace_id: W, from_task_id: dev[i].rec.id, to_task_id: dev[i + 1].rec.id, dep_type: 'FS', lag_days: 0, created_at: dev[i].rec.created_at });
      }
      const qaTask = created.find((c) => c.w.skill === 'qa' && c.rec.start_date);
      if (qaTask) add('task_dependency', { id: 'XmP' + pad(++depSeq, 4), workspace_id: W, from_task_id: qaTask.rec.id, to_task_id: M, dep_type: 'FS', lag_days: 0, created_at: qaTask.rec.created_at });

      // 分支：已发布版本一条 release 分支；进行中版本给开发中的需求建 feature 分支
      if (released) {
        const B = `XmB${W.slice(3)}${pi + 1}${vi + 1}0`;
        const name = `release/${p.slug}-${vName.toLowerCase()}`;
        const relAt = vDate + ' 20:00:00', devAt = vStart + ' 10:00:00';
        add('dev_branch', { id: B, workspace_id: W, name, status: 'released', owner: pmName, owner_user_id: pmId, target_branch: 'main', note: `${vName} 发布分支`, dev_at: devAt, test_at: addWorkdays(vDate, -5) + ' 18:00:00', merge_at: addWorkdays(vDate, -1) + ' 18:00:00', released_at: relAt, sort_order: branchSort++, created_at: devAt, updated_at: relAt });
        [['create', null, 'dev', devAt], ['status', 'dev', 'testing', addWorkdays(vDate, -5) + ' 18:00:00'], ['status', 'testing', 'merging', addWorkdays(vDate, -1) + ' 18:00:00'], ['status', 'merging', 'released', relAt]]
          .forEach(([a, f, t, at]) => add('dev_branch_log', { id: 'XmBL' + pad(++branchLogSeq, 4), workspace_id: W, branch_id: B, action: a, from_status: f, to_status: t, detail: a === 'create' ? '创建分支' : null, actor_name: pmName, actor_user_id: pmId, created_at: at }));
        created.forEach((c) => { if (c.rec.item_type !== 'task') c.rec.branch_id = B; });
      } else if (vStatus === 'active') {
        created.filter((c) => c.rec.item_type !== 'task' && c.rec.board_column !== 'backlog').slice(0, 3).forEach((c, bi) => {
          const B = `XmB${W.slice(3)}${pi + 1}${vi + 1}${bi + 1}`;
          const status = c.rec.board_column === 'done' ? 'merging' : c.rec.board_column === 'Cxmtest' ? 'testing' : 'dev';
          const name = `${c.rec.item_type === 'bug' ? 'hotfix' : 'feature'}/${p.slug}-${c.rec.id.toLowerCase()}`;
          const devAt = c.w.start + ' 09:30:00';
          const testAt = status !== 'dev' ? (c.rec.completed_at ? addDays(c.rec.completed_at, -1) : YESTERDAY) + ' 17:40:00' : null;
          const mergeAt = status === 'merging' ? c.rec.completed_at + ' 18:10:00' : null;
          add('dev_branch', { id: B, workspace_id: W, name, status, owner: c.rec.owner, owner_user_id: c.owner, target_branch: `release/${p.slug}-${vName.toLowerCase()}`, note: c.rec.title, dev_at: devAt, test_at: testAt, merge_at: mergeAt, released_at: null, sort_order: branchSort++, created_at: devAt, updated_at: mergeAt || testAt || devAt });
          add('dev_branch_log', { id: 'XmBL' + pad(++branchLogSeq, 4), workspace_id: W, branch_id: B, action: 'create', from_status: null, to_status: 'dev', detail: '创建分支', actor_name: c.rec.owner, actor_user_id: c.owner, created_at: devAt });
          if (testAt) add('dev_branch_log', { id: 'XmBL' + pad(++branchLogSeq, 4), workspace_id: W, branch_id: B, action: 'status', from_status: 'dev', to_status: 'testing', detail: '提测', actor_name: c.rec.owner, actor_user_id: c.owner, created_at: testAt });
          if (mergeAt) add('dev_branch_log', { id: 'XmBL' + pad(++branchLogSeq, 4), workspace_id: W, branch_id: B, action: 'status', from_status: 'testing', to_status: 'merging', detail: '测试通过，待合并', actor_name: c.rec.owner, actor_user_id: c.owner, created_at: mergeAt });
          c.rec.branch_id = B;
        });
      }

      // 版本需求文档
      const docStatus = released ? 'done' : vStatus === 'active' ? 'active' : 'draft';
      const docOwner = pmId;
      const storyList = created.filter((c) => c.rec.item_type === 'story');
      const html = `<h2>背景与目标</h2><p>${vDesc}。</p><h2>需求范围</h2><ul>${storyList.map((c) => `<li><strong>${c.rec.title}</strong>：${c.rec.description}</li>`).join('')}</ul><h2>验收标准</h2><ol>${storyList.map((c) => `<li>${c.rec.title}功能完整可用，异常场景有明确提示</li>`).join('')}<li>核心接口 P99 延迟不高于 300ms</li></ol><h2>上线计划</h2><p>计划 ${vDate} 发布，发布前完成回归测试与上线评审。</p>`;
      const brief = `${vDesc}。范围：${storyList.map((c) => c.rec.title).join('、')}`.slice(0, 400);
      const docAt = addDays(vStart, -8) + ' 15:00:00';
      add('requirement_doc', { id: vDoc, workspace_id: W, req_id: R, parent_id: rootDoc, title: `${vName} 需求说明`, content: html, format: 'html', content_brief: brief, status: docStatus, sort_order: vi + 1, owner: U[docOwner].name, owner_user_id: docOwner, created_at: docAt, updated_at: docAt });
      add('work_activity', { workspace_id: W, entity_type: 'requirement_doc', entity_id: vDoc, actor_id: docOwner, actor_name: U[docOwner].name, action: 'create', detail: `创建需求「${vName} 需求说明」`, created_at: docAt });
      storiesByVersion.push(created.filter((c) => c.rec.item_type === 'story'));

      vStart = workday(addDays(vDate, 3));
    });

    // 项目根文档与接口文档
    const rootAt = addDays(p.start, -9) + ' 10:00:00';
    add('requirement_doc', { id: rootDoc, workspace_id: W, req_id: R, parent_id: null, title: `${p.name} 产品需求总览`, content: `<h2>项目定位</h2><p>${p.desc}。</p><h2>版本规划</h2><ul>${p.versions.map((v) => `<li>${v[0]}（${v[3]}）：${v[1]}</li>`).join('')}</ul><h2>干系人</h2><p>产品负责人：${pmName}</p>`, format: 'html', content_brief: `${p.desc}。共 ${p.versions.length} 个版本规划。`, status: 'active', sort_order: 0, owner: pmName, owner_user_id: pmId, created_at: rootAt, updated_at: rootAt });
    add('work_activity', { workspace_id: W, entity_type: 'requirement_doc', entity_id: rootDoc, actor_id: pmId, actor_name: pmName, action: 'create', detail: `创建需求「${p.name} 产品需求总览」`, created_at: rootAt });
    const apiDoc = `XmD${W.slice(3)}${pi + 1}9`;
    const beOwner = [...projOwners].find((u) => U[u].skill === 'be' || U[u].skill === 'mob' || U[u].skill === 'fe') || pmId;
    add('requirement_doc', { id: apiDoc, workspace_id: W, req_id: R, parent_id: rootDoc, title: `${p.name} 接口设计说明`, content: `# 接口设计说明\n\n## 通用约定\n\n- 统一返回 \`{ code, message, data }\`\n- 时间统一使用 \`yyyy-MM-dd HH:mm:ss\`\n- 幂等接口需携带 \`Idempotency-Key\`\n\n## 错误码\n\n| 错误码 | 含义 |\n| --- | --- |\n| 0 | 成功 |\n| 40001 | 参数错误 |\n| 50001 | 系统繁忙 |\n`, format: 'markdown', content_brief: '接口通用约定、返回结构与错误码说明', status: 'active', sort_order: 99, owner: U[beOwner].name, owner_user_id: beOwner, created_at: addDays(p.start, -3) + ' 16:00:00', updated_at: addDays(p.start, 20) + ' 11:00:00' });
    add('work_activity', { workspace_id: W, entity_type: 'requirement_doc', entity_id: apiDoc, actor_id: beOwner, actor_name: U[beOwner].name, action: 'update', detail: '更新错误码说明', created_at: addDays(p.start, 20) + ' 11:00:00' });

    // 需求池
    p.demands.forEach(([title, kind, priority, status, source, vIdx, why], di) => {
      const Dm = `XmQ${W.slice(3)}${pi + 1}${di + 1}`;
      const creator = di % 2 === 0 ? pmId : pick(editors);
      const createdAt = minD(addDays(p.start, di * 9 + 2), addDays(TODAY, -3 + di)) + ' 10:30:00';
      const versionId = (status === 'plan' || status === 'pass') && vIdx !== null ? versionIds[Math.min(vIdx, versionIds.length - 1)] : null;
      const note = status === 'rej' ? why : status === 'pass' ? '评审通过，待排期' : status === 'plan' ? '已拆解任务进入版本开发' : null;
      add('demand', {
        id: Dm, workspace_id: W, req_id: R, title, description: status === 'rej' ? `${title}，提升用户体验与业务转化` : why, source, item_kind: kind, priority, status,
        expect_date: status === 'rej' ? null : addDays(TODAY, 10 + di * 12), accept_text: `${title}上线后功能可用；关键数据可在报表中查看；异常场景有明确提示`,
        version_id: versionId, review_note: note, wsjf_business: ri(3, 9), wsjf_urgency: ri(2, 9), wsjf_risk: ri(1, 7), wsjf_effort: ri(2, 8),
        created_by: creator, created_at: createdAt, updated_at: createdAt,
      });
      add('demand_log', { workspace_id: W, demand_id: Dm, action: 'create', note: '提交需求', operator: creator, created_at: createdAt });
      if (status !== 'review') add('demand_log', { workspace_id: W, demand_id: Dm, action: status === 'rej' ? 'rej' : 'pass', note: status === 'rej' ? why : '评审通过', operator: pmId, created_at: addDays(createdAt.slice(0, 10), 2) + ' 15:00:00' });
      if (status === 'plan') {
        add('demand_log', { workspace_id: W, demand_id: Dm, action: 'plan', note: note, operator: pmId, created_at: addDays(createdAt.slice(0, 10), 4) + ' 15:00:00' });
        const vi = Math.min(vIdx, versionIds.length - 1);
        const story = (storiesByVersion[vi] || []).find((c) => !c.rec.demand_id);
        if (story) story.rec.demand_id = Dm;
      }
      add('demand_doc_link', { workspace_id: W, demand_id: Dm, doc_id: versionId ? versionDocs[versionIds.indexOf(versionId)] : rootDoc, created_by: pmId, created_at: createdAt });
      if (status === 'review') {
        add('app_notification', { user_id: '@admin', workspace_id: W, type: 'demand_status', title: `新需求待评审：${title}`, body: `${U[creator].name} 在「${p.name}」提交了需求，来源：${source}`, ref_task_id: null, read_at: null, created_at: createdAt });
      }
    });

    // 项目级可见范围：参与者按角色显式授权，未参与的成员只读或不可见
    let alt = 0;
    for (const [uid, role] of ws.members) {
      if (role !== 'member') continue;
      let access;
      if (projOwners.has(uid)) access = U[uid].skill === 'qa' ? 'qa' : U[uid].skill === 'pm' ? 'pm' : 'dev';
      else access = alt++ % 2 === 0 ? 'read' : 'none';
      add('project_member', { workspace_id: W, project_id: R, user_id: uid, access, created_at: projCreated });
    }
  });

  // 管理员收到的评论通知
  const wsTasks = rows.task.filter((t) => t.workspace_id === W && (t.board_column === 'doing' || t.board_column === 'Cxmtest'));
  wsTasks.slice(0, 2).forEach((t, i) => adminRefs.push({ user_id: '@admin', workspace_id: W, type: 'task_comment', title: `${t.owner} 评论了：${t.title}`, body: pick(COMMENTS), ref_task_id: t.id, read_at: i ? `${YESTERDAY} 18:00:00` : null, created_at: `${YESTERDAY} 16:${pad(10 + i * 7)}:00` }));
}
adminRefs.forEach((n) => add('app_notification', n));
for (const u of rows.app_user) u.last_workspace_id = lastWs[u.id] || 'W' + u.id;

/* ---------------- 现有空项目补数据 ---------------- */
const FILL = [
  [1, 'story', 'P1', '需求梳理与范围确认', '与业务方确认本期范围、优先级与验收标准', 'done', 100, -40, -30, 960],
  [2, 'story', 'P1', '核心功能开发', '主流程功能实现与自测', 'done', 100, -28, -12, 2880],
  [3, 'bug', 'P1', '联调问题修复', '联调阶段发现的接口与数据问题', 'done', 100, -14, -9, 480],
  [4, 'story', 'P2', '体验优化与细节打磨', '交互细节、提示文案与加载态优化', 'doing', 50, -6, 6, 1440],
  [5, 'task', 'P2', '测试与验收', '回归测试与业务验收', 'backlog', 0, 7, 14, 960],
  [6, 'task', 'P3', '上线准备与发布', '上线检查清单、回滚预案与发布', 'backlog', 0, 15, 18, 480],
];
const fillUnion = FILL.map(([k, type, pri, title, desc, col, prog, s, d, est]) => {
  const sd = workday(addDays(TODAY, s)), dd = workday(addDays(TODAY, d));
  return `SELECT ${k} AS k, ${q(type)} AS item_type, ${q(pri)} AS priority, ${q(title)} AS title, ${q(desc)} AS descr, ${q(col)} AS col, ${prog} AS progress, ${q(sd)} AS sd, ${q(dd)} AS dd, ${est} AS est, ${col === 'done' ? q(dd) : 'NULL'} AS cd, ${q(addDays(sd, -2) + ' 10:00:00')} AS ca`;
}).join('\n    UNION ALL ');

/* ---------------- 输出 SQL ---------------- */
const COLS_ORDER = ['app_user', 'workspace', 'workspace_member', 'board_column', 'category', 'tag', 'requirement', 'project_version', 'requirement_doc', 'dev_branch', 'dev_branch_log', 'task', 'version_task', 'subtask', 'task_tag', 'task_comment', 'task_log', 'time_log', 'task_completion_record', 'task_dependency', 'task_baseline', 'demand', 'demand_log', 'demand_doc_link', 'project_member', 'work_activity', 'app_notification'];
const WS_TABLES = ['task_tag', 'subtask', 'task_comment', 'task_log', 'time_log', 'task_completion_record', 'task_dependency', 'task_baseline', 'version_task', 'attachment', 'demand_doc_link', 'demand_log', 'demand', 'dev_branch_log', 'dev_branch', 'requirement_doc', 'project_version', 'project_member', 'work_activity', 'app_notification', 'saved_view', 'user_list_preference', 'gantt_share', 'invite', 'task', 'requirement', 'tag', 'category', 'board_column', 'workspace_member'];

const out = [];
out.push(`-- ============================================================================
-- sql/seeds/seed_mock.sql · 多空间模拟数据（由 tools/preview/gen-mock-seed.mjs 生成，勿手改）
--
-- 内容：4 个共享空间 × ${rows.requirement.length} 个项目，${rows.app_user.length} 名成员；覆盖任务看板、版本、史诗/里程碑、甘特依赖与基线、
--       需求池与评审流转、需求文档树、分支、工时、完成快照、评论、子任务、标签、通知、项目权限。
--       另外为库里「没有任何任务」的现有项目各补 6 条基础任务。
-- 幂等：先删除全部 Xm 前缀的模拟数据再重灌，不触碰真实数据。
-- 前置：01-29 号升级脚本已执行；库里存在 role=admin 的账号（模拟成员沿用其密码）。
-- 执行：mysql -u <用户> -p --default-character-set=utf8mb4 hourglass < sql/seeds/seed_mock.sql
-- 登录：管理员为 4 个空间的空间主；成员账号见 app_user（zhangwei、liting 等），密码同管理员。
-- ============================================================================

USE hourglass;
SET NAMES utf8mb4;

SET @admin := (SELECT id FROM app_user WHERE role = 'admin' ORDER BY created_at, id LIMIT 1);
SET @admin_name := (SELECT display_name FROM app_user WHERE id = @admin);
SET @pw := (SELECT password_hash FROM app_user WHERE id = @admin);

START TRANSACTION;

-- ---------------------------------------------------------------------------
-- 清理旧模拟数据
-- ---------------------------------------------------------------------------`);
const MOCK_WS = "(workspace_id LIKE 'SXm%' OR workspace_id LIKE 'WXmu%')";
for (const t of WS_TABLES) out.push(`DELETE FROM ${t} WHERE ${MOCK_WS};`);
out.push(`DELETE FROM task_tag WHERE task_id LIKE 'Xmf%';
DELETE FROM task_log WHERE task_id LIKE 'Xmf%';
DELETE FROM time_log WHERE task_id LIKE 'Xmf%';
DELETE FROM task_completion_record WHERE task_id LIKE 'Xmf%';
DELETE FROM task WHERE id LIKE 'Xmf%';
DELETE FROM app_notification WHERE user_id LIKE 'Xmu%';
DELETE FROM workspace_member WHERE user_id LIKE 'Xmu%';
DELETE FROM workspace WHERE id LIKE 'SXm%' OR id LIKE 'WXmu%';
DELETE FROM user_notification_preference WHERE user_id LIKE 'Xmu%';
DELETE FROM app_user WHERE id LIKE 'Xmu%';`);

for (const table of COLS_ORDER) {
  const list = rows[table];
  if (!list?.length) continue;
  const cols = [...new Set(list.flatMap(Object.keys))];
  out.push(`\n-- ${table}（${list.length} 行）`);
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200);
    out.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES\n` + chunk.map((r) => '  (' + cols.map((c) => q(r[c])).join(', ') + ')').join(',\n') + ';');
  }
}

out.push(`
-- ---------------------------------------------------------------------------
-- 现有项目补数据：只处理当前没有任何未删除任务的项目，负责人取空间主
-- ---------------------------------------------------------------------------
INSERT INTO task (id, workspace_id, title, description, item_type, priority, owner, owner_user_id, category,
                  board_column, start_date, due_date, req_id, progress, estimate_minutes, completed_at,
                  sort_order, created_at, updated_at)
SELECT CONCAT('Xmf', LEFT(MD5(CONCAT(r.id, '#', t.k)), 24)), r.workspace_id, t.title, t.descr, t.item_type, t.priority,
       u.display_name, u.id,
       COALESCE((SELECT c.name FROM category c WHERE c.workspace_id = r.workspace_id ORDER BY c.sort_order, c.id LIMIT 1), ''),
       t.col, t.sd, t.dd, r.id, t.progress, t.est, t.cd, t.k, t.ca, COALESCE(CONCAT(t.cd, ' 18:00:00'), t.ca)
FROM requirement r
JOIN workspace w ON w.id = r.workspace_id
JOIN app_user u ON u.id = w.owner_id
JOIN (
    ${fillUnion}
) t
WHERE r.workspace_id NOT LIKE 'SXm%'
  AND NOT EXISTS (SELECT 1 FROM task x WHERE x.req_id = r.id AND x.deleted_at IS NULL);

INSERT INTO task_log (task_id, workspace_id, actor_id, action, detail, created_at)
SELECT id, workspace_id, owner_user_id, 'create', CONCAT('创建任务「', title, '」'), created_at
FROM task WHERE id LIKE 'Xmf%';

INSERT INTO time_log (task_id, workspace_id, user_id, started_at, ended_at, minutes)
SELECT id, workspace_id, owner_user_id, CONCAT(start_date, ' 09:30:00'),
       DATE_ADD(CONCAT(start_date, ' 09:30:00'), INTERVAL LEAST(estimate_minutes * progress DIV 100, 450) MINUTE),
       LEAST(estimate_minutes * progress DIV 100, 450)
FROM task WHERE id LIKE 'Xmf%' AND board_column <> 'backlog';

INSERT INTO task_completion_record (workspace_id, task_id, title, description, req_id, req_name, owner, owner_user_id,
                                    category, priority, start_date, completed_at, first_started_at, last_ended_at, total_minutes)
SELECT t.workspace_id, t.id, t.title, t.description, t.req_id, r.name, t.owner, t.owner_user_id,
       t.category, t.priority, t.start_date, t.completed_at, CONCAT(t.start_date, ' 09:30:00'),
       DATE_ADD(CONCAT(t.start_date, ' 09:30:00'), INTERVAL LEAST(t.estimate_minutes, 450) MINUTE), LEAST(t.estimate_minutes, 450)
FROM task t JOIN requirement r ON r.id = t.req_id
WHERE t.id LIKE 'Xmf%' AND t.board_column = 'done';

COMMIT;

-- ---------------------------------------------------------------------------
-- 自检
-- ---------------------------------------------------------------------------
SELECT w.name AS 空间, COUNT(DISTINCT r.id) AS 项目, COUNT(DISTINCT t.id) AS 任务,
       COUNT(DISTINCT m.user_id) AS 成员
FROM workspace w
LEFT JOIN requirement r ON r.workspace_id = w.id
LEFT JOIN task t ON t.workspace_id = w.id
LEFT JOIN workspace_member m ON m.workspace_id = w.id
WHERE w.id LIKE 'SXm%'
GROUP BY w.id, w.name ORDER BY w.id;

SELECT COUNT(DISTINCT req_id) AS 补数据的现有项目, COUNT(*) AS 补充任务 FROM task WHERE id LIKE 'Xmf%';
`);

writeFileSync(OUT, out.join('\n'), 'utf8');
const total = Object.values(rows).reduce((s, l) => s + l.length, 0);
console.log(`已生成 ${OUT}`);
console.log(Object.entries(rows).map(([t, l]) => `${t}=${l.length}`).join(' '), `合计 ${total} 行`);

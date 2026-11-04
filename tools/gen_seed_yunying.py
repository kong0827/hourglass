# -*- coding: utf-8 -*-
"""根据《运营研发项目看板.xlsx》生成 沙漏 Hourglass 初始化种子 SQL（sql/seeds/seed_yunying.sql，勿手改产物）。

映射口径（2026-11-04 与用户确认）：
- 项目管理 9 行    → 共享空间「运营研发部」+ 项目 requirement（进行中→active、已完成→done、未启动→active）
- 项目模块 11 行   → 空间级分类 category；模块→项目对照用于无项目关联数据兜底
- 需求管理 174 行  → 需求池 demand（负责人列不导入；状态：待评估→review、待排期→pass、
                     开发中/已提测/开发完成/待发版/已发版→plan、暂不考虑→rej）
- 子任务 288 行    → 工作项 task（类型空默认 task；状态→看板列；demand_id 按需求↔子任务名称精确匹配）
- 缺陷管理 36 行   → 工作项 task（item_type=bug；描述合并复现环境/操作步骤/预期/实际）
- 发版记录        → 版本 project_version（挂「流程引擎」项目；无版本号的行按发版日期命名）；
                     已完成任务按完成日期归入发版日期不早于它的最近一个版本（version_task）
- 部门日报         → 不导入（系统无日报概念）
- 账号             → 仅执行角色（开发负责人/处理人/创建人/测试负责人）；提出人仅存 demand.source

与代码不变量的对齐（2026-11-04）：
- done 是后端自动追加的虚拟看板列，不写入 board_column；
- plan 状态的需求必须挂同项目版本：优先取需求下已完成任务的实际归属版本；原表“已发版”的
  落到提出后首个发布版本；其余取项目计划版本，再退到最近一次已发布版本；项目没有任何版本时降级为 pass（待排期）；
- requirement.first_released_at 取该项目最早一个已发布版本的日期，没有发版记录的保持 NULL；
- completed_at 只在看板列为 done 的任务上写，其余任务即使原表有“实际完成时间”也留空；
- 工作项均补齐起止日期；保留合理的原表日期，未完成且已逾期的按 2026-11-04 基准日重排到当前或未来。

用法：python tools/gen_seed_yunying.py [Excel路径] [输出SQL路径]
"""

import sys
import re
from datetime import datetime, date, timedelta

import pandas as pd

EXCEL = sys.argv[1] if len(sys.argv) > 1 else 'C:/Users/F2041/Downloads/运营研发项目看板.xlsx'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'sql/seeds/seed_yunying.sql'

WS = 'SYy01'          # 共享空间
WS_NAME = '运营研发部'
USER_PREFIX = 'Yyu'   # 账号 / 个人空间为 W + 账号ID
P_CREATED = '2026-06-01 09:00:00'   # 无日期数据时统一使用的创建时间
SEED_TODAY = date(2026, 11, 4)      # 未完成任务排期的演示基准日
DEFAULT_COMPLETED_DATE = date(2026, 8, 19)

PRJ_STATUS = {'进行中': 'active', '已完成': 'done', '未启动': 'active'}
PRIORITY = {'最高': 'P0', '高': 'P1', '中': 'P2', '低': 'P3', '最低': 'P3'}
DEMAND_STATUS = {'待评估': 'review', '待排期': 'pass', '开发中': 'plan', '已提测': 'plan',
                 '开发完成': 'plan', '待发版': 'plan', '已发版': 'plan', '暂不考虑': 'rej'}
# 看板列：id → (名称, 颜色, 排序, 进度)
COLUMNS = [
    ('backlog', '待启动', '#c08a3e', 0, 0),
    ('doing', '进行中', '#5b83ad', 1, 40),
    ('devdone', '开发完成', '#6b8f71', 2, 80),
    ('testing', '已提测', '#7b6fa0', 3, 90),
    ('release', '待发版', '#b0783c', 4, 95),
    ('done', '已完成', '#4f7c59', 5, 100),
]
TASK_STATUS = {'未启动': 'backlog', '进行中': 'doing', '开发完成': 'devdone', '已提测': 'testing',
               '待发版': 'release', '已发布': 'done', '关闭': 'done'}
BUG_STATUS = {'关闭': 'done', '新建': 'backlog', '拒绝': 'backlog'}
# 项目模块表中未标明所属项目的模块，按语义归入
MODULE_FALLBACK_PROJECT = {'合规管理': '风控与合规', '外接模块': '流程引擎'}
PINYIN = {'孔祥劲': 'kongxiangjin', '施亚彬': 'shiyabin', '张亮': 'zhangliang', '程洪昌': 'chenghongchang',
          '马远': 'mayuan', '肖威': 'xiaowei', '周劲松': 'zhoujinsong', '张会朋': 'zhanghuipeng',
          '尼克狐': 'nikehu', '林潇': 'linxiao', '李楠': 'linan', '缪佳豪': 'miaojiahao'}
CATEGORY_COLORS = ['#5b83ad', '#6b8f71', '#b0783c', '#7b6fa0', '#4f7c59', '#a05b83',
                   '#8a6d3b', '#4a7a8a', '#946b4a', '#5a7d5a', '#7a5b8a']


def esc(v):
    if v is None:
        return 'NULL'
    s = str(v).replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n').replace('\r', '')
    return "'%s'" % s


def txt(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ''
    return str(v).strip()


def trunc(s, n):
    return s[:n] if s else s


def parse_date(v):
    """支持 Timestamp/datetime/Excel 序列数/'2026年6月9日'/'2026/10/30' 等格式。"""
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    if isinstance(v, (pd.Timestamp, datetime)):
        return v.date()
    if isinstance(v, date):
        return v
    s = str(v).strip()
    m = re.match(r'(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})日?', s)
    if m:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    try:
        f = float(s)
        return date(1899, 12, 30) + pd.to_timedelta(f, unit='D').normalize().to_pytimedelta()
    except ValueError:
        return None


def person(v):
    """'施亚彬@福建新意科技有限公司' → '施亚彬'；多责任人取第一个。"""
    s = txt(v).split('@')[0].split(',')[0].split('，')[0].strip()
    return s


def d2dt(d, hhmm='09:00:00'):
    return '%s %s' % (d.isoformat(), hhmm) if d else None


def normalize_task_dates(start, due, done, column, seq):
    duration = 5 + (seq % 4) * 2
    if start and due and start <= due and 1 <= (due - start).days <= 30:
        duration = (due - start).days

    if column == 'done':
        done = done or due or DEFAULT_COMPLETED_DATE
        start = start or done - timedelta(days=duration)
        if start > done:
            start = done - timedelta(days=duration)
        due = due or done
        if due < start:
            due = start
        return start, due, done

    if due and due >= SEED_TODAY:
        if not start or start > due:
            start = due - timedelta(days=duration)
        if column == 'backlog' and start < SEED_TODAY:
            start = SEED_TODAY + timedelta(days=2 + seq % 10)
            due = max(due, start + timedelta(days=duration))
        return start, due, done

    if start and not due and start + timedelta(days=duration) >= SEED_TODAY:
        return start, start + timedelta(days=duration), done

    if column == 'backlog':
        start = SEED_TODAY + timedelta(days=2 + seq % 10)
        due = start + timedelta(days=duration)
    else:
        start = SEED_TODAY - timedelta(days=3 + seq % 12)
        due = max(start + timedelta(days=duration),
                  SEED_TODAY + timedelta(days=2 + seq % 10))
    return start, due, done


def sq(v):
    return esc(v if v else None)


def main():
    xl = pd.ExcelFile(EXCEL)
    prj_sheet = pd.read_excel(xl, '项目管理', header=0)
    mod_sheet = pd.read_excel(xl, '项目模块', header=0)
    req_sheet = pd.read_excel(xl, '需求管理', header=0)
    sub_sheet = pd.read_excel(xl, '项目子任务管理', header=1)
    bug_sheet = pd.read_excel(xl, '缺陷管理', header=0)
    rel_sheet = pd.read_excel(xl, '发版记录', header=0)

    # ---- 项目 ----
    projects = []
    goal_key = {}
    for _, r in prj_sheet.iterrows():
        name = txt(r.get('项目名称'))
        if not name:
            continue
        pid = 'YyR%02d' % (len(projects) + 1)
        goal = txt(r.get('目标'))
        projects.append({'id': pid, 'name': name, 'goal': goal,
                         'status': PRJ_STATUS.get(txt(r.get('项目状态')), 'active')})
        if goal:
            goal_key[goal[:20]] = pid
    proj_by_name = {p['name']: p for p in projects}
    proj_by_id = {p['id']: p for p in projects}

    def goal_to_project(goal):
        g = txt(goal)
        return goal_key.get(g[:20]) if g else None

    # ---- 模块 → 分类 + 模块→项目 ----
    modules = []
    mod_project = {}
    for _, r in mod_sheet.iterrows():
        name = txt(r.get('模块'))
        if not name or name in [m['name'] for m in modules]:
            continue
        pid = goal_to_project(r.get('项目'))
        if not pid and name in MODULE_FALLBACK_PROJECT:
            pid = proj_by_name[MODULE_FALLBACK_PROJECT[name]]['id']
        modules.append({'id': 'YyC%02d' % (len(modules) + 1), 'name': name, 'req_id': pid})
        mod_project[name] = pid
    cat_names = [m['name'] for m in modules]

    def mod_first(v):
        for part in re.split('[,，]', txt(v)):
            p = part.strip()
            if p in cat_names:
                return p
        return ''

    def mod_project_of(v):
        p = mod_first(v)
        return mod_project.get(p) if p else None

    # ---- 账号（仅执行角色）----
    names = []
    for col in ['开发负责人', '测试负责人']:
        for v in sub_sheet[col].dropna():
            n = person(v)
            if n and n not in names:
                names.append(n)
    for col in ['处理人', '创建人']:
        for v in bug_sheet[col].dropna():
            n = person(v)
            if n and n not in names:
                names.append(n)
    users = []
    for i, n in enumerate(names, 1):
        uid = 'Yyu%02d' % i
        users.append({'id': uid, 'pw': 'W' + uid, 'name': n,
                     'username': PINYIN.get(n, n)})
    user_by_name = {u['name']: u for u in users}

    # ---- 需求池 demand ----
    flow_pid = proj_by_name['流程引擎']['id']
    demands = []
    for _, r in req_sheet.iterrows():
        title = txt(r.get('功能名称'))
        if not title:
            continue
        status = txt(r.get('需求状态'))
        desc = txt(r.get('需求描述'))
        kind = ('缺陷' if re.search('修复|缺陷', title + desc)
                else '体验优化' if re.search('优化|调整|完善', title + desc)
                else '新功能')
        pid = goal_to_project(r.get('关联项目')) or mod_project_of(r.get('模块'))
        if not pid:
            # demand.req_id 非空：无项目信号的少数需求按标题关键词兜底，其余默认核心产品
            if '托管' in title:
                pid = mod_project['主机托管']
            elif '外接' in title:
                pid = mod_project['外接模块']
            else:
                pid = flow_pid
        proposer = txt(r.get('提出人')).split('@')[0].strip()
        created = parse_date(r.get('提出日期'))
        demands.append({
            'id': 'YyQ%03d' % (len(demands) + 1), 'title': title, 'desc': desc,
            'kind': kind, 'priority': PRIORITY.get(txt(r.get('优先级')), 'P2'),
            'status': DEMAND_STATUS.get(status, 'review'), 'req_id': pid,
            'module': mod_first(r.get('模块')), 'source': proposer,
            'created_by': user_by_name.get(proposer, {}).get('id'),
            'review_note': '暂不考虑' if status == '暂不考虑' else '',
            'created': d2dt(created) or P_CREATED,
            'src_status': status,
            'sub_refs': txt(r.get('关联子任务')),
        })
    demand_by_title = {}
    for d in demands:
        demand_by_title.setdefault(d['title'], d['id'])

    # ---- 工作项 task（子任务表 + 缺陷表）----
    tasks = []
    col_counter = {}

    def split_names(v):
        return [p.strip() for p in re.split('[,，]', txt(v)) if p.strip()]

    # 子任务 → 需求：双向名称精确匹配，子任务自身声明优先
    sub_demand = {}
    for _, r in sub_sheet.iterrows():
        title = txt(r.get('任务名称'))
        for ref in split_names(r.get('关联需求')):
            if ref in demand_by_title:
                sub_demand[title] = demand_by_title[ref]
    for d in demands:
        for ref in split_names(d['sub_refs']):
            if ref not in sub_demand:
                sub_demand[ref] = d['id']

    for _, r in sub_sheet.iterrows():
        title = txt(r.get('任务名称'))
        if not title:
            continue
        status = txt(r.get('任务状态'))
        column = TASK_STATUS.get(status, 'backlog')
        owner = person(r.get('开发负责人'))
        start, due, done = (parse_date(r.get(c)) for c in
                            ('启动时间', '截止时间', '实际完成时间'))
        created = d2dt(start) or d2dt(due) or P_CREATED
        start, due, done = normalize_task_dates(start, due, done, column, len(tasks))
        # completed_at 只在 done 列上有值，避免未完成任务被完成趋势统计计入
        completed = done if column == 'done' else None
        demand_id = sub_demand.get(title)
        demand = next((d for d in demands if d['id'] == demand_id), None)
        req_id = (goal_to_project(r.get('关联的项目信息'))
                  or (demand['req_id'] if demand else None)
                  or mod_project_of(r.get('关联模块')))
        item_type = {'任务': 'task', '缺陷': 'bug'}.get(txt(r.get('类型')), 'task')
        prog = dict((c[0], c[4]) for c in COLUMNS)[column]
        col_counter[column] = col_counter.get(column, 0) + 1
        tasks.append({
            'id': 'YyK%03d' % (len(tasks) + 1), 'item_type': item_type,
            'title': trunc(title, 60), 'desc': trunc(txt(r.get('任务描述')), 200),
            'priority': PRIORITY.get(txt(r.get('优先级')), 'P2'),
            'owner': owner, 'owner_uid': user_by_name.get(owner, {}).get('id'),
            'category': mod_first(r.get('关联模块')), 'column': column, 'progress': prog,
            'start': start, 'due': due, 'done': done, 'completed': completed,
            'req_id': req_id,
            'demand_id': demand_id, 'note': '', 'sort': col_counter[column] - 1,
            'created': created,
        })

    for _, r in bug_sheet.iterrows():
        title = txt(r.get('缺陷描述'))
        if not title:
            continue
        status = txt(r.get('缺陷状态'))
        column = BUG_STATUS.get(status, 'backlog')
        owner = person(r.get('处理人'))
        created = parse_date(r.get('创建时间'))
        done = parse_date(r.get('结束时间')) or parse_date(r.get('修复时间'))
        start, due, done = normalize_task_dates(created, None, done, column, len(tasks))
        desc = ' '.join(filter(None, [
            '复现环境：' + txt(r.get('复现环境')),
            '操作步骤：' + txt(r.get('操作步骤')),
            '预期结果：' + txt(r.get('预期结果')),
            '实际结果：' + txt(r.get('实际结果'))]))
        prog = dict((c[0], c[4]) for c in COLUMNS)[column]
        col_counter[column] = col_counter.get(column, 0) + 1
        tasks.append({
            'id': 'YyK%03d' % (len(tasks) + 1), 'item_type': 'bug',
            'title': trunc(title, 60), 'desc': trunc(desc, 200),
            'priority': PRIORITY.get(txt(r.get('优先级')), 'P2'),
            'owner': owner, 'owner_uid': user_by_name.get(owner, {}).get('id'),
            'category': mod_first(r.get('关联模块')), 'column': column, 'progress': prog,
            'start': start, 'due': due, 'done': done if column == 'done' else None,
            'completed': done if column == 'done' else None,
            'req_id': mod_project_of(r.get('关联模块')), 'demand_id': None,
            'note': '已拒绝' if status == '拒绝' else '',
            'sort': col_counter[column] - 1,
            'created': d2dt(created) or P_CREATED,
        })

    # ---- 版本（发版记录 → 流程引擎项目）----
    versions = []
    for _, r in rel_sheet.iterrows():
        rel_date = parse_date(r.get('发版时间'))
        ver = txt(r.get('版本号')) or txt(r.get('版本'))
        content = txt(r.get('发版内容'))
        if not rel_date and not ver:
            continue
        versions.append({
            'id': 'YyV%02d' % (len(versions) + 1),
            'name': ver if ver else '发版-' + rel_date.strftime('%Y%m%d'),
            'desc': trunc(content, 500), 'req_id': flow_pid,
            'status': 'released' if rel_date else 'planned',
            'released': d2dt(rel_date, '10:00:00') if rel_date else None,
            'target': rel_date.isoformat() if rel_date else None,
            'created': d2dt(rel_date, '10:00:00') or P_CREATED,
        })

    # 已完成任务归入发版日期不早于完成日的最近版本
    version_task = []
    released = [v for v in versions if v['released']]
    for t in tasks:
        if t['column'] != 'done' or not t['done'] or t['req_id'] != flow_pid:
            continue
        fit = [v for v in released if v['released'][:10] >= t['done'].isoformat()]
        if fit:
            version_task.append((t['id'], sorted(fit, key=lambda v: v['released'])[0]['id']))

    # ---- 需求挂版本：plan 必须落在同项目版本上（DemandService.plan 的硬约束）----
    ver_by_id = {v['id']: v for v in versions}
    task_by_id = {t['id']: t for t in tasks}
    demand_versions = {}
    for tid, vid in version_task:
        did = task_by_id[tid]['demand_id']
        if did:
            demand_versions.setdefault(did, []).append(vid)

    def pick_version(d):
        """优先任务实际归属版本；否则原表“已发版”落到提出后首个发布版本，其余落到计划版本。"""
        vids = [vid for vid in demand_versions.get(d['id'], [])
                if ver_by_id[vid]['req_id'] == d['req_id']]
        if vids:
            return min(vids, key=lambda vid: ver_by_id[vid]['released'] or '9999')
        same_project = [v for v in versions if v['req_id'] == d['req_id']]
        shipped = sorted([v for v in same_project if v['released']], key=lambda v: v['released'])
        if d['src_status'] == '已发版':
            # 已发版但任务未进版本归属时，按提出日期落到其后首个发布版本
            after = [v for v in shipped if v['released'][:10] >= d['created'][:10]]
            if after:
                return after[0]['id']
        planned_versions = sorted([v for v in same_project if not v['released']],
                                  key=lambda v: v['target'] or '9999-12-31')
        if planned_versions:
            return planned_versions[0]['id']
        if shipped:
            return shipped[-1]['id']
        return None

    downgraded = 0
    for d in demands:
        if d['status'] != 'plan':
            d['version_id'] = None
            continue
        d['version_id'] = pick_version(d)
        if not d['version_id']:
            # 项目没有任何版本可挂，回退为待排期，避免“已排期但没有目标版本”的脏状态
            d['status'] = 'pass'
            downgraded += 1

    # ---- 项目首版上线日：取最早一个已发布版本的日期 ----
    first_release = {}
    for v in versions:
        if not v['released']:
            continue
        day = v['released'][:10]
        if v['req_id'] not in first_release or day < first_release[v['req_id']]:
            first_release[v['req_id']] = day

    # ==================== 输出 SQL ====================
    out = []
    w = out.append
    w('-- ============================================================================')
    w('-- sql/seeds/seed_yunying.sql · 运营研发部初始化种子数据（由 tools/gen_seed_yunying.py 生成，勿手改）')
    w('--')
    w('-- 来源：《运营研发项目看板.xlsx》；映射口径见生成脚本头部注释。')
    w('-- 幂等：先删除全部 Yy/SYy 前缀的种子数据再重灌，不触碰真实数据。')
    w('-- 前置：01-31 号升级脚本已执行。')
    w('--       库中已有管理员时沿用其密码；没有管理员时用预设账号自动创建，无需先启动应用。')
    w('--       初始账号 admin / Hourglass@2026（登录后请立即在「用户」管理中修改密码）。')
    w('-- 执行：mysql -u <用户> -p --default-character-set=utf8mb4 hourglass < sql/seeds/seed_yunying.sql')
    w('-- 口径：工作项均补齐起止日期；未完成且已逾期的按 2026-11-04 重排到当前或未来；')
    w('--       无完成日期的已发布任务统一记为末次发版日 2026-08-19；部门日报不导入；')
    w('--       需求表“负责人”列不导入（demand 无负责人字段，执行负责人见工作项）；')
    w('--       无项目信号的需求按标题关键词兜底（托管→主机托管、外接→外接模块、其余→流程引擎）。')
    w('-- ============================================================================')
    w('')
    w('USE hourglass;')
    w('-- 连接排序规则与库表保持一致（MySQL 8 默认 utf8mb4_0900_ai_ci 与用户变量比较时会报 collation 冲突）')
    w('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;')
    w('')
    w('-- 管理员账号：优先沿用已有管理员；库中没有管理员时用下面的预设账号自动创建。')
    w('-- 预设密码 Hourglass@2026 的 bcrypt 哈希（与应用同款 BCryptPasswordEncoder，strength 10）')
    w("SET @seed_admin_user := 'admin';")
    w("SET @seed_admin_pw_hash := '$2a$10$kV6ADVfSbVxSALkq.wbhK.gpD4zzeKRJOEHEzDynLkqlX5brVWslG';")
    w('')
    w("SET @admin := (SELECT id FROM app_user WHERE role = 'admin' ORDER BY created_at, id LIMIT 1);")
    w('')
    w('-- 没有任何管理员：同名账号不存在则新建（id 为 32 位无横线 UUID，与应用生成规则一致）')
    w('INSERT INTO app_user (id, username, password_hash, display_name, role, created_at)')
    w("SELECT REPLACE(UUID(), '-', ''), @seed_admin_user, @seed_admin_pw_hash, @seed_admin_user, 'admin', NOW()")
    w('  FROM DUAL')
    w(' WHERE @admin IS NULL')
    w('   AND NOT EXISTS (SELECT 1 FROM app_user WHERE username = @seed_admin_user);')
    w('SET @admin_created := ROW_COUNT();')
    w('')
    w('-- 同名账号已存在但不是管理员：提升为管理员；密码为空时补预设密码')
    w('UPDATE app_user')
    w("   SET role = 'admin',")
    w("       password_hash = IF(password_hash IS NULL OR password_hash = '', @seed_admin_pw_hash, password_hash)")
    w(' WHERE username = @seed_admin_user')
    w('   AND @admin IS NULL;')
    w('')
    w("SET @admin := (SELECT id FROM app_user WHERE role = 'admin' ORDER BY created_at, id LIMIT 1);")
    w('-- 已有管理员但密码哈希为空：补预设密码，避免成员沿用 NULL')
    w('UPDATE app_user')
    w('   SET password_hash = @seed_admin_pw_hash')
    w(' WHERE id = @admin')
    w("   AND (password_hash IS NULL OR password_hash = '');")
    w('')
    w("SET @admin_name := (SELECT display_name FROM app_user WHERE id = @admin);")
    w("SET @pw := (SELECT password_hash FROM app_user WHERE id = @admin);")
    w('')
    w('-- 兜底校验：管理员或密码哈希仍缺失时直接报错，不把 NULL 写进成员账号')
    w('DROP PROCEDURE IF EXISTS _seed_require_admin;')
    w('DELIMITER $$')
    w('CREATE PROCEDURE _seed_require_admin(IN v_admin VARCHAR(32), IN v_pw VARCHAR(255))')
    w('BEGIN')
    w('  IF v_admin IS NULL THEN')
    w("    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '无法创建管理员账号：请检查 app_user 表写入权限或同名账号冲突';")
    w('  ELSEIF v_pw IS NULL OR v_pw = \'\' THEN')
    w("    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '管理员账号缺少密码哈希，请检查 app_user.password_hash';")
    w('  END IF;')
    w('END$$')
    w('DELIMITER ;')
    w('CALL _seed_require_admin(@admin, @pw);')
    w('DROP PROCEDURE _seed_require_admin;')
    w('')
    w('START TRANSACTION;')
    w('')
    w('-- ---------------------------------------------------------------------------')
    w('-- 清理旧种子数据')
    w('-- ---------------------------------------------------------------------------')
    for tbl in ['task_tag', 'subtask', 'task_comment', 'task_log', 'time_log',
                'task_completion_record', 'task_dependency', 'task_baseline',
                'version_task', 'attachment', 'demand_doc_link', 'demand_log',
                'demand', 'dev_branch_log', 'dev_branch', 'requirement_doc',
                'project_version', 'project_member', 'work_activity',
                'app_notification', 'saved_view', 'user_list_preference',
                'gantt_share', 'invite', 'task', 'requirement', 'tag',
                'category', 'board_column', 'workspace_member']:
        w("DELETE FROM %s WHERE (workspace_id LIKE 'SYy%%' OR workspace_id LIKE 'WYyu%%');" % tbl)
    for tbl in ['app_notification', 'workspace_member', 'user_notification_preference']:
        w("DELETE FROM %s WHERE user_id LIKE 'Yyu%%';" % tbl)
    w("DELETE FROM workspace WHERE id LIKE 'SYy%' OR id LIKE 'WYyu%';")
    w("DELETE FROM app_user WHERE id LIKE 'Yyu%';")
    w('')

    w('-- 账号（%d 行，仅执行角色；密码同管理员，仅本机验证用）' % len(users))
    w('INSERT INTO app_user (id, username, password_hash, display_name, email, role, last_workspace_id, created_at) VALUES')
    rows = []
    for u in users:
        rows.append("  ('%s', '%s', @pw, %s, '%s@example.com', 'user', '%s', '%s')" % (
            u['id'], u['username'], esc(u['name']), u['username'], WS, P_CREATED))
    w(',\n'.join(rows) + ';')
    w('')

    w('-- 空间（共享空间 + 成员个人空间）')
    w('INSERT INTO workspace (id, name, type, owner_id, created_at) VALUES')
    rows = ["  ('%s', '%s', 'personal', '%s', '%s')" % (u['pw'], u['name'], u['id'], P_CREATED) for u in users]
    rows.append("  ('%s', '%s', 'shared', @admin, '%s')" % (WS, WS_NAME, P_CREATED))
    w(',\n'.join(rows) + ';')
    w('')

    w('-- 空间成员')
    w('INSERT INTO workspace_member (workspace_id, user_id, role, created_at) VALUES')
    rows = ["  ('%s', '%s', 'owner', '%s')" % (u['pw'], u['id'], P_CREATED) for u in users]
    rows.append("  ('%s', @admin, 'owner', '%s')" % (WS, P_CREATED))
    rows += ["  ('%s', '%s', 'member', '%s')" % (WS, u['id'], P_CREATED) for u in users]
    w(',\n'.join(rows) + ';')
    w('')

    # done 由后端在返回看板时自动追加（ColumnController / TaskQueryService），落库会渲染出两个“已完成”
    w('-- 看板列（共享空间 5 列 + 个人空间基础列；done 为虚拟列，不落库）')
    w('INSERT INTO board_column (id, workspace_id, name, color, sort_order) VALUES')
    rows = ["  ('%s', '%s', '%s', '%s', %d)" % (c[0], WS, c[1], c[2], c[3])
            for c in COLUMNS if c[0] != 'done']
    for u in users:
        rows.append("  ('backlog', '%s', '待处理', '#c08a3e', 0)" % u['pw'])
        rows.append("  ('doing', '%s', '进行中', '#5b83ad', 1)" % u['pw'])
    w(',\n'.join(rows) + ';')
    w('')

    w('-- 分类（%d 个模块）' % len(modules))
    w('INSERT INTO category (id, workspace_id, name, color, sort_order, created_at) VALUES')
    rows = ["  ('%s', '%s', %s, '%s', %d, '%s')" % (
        m['id'], WS, esc(m['name']), CATEGORY_COLORS[i % len(CATEGORY_COLORS)], i, P_CREATED)
        for i, m in enumerate(modules)]
    w(',\n'.join(rows) + ';')
    w('')

    w('-- 项目（%d 个；first_released_at 取最早已发布版本日期）' % len(projects))
    w('INSERT INTO requirement (id, workspace_id, name, description, status, first_released_at, created_at, updated_at) VALUES')
    rows = ["  ('%s', '%s', %s, %s, '%s', %s, '%s', '%s')" % (
        p['id'], WS, esc(p['name']), esc(trunc(p['goal'], 160)), p['status'],
        sq(first_release.get(p['id'])), P_CREATED, P_CREATED)
        for p in projects]
    w(',\n'.join(rows) + ';')
    w('')

    w('-- 版本（发版记录 → 流程引擎项目，%d 个）' % len(versions))
    w('INSERT INTO project_version (id, workspace_id, req_id, name, description, status, target_date, released_at, created_at) VALUES')
    rows = ["  ('%s', '%s', '%s', %s, %s, '%s', %s, %s, '%s')" % (
        v['id'], WS, v['req_id'], esc(v['name']), sq(v['desc']), v['status'],
        sq(v['target']), sq(v['released']), v['created']) for v in versions]
    w(',\n'.join(rows) + ';')
    w('')

    w('-- 需求池（%d 行；plan 行均带同项目 version_id，%d 行因项目无版本回退为 pass）' % (len(demands), downgraded))
    w('INSERT INTO demand (id, workspace_id, req_id, version_id, title, description, source, item_kind, priority, status, review_note, created_by, created_at, updated_at) VALUES')
    rows = ["  ('%s', '%s', %s, %s, %s, %s, %s, '%s', '%s', '%s', %s, %s, '%s', '%s')" % (
        d['id'], WS, sq(d['req_id']), sq(d['version_id']), esc(d['title']), sq(trunc(d['desc'], 2000)),
        sq(d['source']), d['kind'], d['priority'], d['status'], sq(d['review_note']),
        sq(d['created_by']), d['created'], d['created']) for d in demands]
    w(',\n'.join(rows) + ';')
    w('')

    w('-- 工作项（子任务 %d + 缺陷 %d）' % (
        sum(1 for t in tasks if t['item_type'] != 'bug' or t['note'] != '已拒绝'),
        sum(1 for t in tasks if t['item_type'] == 'bug')))
    w('INSERT INTO task (id, workspace_id, title, description, item_type, demand_id, priority, owner, owner_user_id, category, board_column, start_date, due_date, req_id, progress, note, completed_at, sort_order, created_at, updated_at) VALUES')
    rows = []
    for t in tasks:
        updated = d2dt(t['done'], '18:00:00') if t['done'] else t['created']
        rows.append("  ('%s', '%s', %s, %s, '%s', %s, '%s', %s, %s, %s, '%s', %s, %s, %s, %d, %s, %s, %d, '%s', '%s')" % (
            t['id'], WS, esc(t['title']), sq(t['desc']), t['item_type'], sq(t['demand_id']),
            t['priority'], sq(t['owner'] or '未指派'), sq(t['owner_uid']), esc(t['category'] or ''),
            t['column'], sq(t['start'].isoformat() if t['start'] else None),
            sq(t['due'].isoformat() if t['due'] else None), sq(t['req_id']), t['progress'],
            sq(t['note']), sq(t['completed'].isoformat() if t['completed'] else None),
            t['sort'], t['created'], updated))
    w(',\n'.join(rows) + ';')
    w('')

    if version_task:
        w('-- 版本-工作项归属（已完成任务按完成日期归入其后首个发版，%d 行）' % len(version_task))
        w('INSERT INTO version_task (task_id, workspace_id, version_id, created_at) VALUES')
        w(',\n'.join("  ('%s', '%s', '%s', '%s')" % (tid, WS, vid, P_CREATED)
                     for tid, vid in version_task) + ';')
        w('')

    done_tasks = [t for t in tasks if t['column'] == 'done' and t['done']]
    w('-- 完成快照（%d 行）' % len(done_tasks))
    w('INSERT INTO task_completion_record (workspace_id, task_id, title, description, req_id, req_name, owner, owner_user_id, category, priority, start_date, completed_at, total_minutes, created_at) VALUES')
    rows = []
    for t in done_tasks:
        pname = proj_by_id[t['req_id']]['name'] if t['req_id'] in proj_by_id else None
        rows.append("  ('%s', '%s', %s, %s, %s, %s, %s, %s, %s, '%s', %s, '%s', 0, '%s')" % (
            WS, t['id'], esc(t['title']), sq(t['desc']), sq(t['req_id']), sq(pname),
            sq(t['owner'] or None), sq(t['owner_uid']), sq(t['category']), t['priority'],
            sq(t['start'].isoformat() if t['start'] else None),
            t['done'].isoformat(), d2dt(t['done'], '18:00:00')))
    w(',\n'.join(rows) + ';')
    w('')
    w('COMMIT;')
    w('')
    w('-- 初始化结果提示：本次新建的管理员才需要用到预设密码')
    w('SELECT CONCAT(\'种子导入完成；管理员账号 \', COALESCE(@admin_name, @seed_admin_user),')
    w("              IF(@admin_created = 1, '（本次新建，初始密码 Hourglass@2026，请登录后立即修改）', '（沿用已有账号及密码）')) AS seed_note;")
    w('')

    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(out))

    # 统计与告警
    print('账号 %d：%s' % (len(users), '、'.join(u['name'] for u in users)))
    print('项目 %d、分类 %d、需求 %d、工作项 %d（bug %d）、版本 %d、版本归属 %d、完成快照 %d' % (
        len(projects), len(modules), len(demands), len(tasks),
        sum(1 for t in tasks if t['item_type'] == 'bug'),
        len(versions), len(version_task), len(done_tasks)))
    no_req = [t['id'] for t in tasks if not t['req_id']]
    no_cat = [t['id'] for t in tasks if not t['category']]
    linked = sum(1 for t in tasks if t['demand_id'])
    print('工作项无项目归属 %d 个：%s' % (len(no_req), no_req[:10]))
    print('工作项无分类 %d 个：%s' % (len(no_cat), no_cat[:10]))
    print('工作项关联需求 %d 个' % linked)
    from collections import Counter
    st = Counter(d['status'] for d in demands)
    print('需求状态：plan %d（均带 version_id）、pass %d、review %d、rej %d；因项目无版本回退 pass %d' % (
        st.get('plan', 0), st.get('pass', 0), st.get('review', 0), st.get('rej', 0), downgraded))
    print('首版上线日：%s' % ('、'.join('%s=%s' % kv for kv in sorted(first_release.items())) or '无'))
    print('非 done 任务写 completed_at %d 个（应为 0）' % sum(
        1 for t in tasks if t['column'] != 'done' and t['completed']))
    unpw = [u['name'] for u in users if u['username'] not in PINYIN.values()]
    if unpw:
        print('警告：以下账号未配拼音用户名，将使用中文用户名：%s' % '、'.join(unpw))
    print('已写入 %s' % OUT)


if __name__ == '__main__':
    main()
